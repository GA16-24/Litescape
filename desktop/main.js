import fs from 'node:fs';
import path from 'node:path';
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { bundledMod, defaultRoots, install, scan, uninstall } from './instances.js';

// The mod serves the viewer on the first free port in 8723-8732 (WebServer.java).
const PORTS = Array.from({ length: 10 }, (_, i) => 8723 + i);

async function alive(url) {
  try {
    return (await fetch(`${url}api/state`, { signal: AbortSignal.timeout(1000) })).ok;
  } catch {
    return false;
  }
}

async function findViewer() {
  for (const port of PORTS) {
    const url = `http://127.0.0.1:${port}/`;
    if (await alive(url)) return url;
  }
  return null;
}

function openOutside(url) {
  if (/^https?:/.test(url)) shell.openExternal(url);
}

// Packaged builds carry the mod jar as a resource (see extraResources); `npm start` uses the Gradle output.
const MOD_DIR = app.isPackaged
  ? path.join(process.resourcesPath, 'mod')
  : path.join(import.meta.dirname, '../build/libs');
const FOLDERS = () => path.join(app.getPath('userData'), 'folders.json');

function folders() {
  try {
    return JSON.parse(fs.readFileSync(FOLDERS(), 'utf8'));
  } catch {
    return [];
  }
}

// The installer API is for the bundled waiting page only, never the viewer page loaded from a local port.
function handle(channel, fn) {
  ipcMain.handle(channel, (e, ...args) => {
    if (!e.senderFrame?.url.startsWith('file:')) throw new Error('Not allowed from this page');
    return fn(...args);
  });
}

function setupInstaller(win) {
  const mod = bundledMod(MOD_DIR);
  let known = new Set();
  const list = () => {
    const instances = scan(defaultRoots(), folders(), mod);
    known = new Set(instances.map((i) => i.dir));
    return { mod: mod && { version: mod.version }, instances };
  };
  // Only folders from the last scan, so the page can't write mods anywhere else.
  const checked = (dir) => {
    if (!known.has(dir)) throw new Error('Unknown instance folder');
    return dir;
  };
  handle('instances', list);
  handle('install', (dir) => {
    if (!mod) throw new Error('This build has no mod jar');
    install(checked(dir), mod);
    return list();
  });
  handle('uninstall', (dir) => {
    uninstall(checked(dir));
    return list();
  });
  handle('add-folder', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: 'Choose a Minecraft instance folder',
      properties: ['openDirectory'],
    });
    if (!canceled) {
      fs.mkdirSync(path.dirname(FOLDERS()), { recursive: true });
      fs.writeFileSync(FOLDERS(), JSON.stringify([...new Set([...folders(), filePaths[0]])]));
    }
    return list();
  });
}

app.whenReady().then(() => {
  let current = null;
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    title: 'Litescape',
    backgroundColor: '#171a21',
    webPreferences: { preload: path.join(import.meta.dirname, 'preload.cjs') },
  });
  setupInstaller(win);
  win.webContents.setWindowOpenHandler(({ url }) => {
    openOutside(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (current && url.startsWith(current)) return;
    e.preventDefault();
    openOutside(url);
  });

  // Shows the viewer while the game runs and the waiting page otherwise, following it if it restarts on another port.
  const tick = async () => {
    const url = current && (await alive(current)) ? current : await findViewer();
    if (url !== current) {
      current = url;
      await (url ? win.loadURL(url) : win.loadFile('waiting.html')).catch(() => {});
    }
    if (!win.isDestroyed()) setTimeout(tick, 2000);
  };
  win.loadFile('waiting.html');
  tick();
});

app.on('window-all-closed', () => app.quit());
