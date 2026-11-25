// Dev server for the web app: serves src/client/resources/web plus the API from fixtures
// recorded by `./gradlew runClientGameTest` (build/run/clientGameTest/litweb-fixtures).
// Simulates a build in progress so the live-progress UI can be checked without Minecraft.
//   node web-dev/serve.mjs [port] [fixturesDir]
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';

const root = new URL('../src/client/resources/web/', import.meta.url).pathname;
const port = +(process.argv[2] || 8194);
const fx = process.argv[3] || new URL('../build/run/clientGameTest/litweb-fixtures/', import.meta.url).pathname;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
const json = async (f) => JSON.parse(await readFile(join(fx, f), 'utf8'));

let mode = 'full'; // full | offline | noworld | empty (toggle with /dev?mode=...)
const started = Date.now();
const state = await json('state-3.json');

// Live progress: every 2 s, mark the lowest still-missing blocks as placed.
async function status(file) {
  const s = await json(file);
  const st = Buffer.from(s.status, 'base64');
  const steps = Math.floor((Date.now() - started) / 2000);
  let budget = steps * 25;
  for (let i = 0; i < st.length && budget > 0; i++) if (st[i] === 2) { st[i] = 1; budget--; }
  const counts = [0, 0, 0, 0, 0, 0];
  for (const b of st) counts[b]++;
  counts[0] = 0;
  return { counts, status: st.toString('base64') };
}

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const send = (code, body, type = 'application/json') => {
    res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
  };
  try {
    if (url.pathname === '/dev') { mode = url.searchParams.get('mode') || 'full'; return send(200, { mode }); }
    if (url.pathname.startsWith('/api/') && mode === 'offline') { res.destroy(); return; }
    switch (url.pathname) {
      case '/api/state':
        if (mode === 'noworld') return send(200, { inWorld: false });
        if (mode === 'empty') return send(200, { ...state, selection: undefined, placements: [], shared: [] });
        return send(200, state);
      case '/api/view': {
        await new Promise((r) => setTimeout(r, 250));
        return send(200, await json(`view-${url.searchParams.get('type')}.json`));
      }
      case '/api/status':
        return send(200, await status(`status-${url.searchParams.get('type')}.json`));
      case '/api/share':
      case '/api/unshare':
        await new Promise((r) => setTimeout(r, 600));
        return send(200, {});
    }
    if (url.pathname.startsWith('/tex/')) return send(200, await readFile(join(fx, normalize(url.pathname)) + '.png'), 'image/png');
    const file = join(root, normalize(url.pathname === '/' ? '/index.html' : url.pathname));
    send(200, await readFile(file), types[extname(file)] || 'application/octet-stream');
  } catch (e) {
    send(404, { error: String(e.message) });
  }
}).listen(port, '127.0.0.1', () => console.log(`http://127.0.0.1:${port}/`));
