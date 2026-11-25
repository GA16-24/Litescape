// Dev server for the web app: serves src/client/resources/web plus the API from fixtures
// recorded by `./gradlew runClientGameTest` (build/run/clientGameTest/litweb-fixtures).
// Simulates a build in progress so the live-progress UI can be checked without Minecraft.
//   node web-dev/serve.mjs [port] [fixturesDir]
// /api/shaders/* goes to the Java shader API (./gradlew shaderDev, port 8195) since that needs glslang.
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

async function proxyShaders(req, res, send) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  try {
    const r = await fetch(`http://127.0.0.1:${process.env.SHADER_API || 8195}${req.url}`, { method: req.method, body: req.method === 'POST' ? Buffer.concat(chunks) : undefined });
    res.writeHead(r.status, { 'Content-Type': r.headers.get('content-type') || 'application/json', 'Cache-Control': 'no-store' });
    res.end(Buffer.from(await r.arrayBuffer()));
  } catch {
    send(503, { error: "The shader API isn't running. Start it with ./gradlew shaderDev" });
  }
}

// The game test places one block by hand; to show a busy build, pretend two more players help as progress advances.
function withContributors(st) {
  const steps = Math.floor((Date.now() - started) / 2000);
  const shared = st.shared.map((s) => ({
    ...s,
    author: s.author || 'Kestrel_Builds',
    contributors: {
      ...s.contributors,
      'b6d1f0f2-0000-4000-8000-00000000a1ce': { name: 'Alice_Mines', placed: 18 + steps * 15, last: Date.now() - 20_000 },
      '5c2e7a10-0000-4000-8000-000000000b0b': { name: 'bob', placed: 7 + steps * 10, last: Date.now() - 400_000 },
    },
  }));
  return { ...st, shared, placements: st.placements.map((p) => ({ ...p, author: p.author || 'Kestrel_Builds' })) };
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
    if (url.pathname.startsWith('/api/shaders')) return proxyShaders(req, res, send);
    switch (url.pathname) {
      case '/api/state':
        if (mode === 'noworld') return send(200, { inWorld: false });
        if (mode === 'empty') return send(200, { ...state, selection: undefined, placements: [], shared: [] });
        return send(200, withContributors(state));
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
    if (url.pathname === '/api/skin') {
      const id = url.searchParams.get('uuid') || '';
      if (!/^[0-9a-f-]{36}$/.test(id)) return send(400, { error: 'Bad player id' });
      return send(200, await readFile(join(fx, 'skins', id + '.png')), 'image/png');
    }
    if (url.pathname.startsWith('/tex/')) return send(200, await readFile(join(fx, normalize(url.pathname)) + '.png'), 'image/png');
    const file = join(root, normalize(url.pathname === '/' ? '/index.html' : url.pathname));
    send(200, await readFile(file), types[extname(file)] || 'application/octet-stream');
  } catch (e) {
    send(404, { error: String(e.message) });
  }
}).listen(port, '127.0.0.1', () => console.log(`http://127.0.0.1:${port}/`));
