// Run with: node --test desktop/litematic.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import zlib from 'node:zlib';
import { readLitematic, stateKey } from './litematic.js';

/** A small NBT writer: objects are compounds, arrays lists of compounds, numbers ints, strings strings, BigInt64Array long arrays. */
function nbt(root) {
  const parts = [];
  const u8 = (n) => parts.push(Buffer.from([n]));
  const s = (v) => {
    const b = Buffer.from(v);
    const n = Buffer.alloc(2);
    n.writeUInt16BE(b.length);
    parts.push(n, b);
  };
  const i32 = (n) => {
    const b = Buffer.alloc(4);
    b.writeInt32BE(n);
    parts.push(b);
  };
  const type = (v) =>
    typeof v === 'string' ? 8 : typeof v === 'number' ? 3 : v instanceof BigInt64Array ? 12 : Array.isArray(v) ? 9 : 10;
  const body = (v) => {
    const t = type(v);
    if (t === 8) s(v);
    else if (t === 3) i32(v);
    else if (t === 12) {
      i32(v.length);
      for (const x of v) {
        const b = Buffer.alloc(8);
        b.writeBigInt64BE(x);
        parts.push(b);
      }
    } else if (t === 9) {
      u8(v.length ? type(v[0]) : 0);
      i32(v.length);
      for (const x of v) body(x);
    } else {
      for (const [k, x] of Object.entries(v)) {
        u8(type(x));
        s(k);
        body(x);
      }
      u8(0);
    }
  };
  u8(10);
  s('');
  body(root);
  return zlib.gzipSync(Buffer.concat(parts));
}

/** Packs values back to back like Litematica's bit array, spanning longs. */
function pack(values, bits) {
  const longs = new BigUint64Array(Math.ceil((values.length * bits) / 64));
  values.forEach((v, i) => {
    const start = BigInt(i * bits);
    const word = Number(start >> 6n);
    const off = start & 63n;
    longs[word] |= (BigInt(v) << off) & 0xffffffffffffffffn;
    if (off + BigInt(bits) > 64n) longs[word + 1] |= BigInt(v) >> (64n - off);
  });
  return new BigInt64Array(longs.buffer);
}

test('stateKey sorts properties like the game, in both of its formats', () => {
  assert.equal(stateKey({ Name: 'minecraft:dirt' }), 'minecraft:dirt');
  assert.equal(
    stateKey({ id: 'minecraft:hopper', properties: { facing: 'down', enabled: 'true' } }),
    'minecraft:hopper[enabled=true,facing=down]',
  );
  assert.equal(
    stateKey({ Name: 'minecraft:lever', Properties: { powered: 'false', face: 'floor', facing: 'east' } }),
    'minecraft:lever[face=floor,facing=east,powered=false]',
  );
});

test('reads and merges regions, including packed entries that span longs and negative sizes', () => {
  // 5 palette entries need 3 bits, so entry 21 straddles the first and second long.
  const palA = [
    { Name: 'minecraft:air' },
    { Name: 'minecraft:stone' },
    { Name: 'minecraft:dirt' },
    { Name: 'minecraft:lever', Properties: { face: 'floor', facing: 'east', powered: 'false' } },
    { Name: 'minecraft:hopper', Properties: { enabled: 'true', facing: 'down' } },
  ];
  const a = Array.from({ length: 4 * 3 * 2 }, (_, i) => (i === 21 ? 4 : i % 4));
  const palB = [{ Name: 'minecraft:air' }, { Name: 'minecraft:dirt' }, { Name: 'minecraft:glass' }];
  const file = nbt({
    MinecraftDataVersion: 4440,
    Metadata: { Name: 'Pumpkin farm', Author: 'Alex' },
    Regions: {
      a: {
        Position: { x: 0, y: 0, z: 0 },
        Size: { x: 4, y: 3, z: 2 },
        BlockStatePalette: palA,
        BlockStates: pack(a, 3),
      },
      // Size x -2 from x 6: the region covers x 5 and 6.
      b: {
        Position: { x: 6, y: 1, z: 1 },
        Size: { x: -2, y: 1, z: 1 },
        BlockStatePalette: palB,
        BlockStates: pack([1, 2], 2),
      },
    },
  });
  const s = readLitematic(file);
  assert.equal(s.name, 'Pumpkin farm');
  assert.equal(s.dataVersion, 4440);
  assert.deepEqual(s.size, [7, 3, 2]);
  const at = (x, y, z) => stateKey(s.palette[s.blocks[(y * 2 + z) * 7 + x]]);
  assert.equal(at(0, 0, 0), 'minecraft:air');
  assert.equal(at(1, 0, 0), 'minecraft:stone');
  assert.equal(at(3, 0, 0), 'minecraft:lever[face=floor,facing=east,powered=false]');
  // index 21 in region a: y 2, z 1, x 1
  assert.equal(at(1, 2, 1), 'minecraft:hopper[enabled=true,facing=down]');
  assert.equal(at(2, 2, 1), 'minecraft:dirt');
  assert.equal(at(5, 1, 1), 'minecraft:dirt');
  assert.equal(at(6, 1, 1), 'minecraft:glass');
  // dirt from both regions is one palette entry, and air is entry 0
  assert.equal(s.palette.filter((p) => p.Name === 'minecraft:dirt').length, 1);
  assert.equal(stateKey(s.palette[0]), 'minecraft:air');
});

test('rejects files that are not schematics', () => {
  assert.throws(() => readLitematic(nbt({ Data: {} })), /isn't a Litematica schematic/);
  assert.throws(() => readLitematic(zlib.gzipSync(Buffer.from('hello'))), /Not an NBT file/);
});
