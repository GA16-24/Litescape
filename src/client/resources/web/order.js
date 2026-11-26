// Survival build order: the sequence to place a schematic's blocks in without flying.
// Bottom-up, every block after something it can be placed against, attached blocks after the block
// they hang on, then parts that can fire when placed, then water and lava sources.

/** Flags per step, for the card that says what to watch out for. */
export const ACTIVATES = 1; // observers, pistons, redstone: can fire as soon as they're placed
export const FLUID = 2; // a water or lava source
export const FLOATING = 4; // nothing to place it against yet: needs a temporary block
export const FALLS = 8; // sand, gravel...: nothing under it, so it falls

const ACTIVATE =
  /^(observer|piston|sticky_piston|redstone_wire|repeater|comparator|redstone_torch|redstone_wall_torch|redstone_block|dispenser|dropper|tnt|crafter)$/;
const GRAVITY =
  /^(sand|red_sand|gravel|suspicious_sand|suspicious_gravel|anvil|chipped_anvil|damaged_anvil|dragon_egg)$|_concrete_powder$/;
// Their state's `facing` points away from the wall they hang on.
const ON_WALL = /wall_torch$|^ladder$|_wall_sign$|_wall_banner$|_wall_head$|_wall_skull$|^tripwire_hook$/;
const ON_FLOOR =
  /torch$|^redstone_wire$|^repeater$|^comparator$|_pressure_plate$|carpet$|rail$|_sign$|_banner$|sapling$|^(sugar_cane|cactus|bamboo|wheat|carrots|potatoes|beetroots|nether_wart)$/;
// Placed by the game together with another block, or never placed by hand.
const SKIP = /^(air|cave_air|void_air|light|structure_void|bubble_column|piston_head|moving_piston)$/;
const FACING = {
  north: [0, 0, -1],
  south: [0, 0, 1],
  west: [-1, 0, 0],
  east: [1, 0, 0],
  up: [0, 1, 0],
  down: [0, -1, 0],
};
const BELOW = [0, -1, 0],
  ABOVE = [0, 1, 0];

const neg = (d) => d && [-d[0], -d[1], -d[2]];

/** How the build order treats one palette entry: {skip} or {phase, host: [dx,dy,dz] | null, gravity}. */
export function rule(e) {
  if (!e || e.air || e.t) return { skip: true };
  const n = e.n.replace(/^minecraft:/, '');
  const p = Object.fromEntries((e.p || '').split(',').map((kv) => kv.split('=')));
  if (SKIP.test(n) || p.half === 'upper' || (n.endsWith('_bed') && p.part === 'head')) return { skip: true };
  if (n === 'water' || n === 'lava') return p.level && p.level !== '0' ? { skip: true } : { phase: 2, host: null };
  let host = null;
  if (p.face) host = p.face === 'floor' ? BELOW : p.face === 'ceiling' ? ABOVE : neg(FACING[p.facing]);
  else if (n === 'cocoa') host = FACING[p.facing];
  else if (ON_WALL.test(n)) host = neg(FACING[p.facing]);
  else if (p.hanging === 'true' || (n.endsWith('_hanging_sign') && !n.includes('wall'))) host = ABOVE;
  else if (ON_FLOOR.test(n) && !n.includes('hanging')) host = BELOW;
  const gravity = GRAVITY.test(n);
  if (gravity) host = BELOW;
  return { phase: ACTIVATE.test(n) ? 1 : 0, host: host || null, gravity };
}

/**
 * Orders the blocks of a volume indexed (y * sz + z) * sx + x.
 * Returns {order: cell indices in build order, rank: step per cell (-1 when not placed by hand), flags: per step}.
 */
export function buildOrder({ sx, sy, sz, blocks, palette }) {
  const n = sx * sy * sz;
  const rules = palette.map(rule);
  const solidAt = (e) => e && !e.air && !/^(minecraft:)?(water|lava|bubble_column)$/.test(e.n);
  const rank = new Int32Array(n).fill(-1);
  const key = new Float64Array(n); // lower goes first
  const placed = new Uint8Array(n); // 1 placed or terrain, 2 queued
  const host = new Int32Array(n).fill(-1);
  const cells = [];
  const at = (x, y, z) => (x < 0 || y < 0 || z < 0 || x >= sx || y >= sy || z >= sz ? -1 : (y * sz + z) * sx + x);

  for (let i = 0; i < n; i++) {
    const e = palette[blocks[i]];
    if (e?.t && solidAt(e)) placed[i] = 1; // captured surroundings are already there to build against
    const r = rules[blocks[i]];
    if (r.skip) continue;
    const x = i % sx,
      z = ((i / sx) | 0) % sz,
      y = (i / (sx * sz)) | 0;
    key[i] = (r.phase * sy + y) * n + i;
    if (r.host) {
      const h = at(x + r.host[0], y + r.host[1], z + r.host[2]);
      if (h >= 0 && solidAt(palette[blocks[h]])) host[i] = h;
    }
    cells.push(i);
  }
  cells.sort((a, b) => key[a] - key[b]);

  // Min-heap of placeable cells by key.
  const heap = [];
  const push = (i) => {
    placed[i] = 2;
    let c = heap.push(i) - 1;
    while (c > 0) {
      const p = (c - 1) >> 1;
      if (key[heap[p]] <= key[i]) break;
      heap[c] = heap[p];
      c = p;
    }
    heap[c] = i;
  };
  const pop = () => {
    const top = heap[0],
      last = heap.pop();
    if (heap.length) {
      let c = 0;
      for (;;) {
        let m = 2 * c + 1;
        if (m >= heap.length) break;
        if (m + 1 < heap.length && key[heap[m + 1]] < key[heap[m]]) m++;
        if (key[heap[m]] >= key[last]) break;
        heap[c] = heap[m];
        c = m;
      }
      heap[c] = last;
    }
    return top;
  };
  const DIRS = [BELOW, ABOVE, [0, 0, -1], [0, 0, 1], [-1, 0, 0], [1, 0, 0]];
  const ready = (i) => {
    if (host[i] >= 0) return placed[host[i]] === 1;
    const x = i % sx,
      z = ((i / sx) | 0) % sz,
      y = (i / (sx * sz)) | 0;
    if (y === 0) return true; // the bottom layer sits on the ground
    for (const d of DIRS) {
      const j = at(x + d[0], y + d[1], z + d[2]);
      if (j >= 0 && placed[j] === 1 && solidAt(palette[blocks[j]])) return true;
    }
    return false;
  };
  const phase = (i) => rules[blocks[i]].phase;
  const restsOnLater = (i) => {
    const x = i % sx,
      z = ((i / sx) | 0) % sz,
      y = (i / (sx * sz)) | 0;
    return DIRS.some((d) => {
      const j = at(x + d[0], y + d[1], z + d[2]);
      return j >= 0 && placed[j] !== 1 && !rules[blocks[j]].skip && phase(j) > phase(i) && solidAt(palette[blocks[j]]);
    });
  };
  for (const i of cells) if (ready(i)) push(i);

  const order = new Int32Array(cells.length);
  const flags = new Uint8Array(cells.length);
  let s = 0,
    next = 0; // cursor into cells, for when nothing is placeable
  while (s < cells.length) {
    let i,
      f = 0;
    while (next < cells.length && placed[cells[next]]) next++;
    const c = cells[next]; // the lowest block not placed or queued yet: it has nothing to be placed against
    // Wait for a later part only if c might rest on it; otherwise a floating block would wait behind redstone and water.
    if (heap.length && (c === undefined || phase(c) >= phase(heap[0]) || restsOnLater(c))) i = pop();
    else {
      i = c;
      // What it hangs on comes first; the guard stops at blocks that hang on each other.
      for (let k = 0; k < 8 && host[i] >= 0 && !placed[host[i]]; k++) i = host[i];
      f |= FLOATING;
    }
    const r = rules[blocks[i]];
    if (r.phase === 1) f |= ACTIVATES;
    if (r.phase === 2) f |= FLUID;
    if (r.gravity && host[i] < 0 && i >= sx * sz) f |= FALLS;
    placed[i] = 1;
    rank[i] = s;
    order[s] = i;
    flags[s++] = f;
    if (!solidAt(palette[blocks[i]])) continue; // nothing is placed against water or lava
    const x = i % sx,
      z = ((i / sx) | 0) % sz,
      y = (i / (sx * sz)) | 0;
    for (const d of DIRS) {
      const j = at(x + d[0], y + d[1], z + d[2]);
      if (j >= 0 && rank[j] < 0 && !placed[j] && !rules[blocks[j]].skip && ready(j)) push(j);
    }
  }
  return { order, rank, flags };
}
