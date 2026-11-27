// The Farm Test window: the mod's viewer, served from the bundled mod jar on a private litescape-app:// origin, with an
// API that shows schematic files and runs farm tests on the test server. No network port, so other programs can't use it,
// and only this window's session answers it, so no other page in the app can either.

import fs from 'node:fs';
import path from 'node:path';
import { app, BrowserWindow, dialog, protocol, session } from 'electron';
import { blocksDir, blockTable, jobOf, schematicFiles, viewOf } from './farm.js';
import { mcBase, readZipEntry } from './instances.js';
import { readLitematic } from './litematic.js';
import { acceptEula, eulaAccepted } from './localserver.js';

const SCHEME = 'litescape-app';
const ORIGIN = `${SCHEME}://viewer`;
const PARTITION = 'persist:farm-test'; // persisted, so the viewer keeps its theme and language
// Before app ready: a standard, secure scheme lets the page use fetch, workers and relative URLs like a website.
protocol.registerSchemesAsPrivileged([
  { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

/**
 * mod: the bundled mod jar, from bundledMod(). server: the LocalServer. startServer(): starts it. instanceDirs(): the
 * game folders found, whose schematics/ folders are listed. openOutside(url): opens a link in the browser.
 */
export function setupFarm({ mod, server, serverDir, startServer, instanceDirs, openOutside }) {
  const OPENED = () => path.join(app.getPath('userData'), 'schematics.json');
  const opened = () => {
    try {
      return JSON.parse(fs.readFileSync(OPENED(), 'utf8'));
    } catch {
      return [];
    }
  };
  // The page polls state every second; walking the folders every few seconds is plenty.
  let listed = { at: 0, files: [] };
  const files = () => {
    if (Date.now() - listed.at > 3000)
      listed = {
        at: Date.now(),
        files: schematicFiles(
          instanceDirs().map((d) => path.join(d, 'schematics')),
          opened(),
        ),
      };
    return listed.files;
  };
  const table = () => mod && blockTable(blocksDir(mcBase(mod.mc)));
  let run = null; // the test this window started: { id, state, error }, until the server reports on it

  const farmStatus = () => {
    const f =
      run && run.state === 'sent' && server.farm && (server.farm.id === run.id || server.farm.state === 'error')
        ? server.farm
        : run;
    return { ...(f || {}), server: server.state, load: server.load, eula: eulaAccepted(serverDir()) };
  };

  async function startFarm(q) {
    const file = files().find((f) => f.id === q.get('id'));
    if (!file) return json({ error: 'That schematic file is gone' }, 404);
    const job = jobOf(readLitematic(fs.readFileSync(file.path)), file.id, q);
    if (q.get('agree') === '1') acceptEula(serverDir());
    if (!eulaAccepted(serverDir())) return json({ error: 'Agree to the Minecraft EULA first' }, 409);
    run = { id: file.id, state: 'server' };
    const mine = run;
    (async () => {
      try {
        if (!server.running) await startServer();
        await server.whenRunning();
        fs.mkdirSync(path.join(serverDir(), 'litweb-farm'), { recursive: true });
        fs.writeFileSync(path.join(serverDir(), 'litweb-farm', 'job.json'), JSON.stringify(job));
        if (run !== mine) return; // stopped or replaced while the server started
        server.farm = null;
        mine.state = 'sent';
        server.send('litweb-farm run');
      } catch (e) {
        if (run === mine) run = { id: mine.id, state: 'error', error: e.message };
      }
    })();
    return json(farmStatus());
  }

  async function api(req, url) {
    const post = req.method === 'POST';
    const q = url.searchParams;
    switch (url.pathname) {
      case '/api/state':
        return json({
          app: true,
          inWorld: false,
          servers: [],
          files: files().map(({ id, name, modified }) => ({ id, name, modified })),
        });
      case '/api/view': {
        const file = files().find((f) => f.id === q.get('id'));
        if (!file) return json({ error: 'That schematic file is gone' }, 404);
        const t = table();
        if (!t) return json({ error: 'Start Minecraft with Litescape once, so the app learns how blocks look' }, 409);
        const s = readLitematic(fs.readFileSync(file.path));
        return json({ ...viewOf(s, t, file.id), name: s.name || file.name });
      }
      case '/api/farm':
        return post ? startFarm(q) : json(farmStatus());
      case '/api/farm/stop':
        if (!post) return json({ error: 'Use POST' }, 405);
        if (run?.state === 'sent') server.send('litweb-farm stop');
        else if (run) run = { id: run.id, state: 'stopped' };
        return json(farmStatus());
      case '/api/app/open': {
        if (!post) return json({ error: 'Use POST' }, 405);
        const { canceled, filePaths } = await dialog.showOpenDialog(BrowserWindow.getFocusedWindow(), {
          title: 'Open a schematic',
          filters: [{ name: 'Litematica schematics', extensions: ['litematic'] }],
          properties: ['openFile'],
        });
        if (canceled) return json({});
        fs.writeFileSync(OPENED(), JSON.stringify([...new Set([filePaths[0], ...opened()])].slice(0, 50)));
        listed.at = 0;
        return json({ id: files().find((f) => f.path === filePaths[0])?.id });
      }
      default:
        return json({ error: 'Not available in the app' }, 404);
    }
  }

  function file(url) {
    const rel = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    if (rel.includes('..')) return new Response('Not found', { status: 404 });
    if (rel.startsWith('/tex/')) {
      const t = table();
      if (!t) return new Response('Not found', { status: 404 });
      try {
        return new Response(fs.readFileSync(path.join(t.dir, 'tex', `${rel.slice(5)}.png`)), {
          headers: { 'Content-Type': 'image/png' },
        });
      } catch {
        return new Response('Not found', { status: 404 });
      }
    }
    const data = mod && readZipEntry(mod.file, `web${rel}`);
    if (!data) return new Response('Not found', { status: 404 });
    return new Response(data, { headers: { 'Content-Type': TYPES[path.extname(rel)] || 'application/octet-stream' } });
  }

  session.fromPartition(PARTITION).protocol.handle(SCHEME, async (req) => {
    const url = new URL(req.url);
    if (url.host !== 'viewer') return new Response('Not found', { status: 404 });
    try {
      return url.pathname.startsWith('/api/') ? await api(req, url) : file(url);
    } catch (e) {
      return json({ error: e.message }, 500);
    }
  });

  let farmWin = null;
  return function openFarm() {
    if (farmWin && !farmWin.isDestroyed()) return farmWin.focus();
    farmWin = new BrowserWindow({
      width: 1280,
      height: 820,
      title: 'Farm Test',
      backgroundColor: '#171a21',
      webPreferences: { partition: PARTITION },
    });
    farmWin.webContents.setWindowOpenHandler(({ url }) => {
      openOutside(url);
      return { action: 'deny' };
    });
    farmWin.webContents.on('will-navigate', (e, url) => {
      if (url.startsWith(ORIGIN)) return;
      e.preventDefault();
      openOutside(url);
    });
    farmWin.loadURL(`${ORIGIN}/index.html`);
  };
}
