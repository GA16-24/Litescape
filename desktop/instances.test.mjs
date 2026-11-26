// Run with: node --test desktop/instances.test.mjs
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import zlib from 'node:zlib';
import {
  bundledMods,
  createInstance,
  install,
  installDeps,
  mcMatches,
  scan,
  shouldUpdate,
  uninstall,
} from './instances.js';

// A minimal deflated zip; the reader ignores CRCs.
function jar(file, modJson) {
  const name = Buffer.from('fabric.mod.json');
  const data = zlib.deflateRawSync(JSON.stringify(modJson));
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt16LE(name.length, 28);
  const cdSize = central.length + name.length;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt32LE(cdSize, 12);
  end.writeUInt32LE(local.length + name.length + data.length, 16);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.concat([local, name, data, central, name, end]));
}

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content));
}

test('mcMatches', () => {
  assert.ok(mcMatches('26.3', '~26.3'));
  assert.ok(mcMatches('26.3.1', '~26.3'));
  assert.ok(!mcMatches('26.30', '~26.3'));
  assert.ok(!mcMatches('26.4', '~26.3'));
  assert.ok(!mcMatches('1.21.11', '~26.3'));
  assert.ok(mcMatches('1.21.11', undefined));
  for (const v of ['1.21.6', '1.21.7', '1.21.8']) assert.ok(mcMatches(v, '>=1.21.6 <=1.21.8'), v);
  for (const v of ['1.21.5', '1.21.9', '1.21.10', '26.1']) assert.ok(!mcMatches(v, '>=1.21.6 <=1.21.8'), v);
  assert.ok(mcMatches('1.21.4', '1.21.4'));
  assert.ok(!mcMatches('1.21.40', '1.21.4'));
  assert.ok(!mcMatches('25w45a', '~26.3'));
});

test('shouldUpdate never downgrades and replaces a jar for another Minecraft line', () => {
  assert.ok(shouldUpdate('0.2.0', '0.3.0+26.3'));
  assert.ok(shouldUpdate('0.3.0', '0.3.0+26.3'));
  assert.ok(shouldUpdate('0.3.0+1.21.9', '0.3.0+1.21.6'));
  assert.ok(!shouldUpdate('0.3.0+26.3', '0.3.0+26.3'));
  assert.ok(!shouldUpdate('0.4.0+26.3', '0.3.0+26.3'));
  assert.ok(!shouldUpdate(null, '0.3.0+26.3'));
});

test('finds instances in each launcher and installs only where the mod can load', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'litescape-'));
  const libs = path.join(tmp, 'libs');
  jar(path.join(libs, 'litescape-0.2.0+26.3.jar'), {
    id: 'litweb',
    version: '0.2.0+26.3',
    depends: { minecraft: '~26.3' },
  });
  jar(path.join(libs, 'litescape-0.2.0+1.21.11.jar'), {
    id: 'litweb',
    version: '0.2.0+1.21.11',
    depends: { minecraft: '1.21.11' },
  });
  jar(path.join(libs, 'litescape-0.1.9+26.3.jar'), {
    id: 'litweb',
    version: '0.1.9+26.3',
    depends: { minecraft: '~26.3' },
  });
  write(path.join(libs, 'litescape-0.2.0+26.3-sources.jar'), 'not a mod');
  const mods = bundledMods(libs);
  assert.deepEqual(mods.map((m) => m.version).sort(), ['0.1.9+26.3', '0.2.0+1.21.11', '0.2.0+26.3']);

  // Prism: one ready instance (with an old copy of the mod under another name), one on the wrong version.
  const prism = path.join(tmp, 'prism');
  write(path.join(prism, 'prismlauncher.cfg'), 'InstanceDir=inst\n');
  const ready = path.join(prism, 'inst', 'build', '.minecraft');
  write(path.join(prism, 'inst', 'build', 'instance.cfg'), 'name=Build world\n');
  write(path.join(prism, 'inst', 'build', 'mmc-pack.json'), {
    components: [
      { uid: 'net.minecraft', version: '26.3' },
      { uid: 'net.fabricmc.fabric-loader', version: '0.20.1' },
    ],
  });
  jar(path.join(ready, 'mods', 'fabric-api.jar'), { id: 'fabric-api', version: '0.167.0' });
  jar(path.join(ready, 'mods', 'litematica.jar'), { id: 'litematica', version: '0.29.1' });
  jar(path.join(ready, 'mods', 'old-viewer.jar'), { id: 'litweb', version: '0.1.0' });
  write(path.join(prism, 'inst', 'old', 'mmc-pack.json'), {
    components: [
      { uid: 'net.minecraft', version: '1.21.11' },
      { uid: 'net.fabricmc.fabric-loader', version: '0.18.4' },
    ],
  });
  write(path.join(prism, 'inst', 'ancient', 'mmc-pack.json'), {
    components: [
      { uid: 'net.minecraft', version: '1.20.4' },
      { uid: 'net.fabricmc.fabric-loader', version: '0.15.0' },
    ],
  });

  // Folders added by hand: one that only says its version through Fabric API's, one that says nothing.
  const folder = path.join(tmp, 'my-pack');
  jar(path.join(folder, 'mods', 'fabric-api.jar'), { id: 'fabric-api', version: '0.141.6+1.21.11' });
  const bare = path.join(tmp, 'bare');
  fs.mkdirSync(bare);

  // CurseForge: a Forge instance. The BOM is what the CurseForge app writes.
  const cf = path.join(tmp, 'cf');
  write(
    path.join(cf, 'Forge pack', 'minecraftinstance.json'),
    `﻿${JSON.stringify({ name: 'Forge pack', gameVersion: '26.3', baseModLoader: { name: 'forge-60.0.1' } })}`,
  );

  // Modrinth App: a Fabric profile without Fabric API, in a custom data folder.
  const mr = path.join(tmp, 'modrinth');
  const custom = path.join(tmp, 'modrinth-data');
  fs.mkdirSync(mr);
  const db = new DatabaseSync(path.join(mr, 'app.db'));
  db.exec(
    'CREATE TABLE settings (custom_dir TEXT); CREATE TABLE profiles (path TEXT, name TEXT, game_version TEXT, mod_loader TEXT)',
  );
  db.prepare('INSERT INTO settings VALUES (?)').run(custom);
  db.prepare('INSERT INTO profiles VALUES (?, ?, ?, ?)').run('fo', 'Fabulously Optimized', '26.3', 'fabric');
  db.close();

  // Vanilla launcher: a Fabric profile in its own folder, plus the default profile, which is skipped.
  const mc = path.join(tmp, 'minecraft');
  const vanillaDir = path.join(tmp, 'vanilla-fabric');
  write(path.join(mc, 'launcher_profiles.json'), {
    profiles: {
      a: { name: '', type: 'latest-release', lastVersionId: 'latest-release' },
      b: { name: 'fabric', type: 'custom', lastVersionId: 'fabric-loader-0.20.1-26.3', gameDir: vanillaDir },
    },
  });
  jar(path.join(vanillaDir, 'mods', 'fapi.jar'), { id: 'fabric-api-base', provides: ['fabric-api'] });

  const roots = { vanilla: [mc], prism: [prism], modrinth: [mr], curseforge: [cf, path.join(tmp, 'missing')] };
  const byName = () => Object.fromEntries(scan(roots, [folder, bare], mods).map((i) => [i.name, i]));
  let found = byName();
  assert.deepEqual(Object.keys(found).sort(), [
    'Build world',
    'Fabulously Optimized',
    'Forge pack',
    'ancient',
    'bare',
    'fabric',
    'my-pack',
    'old',
  ]);
  assert.equal(found['Build world'].blocker, null);
  assert.equal(found['Build world'].mod.version, '0.2.0+26.3');
  assert.equal(found['Build world'].installed, '0.1.0');
  assert.equal(found['Build world'].dir, ready);
  assert.equal(found.fabric.blocker, null);
  assert.deepEqual(found.fabric.missing, ['malilib', 'litematica']);
  assert.equal(found.old.blocker, null);
  assert.equal(found.old.mod.version, '0.2.0+1.21.11');
  assert.equal(found.ancient.blocker, 'Minecraft 1.20.4. Litescape needs 1.21.11 to 26.3.');
  assert.equal(found['my-pack'].mc, '1.21.11');
  assert.equal(found['my-pack'].mod.version, '0.2.0+1.21.11');
  assert.match(found.bare.blocker, /Can't tell which Minecraft version/);
  assert.equal(found['Forge pack'].blocker, 'Not a Fabric instance');
  assert.equal(found['Fabulously Optimized'].blocker, null);
  assert.deepEqual(found['Fabulously Optimized'].missing, ['fabric-api', 'malilib', 'litematica']);
  assert.equal(found['Fabulously Optimized'].dir, path.join(custom, 'profiles', 'fo'));

  install(ready, found['Build world'].mod);
  assert.deepEqual(fs.readdirSync(path.join(ready, 'mods')).sort(), [
    'fabric-api.jar',
    'litematica.jar',
    'litescape-0.2.0+26.3.jar',
  ]);
  found = byName();
  assert.equal(found['Build world'].installed, '0.2.0+26.3');

  install(vanillaDir, found.fabric.mod);
  uninstall(vanillaDir);
  assert.deepEqual(fs.readdirSync(path.join(vanillaDir, 'mods')), ['fapi.jar']);

  fs.rmSync(tmp, { recursive: true });
});

test('creates a Minecraft Launcher instance and downloads the dependencies it lacks', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'litescape-'));
  const files = {};
  for (const id of ['fabric-api', 'malilib', 'litematica']) {
    jar(path.join(tmp, 'cdn', `${id}.jar`), { id, version: '1.0.0' });
    files[`https://cdn.modrinth.com/${id}.jar`] = fs.readFileSync(path.join(tmp, 'cdn', `${id}.jar`));
  }
  const sha512 = (b) => crypto.createHash('sha512').update(b).digest('hex');
  let corrupt = false;
  let profileId = '../../evil';
  t.mock.method(globalThis, 'fetch', async (url) => {
    const u = new URL(url);
    const json = (body) => new Response(JSON.stringify(body));
    if (u.host === 'meta.fabricmc.net') {
      return u.pathname.endsWith('/profile/json')
        ? json({ id: profileId, inheritsFrom: '26.3' })
        : json([
            { loader: { version: '0.21.0-beta', stable: false } },
            { loader: { version: '0.20.1', stable: true } },
          ]);
    }
    if (u.host === 'api.modrinth.com') {
      assert.equal(u.searchParams.get('game_versions'), '["26.3"]');
      const slug = u.pathname.split('/')[3];
      const fileUrl = `https://cdn.modrinth.com/${slug}.jar`;
      const hash = corrupt ? 'bad' : sha512(files[fileUrl]);
      return json([
        {
          version_type: 'release',
          files: [{ primary: true, url: fileUrl, filename: `${slug}.jar`, hashes: { sha512: hash } }],
        },
      ]);
    }
    return files[url] ? new Response(files[url]) : new Response('', { status: 404 });
  });

  const mc = path.join(tmp, 'minecraft');
  await assert.rejects(createInstance(mc, '26.3'), /Minecraft Launcher not found/);
  write(path.join(mc, 'launcher_profiles.json'), { profiles: { other: { name: 'Mine', lastVersionId: '26.3' } } });
  await assert.rejects(createInstance(mc, '26.3'), /expected fabric-loader-0.20.1-26.3/);
  profileId = 'fabric-loader-0.20.1-26.3';
  const dir = await createInstance(mc, '26.3');
  assert.equal(dir, path.join(mc, 'litescape'));
  const profiles = JSON.parse(fs.readFileSync(path.join(mc, 'launcher_profiles.json'), 'utf8')).profiles;
  assert.equal(profiles.other.name, 'Mine');
  assert.equal(profiles.litescape.lastVersionId, 'fabric-loader-0.20.1-26.3');
  assert.ok(fs.existsSync(path.join(mc, 'versions', 'fabric-loader-0.20.1-26.3', 'fabric-loader-0.20.1-26.3.json')));

  corrupt = true;
  await assert.rejects(installDeps(dir, '26.3'), /failed its checksum/);
  assert.deepEqual(fs.readdirSync(path.join(dir, 'mods')), []);
  corrupt = false;
  jar(path.join(dir, 'mods', 'my-fapi.jar'), { id: 'fabric-api', version: '0.1.0' });
  await installDeps(dir, '26.3');
  assert.deepEqual(fs.readdirSync(path.join(dir, 'mods')).sort(), ['litematica.jar', 'malilib.jar', 'my-fapi.jar']);

  const [litescape] = scan({ vanilla: [mc] }, [], []).filter((i) => i.name === 'Litescape');
  assert.equal(litescape.blocker, null);
  assert.deepEqual(litescape.missing, []);
  fs.rmSync(tmp, { recursive: true });
});
