// Finds Minecraft instances from the common launchers and installs the bundled mod jar into them.

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import zlib from 'node:zlib';

const MOD_ID = 'litweb';
// Modrinth slugs, which are also the mod ids. MaLiLib comes before Litematica, which needs it.
export const DEPS = ['fabric-api', 'malilib', 'litematica'];
const UA = 'GA16-24/Litescape (github.com/GA16-24/Litescape)';

/** Reads one entry of a zip (a jar) with positioned reads, so big jars aren't loaded whole. */
export function readZipEntry(file, name) {
  const fd = fs.openSync(file, 'r');
  try {
    const read = (len, pos) => {
      const buf = Buffer.alloc(len);
      return buf.subarray(0, fs.readSync(fd, buf, 0, len, pos));
    };
    const size = fs.fstatSync(fd).size;
    const tail = read(Math.min(size, 65557), Math.max(0, size - 65557));
    const eocd = tail.lastIndexOf(Buffer.from('PK\x05\x06', 'latin1'));
    if (eocd < 0) return null;
    const cd = read(tail.readUInt32LE(eocd + 12), tail.readUInt32LE(eocd + 16));
    for (let p = 0; p + 46 <= cd.length && cd.readUInt32LE(p) === 0x02014b50; ) {
      const nameLen = cd.readUInt16LE(p + 28);
      if (cd.toString('utf8', p + 46, p + 46 + nameLen) === name) {
        const method = cd.readUInt16LE(p + 10);
        const local = cd.readUInt32LE(p + 42);
        const header = read(30, local);
        const data = read(cd.readUInt32LE(p + 20), local + 30 + header.readUInt16LE(26) + header.readUInt16LE(28));
        return method === 0 ? data : method === 8 ? zlib.inflateRawSync(data) : null;
      }
      p += 46 + nameLen + cd.readUInt16LE(p + 30) + cd.readUInt16LE(p + 32);
    }
    return null;
  } finally {
    fs.closeSync(fd);
  }
}

/** The jar's fabric.mod.json, or null when it isn't a readable Fabric mod. */
export function modInfo(jar) {
  try {
    return JSON.parse(readZipEntry(jar, 'fabric.mod.json'));
  } catch {
    return null;
  }
}

/** Every jar in the instance's mods folder with the mod ids it provides. */
function jars(dir) {
  const modsDir = path.join(dir, 'mods');
  let names = [];
  try {
    names = fs.readdirSync(modsDir).filter((n) => n.endsWith('.jar'));
  } catch {}
  return names.map((n) => {
    const info = modInfo(path.join(modsDir, n));
    return { file: path.join(modsDir, n), ids: [info?.id, ...(info?.provides ?? [])], version: info?.version };
  });
}

/** The mod jar shipped with the app: its path, version and the Minecraft version it needs. */
export function bundledMod(dir) {
  let names = [];
  try {
    names = fs.readdirSync(dir).filter((n) => n.endsWith('.jar') && !n.endsWith('-sources.jar'));
  } catch {}
  for (const n of names) {
    const info = modInfo(path.join(dir, n));
    if (info?.id === MOD_ID) return { file: path.join(dir, n), version: info.version, mc: info.depends?.minecraft };
  }
  return null;
}

/** The base version of a range like "~26.3", or null for "*" and missing ranges. */
export function mcBase(range) {
  return typeof range === 'string' && range !== '*' ? range.replace(/^[~^>=\s]+/, '') : null;
}

// shortcut: treats "~26.3" or ">=26.3" as "26.3 or 26.3.x"; use a real semver range check if the mod ever spans versions.
export function mcMatches(version, range) {
  const want = mcBase(range);
  return !want || version === want || version.startsWith(`${want}.`);
}

function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
  } catch {
    return null;
  }
}

function readJson(file) {
  try {
    return JSON.parse(readText(file));
  } catch {
    return null;
  }
}

function subdirs(dir) {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => path.join(dir, d.name));
  } catch {
    return [];
  }
}

// Each reader returns { launcher, name, dir, mc, fabric }; mc and fabric are null when unknown.

function vanilla(root) {
  const out = [];
  for (const f of ['launcher_profiles.json', 'launcher_profiles_microsoft_store.json']) {
    for (const p of Object.values(readJson(path.join(root, f))?.profiles ?? {})) {
      const id = p.lastVersionId ?? '';
      const fabric = /^fabric-loader-[^-]+-(.+)$/.exec(id);
      if (!fabric && !/^\d/.test(id)) continue; // "latest-release" and friends are never Fabric
      const name = p.name || (p.type === 'latest-release' ? 'Latest release' : id);
      out.push({
        launcher: 'Minecraft Launcher',
        name,
        dir: p.gameDir || root,
        mc: fabric ? fabric[1] : id,
        fabric: !!fabric,
      });
    }
  }
  return out;
}

function prismInstance(dir, launcher = 'Prism Launcher') {
  const pack = readJson(path.join(dir, 'mmc-pack.json'));
  if (!pack) return null;
  const component = (uid) => pack.components?.find((c) => c.uid === uid);
  const name = /^name=(.*)$/m.exec(readText(path.join(dir, 'instance.cfg')) ?? '')?.[1]?.trim() || path.basename(dir);
  const gameDir = ['minecraft', '.minecraft'].map((n) => path.join(dir, n)).find((d) => fs.existsSync(d));
  return {
    launcher,
    name,
    dir: gameDir ?? path.join(dir, '.minecraft'),
    mc: component('net.minecraft')?.version ?? null,
    fabric: !!component('net.fabricmc.fabric-loader'),
  };
}

function prism(root) {
  const cfg = readText(path.join(root, 'prismlauncher.cfg')) ?? '';
  const instances = path.resolve(root, /^InstanceDir=(.*)$/m.exec(cfg)?.[1]?.trim() || 'instances');
  return subdirs(instances)
    .map((d) => prismInstance(d))
    .filter(Boolean);
}

function curseforgeInstance(dir) {
  const json = readJson(path.join(dir, 'minecraftinstance.json'));
  if (!json) return null;
  const loader = json.baseModLoader?.name ?? '';
  return {
    launcher: 'CurseForge',
    name: json.name || path.basename(dir),
    dir,
    mc: json.gameVersion ?? null,
    fabric: loader.startsWith('fabric'),
  };
}

function curseforge(root) {
  return subdirs(root).map(curseforgeInstance).filter(Boolean);
}

function modrinth(root) {
  const file = path.join(root, 'app.db');
  if (!fs.existsSync(file)) return [];
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const base = db.prepare('SELECT custom_dir FROM settings').get()?.custom_dir || root;
    return db
      .prepare('SELECT path, name, game_version, mod_loader FROM profiles')
      .all()
      .map((p) => ({
        launcher: 'Modrinth App',
        name: p.name,
        dir: path.join(base, 'profiles', p.path),
        mc: p.game_version,
        fabric: p.mod_loader === 'fabric',
      }));
  } finally {
    db.close();
  }
}

/** A folder the user picked: a Prism or CurseForge instance, or else a plain game folder. */
export function folderInstance(dir) {
  return (
    prismInstance(dir, 'Folder') ??
    prismInstance(path.dirname(dir), 'Folder') ??
    curseforgeInstance(dir) ?? { launcher: 'Folder', name: path.basename(dir), dir, mc: null, fabric: null }
  );
}

/** Where each launcher keeps its data on this OS. */
export function defaultRoots(home = os.homedir(), platform = process.platform, env = process.env) {
  const appData = env.APPDATA ?? path.join(home, 'AppData', 'Roaming');
  const share = env.XDG_DATA_HOME ?? path.join(home, '.local', 'share');
  const data = (n) =>
    platform === 'darwin'
      ? path.join(home, 'Library', 'Application Support', n)
      : platform === 'win32'
        ? path.join(appData, n)
        : path.join(share, n);
  return {
    vanilla: [
      platform === 'darwin'
        ? data('minecraft')
        : platform === 'win32'
          ? path.join(appData, '.minecraft')
          : path.join(home, '.minecraft'),
    ],
    prism: [
      data('PrismLauncher'),
      path.join(home, '.var', 'app', 'org.prismlauncher.PrismLauncher', 'data', 'PrismLauncher'),
    ],
    modrinth: [data('ModrinthApp')],
    curseforge: [path.join(home, platform === 'darwin' ? 'Documents' : '', 'curseforge', 'minecraft', 'Instances')],
  };
}

const READERS = { vanilla, prism, modrinth, curseforge };

/** Every instance found, each with what blocks the install (if anything) and the mod version it has. */
export function scan(roots, folders, mod) {
  const found = [];
  for (const [kind, dirs] of Object.entries(roots)) {
    for (const root of dirs) {
      try {
        found.push(...READERS[kind](root));
      } catch (e) {
        console.warn(`Skipping ${kind} instances in ${root}:`, e.message);
      }
    }
  }
  found.push(...folders.map(folderInstance));

  const seen = new Set();
  return found
    .filter((i) => !seen.has(`${i.dir}\0${i.name}`) && seen.add(`${i.dir}\0${i.name}`))
    .map((i) => {
      const all = jars(i.dir);
      const has = (id) => all.some((j) => j.ids.includes(id));
      const blocker =
        i.fabric === false
          ? 'Not a Fabric instance'
          : i.mc && mod && !mcMatches(i.mc, mod.mc)
            ? `Minecraft ${i.mc}. Litescape needs ${mcBase(mod.mc)}.`
            : null;
      return {
        ...i,
        blocker,
        installed: all.find((j) => j.ids.includes(MOD_ID))?.version ?? null,
        missing: DEPS.filter((d) => !has(d)),
      };
    })
    .sort((a, b) => (a.blocker ? 1 : 0) - (b.blocker ? 1 : 0) || a.name.localeCompare(b.name));
}

/** Puts the bundled jar in the instance and removes any other copy of the mod, so Fabric never sees two. */
export function install(dir, mod) {
  const modsDir = path.join(dir, 'mods');
  fs.mkdirSync(modsDir, { recursive: true });
  const target = path.join(modsDir, path.basename(mod.file));
  const part = `${target}.part`; // not a .jar, so a half-copied file is never loaded
  fs.copyFileSync(mod.file, part);
  try {
    uninstall(dir);
    fs.renameSync(part, target);
  } catch (e) {
    fs.rmSync(part, { force: true });
    throw e;
  }
}

export function uninstall(dir) {
  for (const j of jars(dir)) if (j.ids.includes(MOD_ID)) fs.rmSync(j.file);
}

async function get(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status}`);
  return res;
}

/** Downloads the newest Fabric build of each dependency the instance lacks from Modrinth, checking its hash. */
export async function installDeps(dir, mc) {
  const modsDir = path.join(dir, 'mods');
  fs.mkdirSync(modsDir, { recursive: true });
  const have = jars(dir).flatMap((j) => j.ids);
  for (const slug of DEPS.filter((d) => !have.includes(d))) {
    const q = new URLSearchParams({ loaders: '["fabric"]', game_versions: JSON.stringify([mc]) });
    const versions = await (await get(`https://api.modrinth.com/v2/project/${slug}/version?${q}`)).json();
    // Newest first, betas included: Fabric API's build for a new Minecraft version is often still marked beta.
    const file = versions[0]?.files.find((f) => f.primary) ?? versions[0]?.files[0];
    if (!file) throw new Error(`Modrinth has no ${slug} for Minecraft ${mc} yet`);
    const data = Buffer.from(await (await get(file.url)).arrayBuffer());
    if (crypto.createHash('sha512').update(data).digest('hex') !== file.hashes.sha512) {
      throw new Error(`${file.filename} from Modrinth failed its checksum`);
    }
    const target = path.join(modsDir, `${path.basename(file.filename, '.jar')}.jar`);
    fs.writeFileSync(`${target}.part`, data);
    fs.renameSync(`${target}.part`, target);
  }
}

/** Adds a "Litescape" Fabric profile with its own game folder to the Minecraft Launcher, like Fabric's installer. */
export async function createInstance(root, mc) {
  const file = path.join(root, 'launcher_profiles.json');
  const json = readJson(file);
  if (!json) throw new Error('Minecraft Launcher not found. Install it and open it once, then try again');
  const meta = `https://meta.fabricmc.net/v2/versions/loader/${mc}`;
  const loaders = await (await get(meta)).json();
  const loader = (loaders.find((l) => l.loader.stable) ?? loaders[0])?.loader.version;
  if (!loader) throw new Error(`Fabric doesn't support Minecraft ${mc} yet`);
  const profile = await (await get(`${meta}/${loader}/profile/json`)).json();
  const versionDir = path.join(root, 'versions', profile.id);
  fs.mkdirSync(versionDir, { recursive: true });
  fs.writeFileSync(path.join(versionDir, `${profile.id}.json`), JSON.stringify(profile, null, 2));
  fs.writeFileSync(path.join(versionDir, `${profile.id}.jar`), ''); // Fabric's installer leaves the same empty jar

  const gameDir = path.join(root, 'litescape');
  const now = new Date().toISOString();
  json.profiles ??= {};
  json.profiles.litescape = {
    created: now,
    ...json.profiles.litescape,
    name: 'Litescape',
    type: 'custom',
    lastUsed: now,
    lastVersionId: profile.id,
    gameDir,
  };
  fs.writeFileSync(file, JSON.stringify(json, null, 2));
  fs.mkdirSync(gameDir, { recursive: true });
  return gameDir;
}
