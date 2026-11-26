// Survival build order: the sequence to place a schematic's blocks in without flying, in stages.
// Bottom-up, every block after something it can be placed against, attached blocks after the block
// they hang on, then parts that can fire when placed, then water sources once the blocks under and around them
// are in, then plants that need water, then lava last: water flowing onto a lava source turns it into obsidian.
// A stage is the blocks of one kind at one height, which can go down in one go.

/** Flags per block, for the card that says what to watch out for. */
export const ACTIVATES = 1; // observers, pistons, redstone: can fire as soon as they're placed
export const FLUID = 2; // a water source
export const FLOATING = 4; // nothing to place it against yet: needs a temporary block
export const FALLS = 8; // sand, gravel...: nothing under it, so it falls
export const LAVA = 16; // a lava source

const ACTIVATE =
  /^(observer|piston|sticky_piston|redstone_wire|repeater|comparator|redstone_torch|redstone_wall_torch|redstone_block|dispenser|dropper|tnt|crafter)$/;
const GRAVITY =
  /^(sand|red_sand|gravel|suspicious_sand|suspicious_gravel|anvil|chipped_anvil|damaged_anvil|dragon_egg)$|_concrete_powder$/;
// Their state's `facing` points away from the wall they hang on.
const ON_WALL = /wall_torch$|^ladder$|_wall_sign$|_wall_banner$|_wall_head$|_wall_skull$|^tripwire_hook$/;
const ON_FLOOR =
  /torch$|^redstone_wire$|^repeater$|^comparator$|_pressure_plate$|carpet$|rail$|_sign$|_banner$|_door$|sapling$|^(sugar_cane|cactus|bamboo|wheat|carrots|potatoes|beetroots|nether_wart)$/;
// Can only be placed next to or in water, so they come after it.
const NEEDS_WATER = /^(sugar_cane|lily_pad|kelp|kelp_plant|seagrass|tall_seagrass)$/;
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
  if (n === 'water' || n === 'lava')
    return p.level && p.level !== '0' ? { skip: true } : { phase: n === 'water' ? 2 : 4, host: null };
  let host = null;
  if (p.face) host = p.face === 'floor' ? BELOW : p.face === 'ceiling' ? ABOVE : neg(FACING[p.facing]);
  else if (n === 'cocoa') host = FACING[p.facing];
  else if (ON_WALL.test(n)) host = neg(FACING[p.facing]);
  else if (p.hanging === 'true' || (n.endsWith('_hanging_sign') && !n.includes('wall'))) host = ABOVE;
  else if (ON_FLOOR.test(n) && !n.includes('hanging')) host = BELOW;
  const gravity = GRAVITY.test(n);
  if (gravity) host = BELOW;
  return { phase: NEEDS_WATER.test(n) ? 3 : ACTIVATE.test(n) ? 1 : 0, host: host || null, gravity };
}

/**
 * Orders the blocks of a volume indexed (y * sz + z) * sx + x, grouped in stages. Returns
 * {order: cell indices in build order, flags: per entry of order, starts: where each stage begins in order, plus its end,
 *  values: per stage (phase * sy + y) * 2 + 1 when its blocks hang on others, rank: stage per cell, -1 when not placed by hand}.
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
    if (r.phase === 4) f |= LAVA;
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

  // Each block's stage: its own kind and height, but never before the stage of the block it hangs on,
  // or of the earliest neighbor it can be placed against.
  const len = order.length;
  const stage = new Int32Array(n).fill(-1);
  const value = new Int32Array(len);
  for (let k = 0; k < len; k++) {
    const i = order[k];
    const r = rules[blocks[i]];
    const x = i % sx,
      z = ((i / sx) | 0) % sz,
      y = (i / (sx * sz)) | 0;
    let v = (r.phase * sy + y) * 2 + (r.host && !r.gravity ? 1 : 0);
    if (host[i] >= 0) {
      if (stage[host[i]] >= 0) v = Math.max(v, stage[host[i]] + 1);
    } else if (y > 0 && !(flags[k] & FLOATING)) {
      let m = Infinity;
      for (const d of DIRS) {
        const j = at(x + d[0], y + d[1], z + d[2]);
        if (j < 0 || !solidAt(palette[blocks[j]])) continue;
        if (palette[blocks[j]].t) m = -1;
        else if (stage[j] >= 0) m = Math.min(m, stage[j]);
      }
      if (m !== Infinity) v = Math.max(v, m);
    }
    stage[i] = value[k] = v;
  }
  // Counting sort by stage, keeping the block order inside each stage.
  const at0 = new Int32Array(10 * sy + 4); // values reach (5 phases * sy) * 2
  for (const v of value) at0[v + 1]++;
  for (let v = 1; v < at0.length; v++) at0[v] += at0[v - 1];
  const sorted = new Int32Array(len);
  const sflags = new Uint8Array(len);
  for (let k = 0; k < len; k++) {
    const p = at0[value[k]]++;
    sorted[p] = order[k];
    sflags[p] = flags[k];
  }
  const starts = [],
    values = [];
  for (let p = 0; p < len; p++) {
    const v = stage[sorted[p]];
    if (v !== values[values.length - 1]) {
      starts.push(p);
      values.push(v);
    }
    rank[sorted[p]] = values.length - 1;
  }
  starts.push(len);
  return { order: sorted, flags: sflags, starts: Int32Array.from(starts), values: Int32Array.from(values), rank };
}

// Run as a worker (new Worker('order.js', { type: 'module' })), it orders volumes off the page's thread.
if (typeof WorkerGlobalScope !== 'undefined')
  self.onmessage = (e) => {
    const r = buildOrder(e.data);
    self.postMessage({ id: e.data.id, ...r }, [r.order.buffer, r.rank.buffer, r.flags.buffer, r.starts.buffer]);
  };
