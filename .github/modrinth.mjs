// Pushes README.md and the mod icon to the Modrinth project page. .github/workflows/modrinth.yml runs it on main.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const REPO = 'https://github.com/GA16-24/Litescape/blob/main/';
const RAW = 'https://raw.githubusercontent.com/GA16-24/Litescape/main/';
const API = 'https://api.modrinth.com/v2/project/litescape';

// Modrinth has no repo to resolve relative paths against: images load from raw, other files open on GitHub.
export function absoluteLinks(md) {
  return md.replace(
    /(\]\(|(?:href|src|srcset)=")(?!https?:|#|mailto:)(?:\.\/)?([^)"\s]+)/g,
    (_, lead, path) => lead + (/\.(png|jpe?g|gif|svg|webp)$/i.test(path) ? RAW : REPO) + path,
  );
}

async function patch(path, type, body) {
  const res = await fetch(API + path, {
    method: 'PATCH',
    headers: {
      Authorization: process.env.MODRINTH_TOKEN,
      'Content-Type': type,
      'User-Agent': 'GA16-24/Litescape (.github/modrinth.mjs)',
    },
    body,
  });
  if (!res.ok) throw new Error(`PATCH ${API}${path}: ${res.status} ${await res.text()}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (!process.env.MODRINTH_TOKEN) throw new Error('MODRINTH_TOKEN is not set');
  await patch('', 'application/json', JSON.stringify({ body: absoluteLinks(readFileSync('README.md', 'utf8')) }));
  await patch('/icon?ext=png', 'image/png', readFileSync('src/main/resources/assets/litweb/icon.png'));
}
