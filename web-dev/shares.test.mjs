// node --test web-dev/shares.test.mjs — checks which shares a new share would merge with, as the server decides it.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mergesWith } from '../src/client/resources/web/shares.js';

const share = (name, origin, size) => ({ name, origin, size });
const names = (l) => l.map((s) => s.name);

test('no overlap, no merge', () => {
  assert.deepEqual(mergesWith([[0, 0, 0, 3, 3, 3]], [share('far', [10, 0, 0], [2, 2, 2])]), []);
});

test('touching a corner block counts, the next block over does not', () => {
  assert.deepEqual(names(mergesWith([[0, 0, 0, 3, 3, 3]], [share('corner', [3, 3, 3], [2, 2, 2])])), ['corner']);
  assert.deepEqual(mergesWith([[0, 0, 0, 3, 3, 3]], [share('next', [4, 0, 0], [2, 2, 2])]), []);
});

test('a share the joint box reaches merges too, whatever order they come in', () => {
  // "b" touches neither the new box nor "a", only the box the two make together.
  const shares = [share('b', [0, 5, 0], [1, 1, 1]), share('a', [2, 0, 0], [2, 6, 1])];
  assert.deepEqual(names(mergesWith([[0, 0, 0, 2, 0, 0]], shares)).sort(), ['a', 'b']);
});

test('a region with its corners reversed still counts', () => {
  assert.deepEqual(names(mergesWith([[10, 0, 0, 0, 0, 0]], [share('inside', [5, 0, 0], [2, 1, 1])])), ['inside']);
});

test('the box is the union of every region', () => {
  const shares = [share('between', [5, 0, 0], [1, 1, 1])];
  assert.deepEqual(
    names(
      mergesWith(
        [
          [0, 0, 0, 1, 1, 1],
          [9, 0, 0, 10, 1, 1],
        ],
        shares,
      ),
    ),
    ['between'],
  );
});
