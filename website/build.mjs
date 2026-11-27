// Builds public/demo/: the real viewer from src/client/resources/web, plus the textures and default skins the
// fixtures use, taken from Mojang's client jar so none of Mojang's assets are committed here.
// Run before `wrangler pages deploy` (the website workflow does).
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { readZipEntry } from '../desktop/instances.js';

const at = (p) => new URL(p, import.meta.url);
const sha1 = (data) => createHash('sha1').update(data).digest('hex');
const mc = JSON.parse(readFileSync(at('fixtures/minecraft-assets.json'), 'utf8'));
// The client jar of the Minecraft version the fixtures were recorded on.
const CLIENT_JAR = 'https://piston-data.mojang.com/v1/objects/e877b6a07acd633fb3bb475002175cec036e7b87/client.jar';
const CLIENT_SHA1 = 'e877b6a07acd633fb3bb475002175cec036e7b87';

const jar = at('.cache/client.jar');
let cached = null;
try {
  cached = readFileSync(jar);
} catch {}
if (!cached || sha1(cached) !== CLIENT_SHA1) {
  const res = await fetch(CLIENT_JAR);
  if (!res.ok) throw new Error(`Downloading the Minecraft ${mc.minecraft} client jar failed: HTTP ${res.status}`);
  const data = Buffer.from(await res.arrayBuffer());
  if (sha1(data) !== CLIENT_SHA1) throw new Error(`The Minecraft ${mc.minecraft} client jar doesn't match its SHA-1`);
  mkdirSync(at('.cache/'), { recursive: true });
  writeFileSync(jar, data);
}

rmSync(at('public/demo'), { recursive: true, force: true });
cpSync(at('../src/client/resources/web'), at('public/demo'), { recursive: true });
const extract = (texture, to) => {
  const data = readZipEntry(jar, `assets/minecraft/textures/${texture}`);
  if (!data) throw new Error(`${texture} isn't in the Minecraft ${mc.minecraft} client jar`);
  mkdirSync(new URL('.', at(to)), { recursive: true });
  writeFileSync(at(to), data);
};
for (const t of mc.textures) extract(t, `public/demo/tex/minecraft/${t}`);
for (const [uuid, skin] of Object.entries(mc.skins))
  extract(`entity/player/${skin}.png`, `public/demo/skins/${uuid}.png`);
