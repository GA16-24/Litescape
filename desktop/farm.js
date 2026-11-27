// The farm test window's data: schematic files found on this computer, turned into what the viewer draws,
// and into jobs for the test server (see Farm.java in the mod).

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { blockId, stateKey } from './litematic.js';

/** Where the mod saves how every block looks (BlockTable.java); it's written while Minecraft runs. */
export const blocksDir = (mc, home = os.homedir()) => path.join(home, '.litescape', 'blocks', mc);

let cached = null;
/** The block table for Minecraft `mc`, or null until the game has run once with the mod. Reloaded when the game rewrites it. */
export function blockTable(dir) {
  let key;
  try {
    key = fs.readFileSync(path.join(dir, 'key.txt'), 'utf8');
  } catch {
    return null;
  }
  if (cached?.dir !== dir || cached.key !== key) {
    const json = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(dir, 'states.json.gz'))));
    cached = { dir, key, ...json };
  }
  return cached;
}

/** Every .litematic under the folders, newest first, as { id, name, path, modified }. */
export function schematicFiles(dirs, extra = []) {
  const found = new Map();
  const add = (file) => {
    try {
      const st = fs.statSync(file);
      const id = crypto.createHash('sha1').update(file).digest('hex').slice(0, 16);
      found.set(id, { id, name: path.basename(file, '.litematic'), path: file, modified: st.mtimeMs });
    } catch {}
  };
  const walk = (dir, depth) => {
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {}
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory() && depth < 4) walk(p, depth + 1);
      else if (e.isFile() && e.name.endsWith('.litematic')) add(p);
    }
  };
  for (const dir of new Set(dirs)) walk(dir, 0);
  for (const f of extra) add(f);
  return [...found.values()].sort((a, b) => b.modified - a.modified).slice(0, 500);
}

/** The schematic's bottom goes at Y 64 in the test world, lower if it wouldn't fit under the build limit. */
export const originOf = (size) => [0, Math.max(-64, Math.min(64, 320 - size[1])), 0];

/** The viewer's /api/view answer for a schematic, with only the textures it uses. Blocks the table doesn't know stay invisible. */
export function viewOf(s, table, id) {
  const used = new Map();
  const tex = [];
  const texOf = (i) => {
    if (!used.has(i)) {
      used.set(i, tex.length);
      tex.push(table.tex[i]);
    }
    return used.get(i);
  };
  const unknown = new Set();
  const palette = s.palette.map((st) => {
    const e = table.states[stateKey(st)];
    if (!e) {
      const n = blockId(st);
      unknown.add(n);
      const p = stateKey(st).slice(n.length + 1, -1);
      return {
        n,
        p,
        air: false,
        opaque: false,
        selfCull: false,
        light: 0,
        spawnOn: false,
        spawnIn: false,
        q: [],
      };
    }
    if (e.air) return e;
    const out = { ...e, q: e.q.map(([t, ...rest]) => [texOf(t), ...rest]) };
    if (e.f) out.f = { ...e.f, t: texOf(e.f.t) };
    return out;
  });
  return {
    type: 'file',
    id,
    name: s.name,
    source: 'file',
    origin: originOf(s.size),
    size: s.size,
    contents: {},
    blocks: Buffer.from(s.blocks.buffer, s.blocks.byteOffset, s.blocks.byteLength).toString('base64'),
    palette,
    tex,
    biomes: [],
    unknown: [...unknown],
  };
}

const DIMENSIONS = ['minecraft:overworld', 'minecraft:the_nether', 'minecraft:the_end'];
const xyz = (s) => {
  const p = String(s).split(',').map(Number);
  if (p.length !== 3 || !p.every(Number.isInteger)) throw new Error('Bad coordinates');
  return p;
};

/** The test server's job for a schematic; the query comes from the viewer, so every value is checked. */
export function jobOf(s, id, q) {
  const ticks = Number(q.get('ticks'));
  if (!Number.isInteger(ticks) || ticks < 20 || ticks > 24 * 72000)
    throw new Error('Run between 1 second and 24 hours of game time');
  const dimension = q.get('dim') || DIMENSIONS[0];
  if (!DIMENSIONS.includes(dimension)) throw new Error('Unknown dimension');
  const biome = q.get('biome') || 'minecraft:plains';
  if (!/^minecraft:[a-z_]+$/.test(biome)) throw new Error('Unknown biome');
  return {
    id,
    origin: originOf(s.size),
    size: s.size,
    palette: s.palette,
    dataVersion: s.dataVersion,
    blocks: Buffer.from(s.blocks.buffer, s.blocks.byteOffset, s.blocks.byteLength).toString('base64'),
    afk: q.get('afk') ? xyz(q.get('afk')) : null,
    flips: (q.get('flip') || '').split(';').filter(Boolean).map(xyz),
    // "x,y,z,minecraft:item;…": containers the test keeps full
    feed: (q.get('feed') || '')
      .split(';')
      .filter(Boolean)
      .map((f) => {
        const i = f.lastIndexOf(',');
        const item = f.slice(i + 1);
        if (!/^minecraft:[a-z0-9_]+$/.test(item)) throw new Error('Unknown item');
        return [...xyz(f.slice(0, i)), item];
      }),
    ticks,
    biome,
    dimension,
  };
}
