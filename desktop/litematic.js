// Reads Litematica's .litematic schematic files: gzipped NBT with one or more regions of packed block states.

import zlib from 'node:zlib';

/** Parses gzipped NBT into plain values: compounds become objects, lists arrays, longs BigInts and long arrays BigInt64Arrays. */
export function readNbt(gz) {
  const b = zlib.gunzipSync(gz);
  let p = 0;
  /** Moves past n bytes and returns where they start. */
  const skip = (n) => {
    p += n;
    return p - n;
  };
  const str = () => {
    const n = b.readUInt16BE(skip(2));
    return b.toString('utf8', skip(n), p);
  };
  const read = (type) => {
    switch (type) {
      case 1:
        return b.readInt8(skip(1));
      case 2:
        return b.readInt16BE(skip(2));
      case 3:
        return b.readInt32BE(skip(4));
      case 4:
        return b.readBigInt64BE(skip(8));
      case 5:
        return b.readFloatBE(skip(4));
      case 6:
        return b.readDoubleBE(skip(8));
      case 7: {
        const n = read(3);
        return b.subarray(skip(n), p);
      }
      case 8:
        return str();
      case 9: {
        const t = read(1);
        return Array.from({ length: read(3) }, () => read(t));
      }
      case 10: {
        const o = {};
        for (let t = read(1); t !== 0; t = read(1)) o[str()] = read(t);
        return o;
      }
      case 11:
        return Array.from({ length: read(3) }, () => read(3));
      case 12: {
        const n = read(3);
        const a = new BigInt64Array(n);
        for (let i = 0; i < n; i++) a[i] = read(4);
        return a;
      }
      default:
        throw new Error(`Unknown NBT tag ${type}`);
    }
  };
  if (read(1) !== 10) throw new Error('Not an NBT file');
  str(); // the root's name
  return read(10);
}

/** A palette entry's block id; files from before Minecraft 26.3 call it Name, newer ones id. */
export const blockId = (s) => s.id ?? s.Name;

/** The state's key in the block table: "minecraft:lever[face=floor,facing=east,powered=false]", properties sorted like the game sorts them. */
export function stateKey(s) {
  const props = s.properties ?? s.Properties ?? {};
  const list = Object.keys(props)
    .sort()
    .map((k) => `${k}=${props[k]}`);
  return list.length ? `${blockId(s)}[${list.join(',')}]` : blockId(s);
}

/**
 * A .litematic file as one box: { name, author, dataVersion, size, palette, blocks: Uint16Array }, palette entries as the file
 * has them ({ Name, Properties } or, from Minecraft 26.3, { id, properties }) so the game can upgrade them,
 * blocks indexed (y * sz + z) * sx + x like the viewer, palette entry 0 air. Regions are merged; where they overlap, later ones win.
 */
export function readLitematic(gz) {
  const root = readNbt(gz);
  if (!root.Regions) throw new Error("This isn't a Litematica schematic");
  const regions = Object.values(root.Regions).map((r) => {
    const size = ['x', 'y', 'z'].map((k) => Math.abs(r.Size[k]));
    // A negative size grows the region the other way from its position.
    const min = ['x', 'y', 'z'].map((k) => r.Position[k] + (r.Size[k] < 0 ? r.Size[k] + 1 : 0));
    return { r, size, min };
  });
  if (!regions.length) throw new Error('This schematic has no regions');
  const lo = [0, 1, 2].map((k) => Math.min(...regions.map((g) => g.min[k])));
  const hi = [0, 1, 2].map((k) => Math.max(...regions.map((g) => g.min[k] + g.size[k])));
  const size = hi.map((v, k) => v - lo[k]);
  const total = size[0] * size[1] * size[2];
  if (total > 16_777_216) throw new Error(`The schematic is ${size.join('×')}, more than 16,777,216 blocks`);
  const blocks = new Uint16Array(total);
  const palette = [{ id: 'minecraft:air' }];
  const index = new Map([['minecraft:air', 0]]);
  for (const {
    r,
    size: [rx, ry, rz],
    min,
  } of regions) {
    const ids = r.BlockStatePalette.map((s) => {
      const key = stateKey(s);
      if (!index.has(key)) {
        // The farm test's server (Volume) numbers block states with signed shorts.
        if (palette.length === 32768) throw new Error('The schematic has more than 32,768 kinds of blocks');
        index.set(key, palette.length);
        palette.push(s);
      }
      return index.get(key);
    });
    // Litematica packs entries back to back, so one can span two longs.
    const bits = BigInt(Math.max(2, 32 - Math.clz32(r.BlockStatePalette.length - 1)));
    const mask = (1n << bits) - 1n;
    const longs = new BigUint64Array(r.BlockStates.buffer, r.BlockStates.byteOffset, r.BlockStates.length);
    for (let y = 0; y < ry; y++)
      for (let z = 0; z < rz; z++)
        for (let x = 0; x < rx; x++) {
          const i = BigInt((y * rz + z) * rx + x);
          const start = i * bits;
          const word = Number(start >> 6n);
          const off = start & 63n;
          let v = longs[word] >> off;
          if (off + bits > 64n) v |= longs[word + 1] << (64n - off);
          const id = ids[Number(v & mask)];
          if (id) blocks[((y + min[1] - lo[1]) * size[2] + z + min[2] - lo[2]) * size[0] + x + min[0] - lo[0]] = id;
        }
  }
  return {
    name: root.Metadata?.Name || '',
    author: root.Metadata?.Author || '',
    dataVersion: root.MinecraftDataVersion ?? 0,
    size,
    palette,
    blocks,
  };
}
