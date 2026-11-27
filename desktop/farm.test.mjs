// Run with: node --test desktop/farm.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { jobOf } from './farm.js';

const schematic = {
  size: [2, 1, 1],
  palette: [{ id: 'minecraft:air' }],
  blocks: new Uint16Array(2),
  dataVersion: 5023,
};
const job = (query) => jobOf(schematic, 'f1', new URLSearchParams(query));

test('a farm job keeps the chosen containers full', () => {
  const j = job('ticks=72000&flip=1,64,0&feed=0,64,0,minecraft:raw_iron;1,65,0,minecraft:coal');
  assert.deepEqual(j.feed, [
    [0, 64, 0, 'minecraft:raw_iron'],
    [1, 65, 0, 'minecraft:coal'],
  ]);
  assert.deepEqual(j.flips, [[1, 64, 0]]);
  assert.deepEqual(job('ticks=72000').feed, []);
});

test('a farm job refuses what the viewer could not have sent', () => {
  assert.throws(() => job('ticks=72000&feed=0,64,0,minecraft:Raw Iron'), /Unknown item/);
  assert.throws(() => job('ticks=72000&feed=0,64,minecraft:coal'), /Bad coordinates/);
  assert.throws(() => job('ticks=5'), /between/);
});
