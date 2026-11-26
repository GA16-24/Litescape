// node --test web-dev/order.test.mjs — checks the survival build order on small hand-made volumes.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ACTIVATES, buildOrder, FALLS, FLOATING, FLUID } from '../src/client/resources/web/order.js';

/** A volume from a map of "x,y,z" -> [name, props]; everything else is air. */
function vol(size, cells) {
  const [sx, sy, sz] = size;
  const palette = [{ n: 'minecraft:air', air: true }];
  const blocks = new Uint16Array(sx * sy * sz);
  for (const [pos, [n, p = '', extra = {}]] of Object.entries(cells)) {
    const [x, y, z] = pos.split(',').map(Number);
    palette.push({ n: `minecraft:${n}`, p, ...extra });
    blocks[(y * sz + z) * sx + x] = palette.length - 1;
  }
  const r = buildOrder({ sx, sy, sz, blocks, palette });
  const name = (i) => palette[blocks[i]].n.slice(10);
  return { ...r, names: [...r.order].map(name), at: (x, y, z) => (y * sz + z) * sx + x };
}

test('goes bottom-up', () => {
  const v = vol([1, 3, 1], { '0,2,0': ['oak_planks'], '0,0,0': ['stone'], '0,1,0': ['dirt'] });
  assert.deepEqual(v.names, ['stone', 'dirt', 'oak_planks']);
});

test('places a wall torch after the wall it hangs on', () => {
  // The torch faces east, so its wall is to the west at x=0. It comes first in index order.
  const v = vol([3, 1, 1], { '1,0,0': ['wall_torch', 'facing=east'], '0,0,0': ['stone'], '2,0,0': ['stone'] });
  assert.ok(v.rank[v.at(1, 0, 0)] > v.rank[v.at(0, 0, 0)]);
});

test('hangs a lantern after the block above it', () => {
  const v = vol([1, 3, 1], {
    '0,0,0': ['stone'],
    '0,1,0': ['lantern', 'hanging=true'],
    '0,2,0': ['stone'],
  });
  // The ceiling at y=2 has nothing to be placed against but the lantern's spot, so it needs a temporary block.
  assert.deepEqual(v.names, ['stone', 'stone', 'lantern']);
  assert.equal(v.flags[1], FLOATING);
});

test('leaves redstone, then water, for the end', () => {
  const v = vol([4, 1, 1], {
    '0,0,0': ['water', 'level=0'],
    '1,0,0': ['observer', 'facing=up'],
    '2,0,0': ['stone'],
    '3,0,0': ['water', 'level=3'],
  });
  assert.deepEqual(v.names, ['stone', 'observer', 'water']);
  assert.deepEqual([...v.flags], [0, ACTIVATES, FLUID]);
  assert.equal(v.rank[v.at(3, 0, 0)], -1); // flowing water comes by itself
});

test('waits for a block placed after redstone when it rests on it', () => {
  const v = vol([1, 2, 1], { '0,0,0': ['piston', 'facing=up'], '0,1,0': ['stone'] });
  assert.deepEqual(v.names, ['piston', 'stone']);
});

test('builds from the surroundings, and skips them', () => {
  const v = vol([1, 2, 1], { '0,0,0': ['stone', '', { t: true }], '0,1,0': ['lantern', 'hanging=false'] });
  assert.deepEqual(v.names, ['lantern']);
  assert.equal(v.flags[0], 0);
});

test('warns about sand with nothing under it, and skips door tops', () => {
  const v = vol([2, 3, 1], {
    '0,0,0': ['stone'],
    '0,1,0': ['stone'],
    '1,1,0': ['sand'],
    '0,2,0': ['oak_door', 'half=lower'],
    '1,2,0': ['oak_door', 'half=upper'],
  });
  assert.deepEqual(v.names, ['stone', 'stone', 'sand', 'oak_door']);
  assert.equal(v.flags[2], FALLS);
});

test('places a floating block at its height, not after the water', () => {
  const v = vol([3, 3, 1], {
    '0,0,0': ['stone'],
    '1,0,0': ['water', 'level=0'],
    '2,2,0': ['oak_slab', 'type=bottom'],
  });
  assert.deepEqual(v.names, ['stone', 'oak_slab', 'water']);
  assert.deepEqual([...v.flags], [0, FLOATING, FLUID]);
});

test('places a button and a ladder after the wall they hang on', () => {
  // Both face east, so their wall is to the west, at x=0. They come first in index order.
  const v = vol([2, 1, 2], {
    '1,0,0': ['stone_button', 'face=wall,facing=east'],
    '1,0,1': ['ladder', 'facing=east'],
    '0,0,0': ['stone'],
    '0,0,1': ['stone'],
  });
  assert.ok(v.rank[v.at(1, 0, 0)] > v.rank[v.at(0, 0, 0)]);
  assert.ok(v.rank[v.at(1, 0, 1)] > v.rank[v.at(0, 0, 1)]);
});

test('places sugar cane after the water next to its dirt', () => {
  const v = vol([2, 2, 1], { '0,0,0': ['dirt'], '1,0,0': ['water', 'level=0'], '0,1,0': ['sugar_cane', 'age=0'] });
  assert.deepEqual(v.names, ['dirt', 'water', 'sugar_cane']);
});

test('places a door after the block under it', () => {
  // The door touches a wall at its height, but its floor is a redstone block, which comes later.
  const v = vol([2, 2, 1], {
    '0,0,0': ['redstone_block'],
    '0,1,0': ['oak_door', 'half=lower,facing=east'],
    '1,0,0': ['stone'],
    '1,1,0': ['stone'],
  });
  assert.deepEqual(v.names, ['stone', 'stone', 'redstone_block', 'oak_door']);
});
