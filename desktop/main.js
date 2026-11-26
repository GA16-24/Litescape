import fs from 'node:fs';
import path from 'node:path';
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import {
  bundledMod,
  createInstance,
  defaultRoots,
  install,
  installDeps,
  mcBase,
  scan,
  uninstall,
} from './instances.js';

// The mod serves the viewer on the first free port in 8723-8732 (WebServer.java).
const PORTS = Array.from({ length: 10 }, (_, i) => 8723 + i);

async function alive(url) {
  try {
    // The header tells the game this app is installed, so /litweb opens it instead of a browser tab.
    const res = await fetch(`${url}api/state`, {
      headers: { 'X-Litescape-App': '1' },
      signal: AbortSignal.timeout(1000),
    });
    return res.ok;
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

// macOS: the traffic lights sit in the viewer's top row, like T3 Code, so that row drags the window.
// Selectors beat style.css on specificity, since Electron puts this sheet before it in the cascade.
const MAC_CHROME = `
  .brand, .topbar { -webkit-app-region: drag; height: 52px; box-sizing: border-box; }
  .sidebar .brand { padding: 0 14px 0 84px; }
  .app.no-sidebar .topbar { padding-left: 84px; }
  button, input, select, a, [role=button], [tabindex] { -webkit-app-region: no-drag; }
`;

function openOutside(url) {
  if (/^https?:/.test(url)) shell.openExternal(url);
}

// The game opens litescape://open from /litweb and its chat link. A second launch hands off to this window.
if (!app.requestSingleInstanceLock()) app.exit();
if (app.isPackaged) app.setAsDefaultProtocolClient('litescape');
let win = null;
function show() {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}
app.on('second-instance', show);
app.on('open-url', (e) => {
  e.preventDefault();
  show();
});

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
  const mc = mod && mcBase(mod.mc);
  let known = new Map();
  const list = () => {
    const instances = scan(defaultRoots(), folders(), mod);
    // Keeps installed copies current, so updating the app updates the mod. Never downgrades a newer jar.
    for (const i of instances) {
      if (!mod || i.blocker || !i.installed || i.installed.localeCompare(mod.version, 'en', { numeric: true }) >= 0)
        continue;
      try {
        install(i.dir, mod);
        i.installed = mod.version;
      } catch (e) {
        console.warn(`Couldn't update the mod in ${i.dir}:`, e.message); // usually the game has the jar open
      }
    }
    // Profiles can share a folder. Reversed so the first row wins, and scan sorts the installable ones first.
    known = new Map(instances.toReversed().map((i) => [i.dir, i]));
    return { mod: mod && { version: mod.version }, instances };
  };
  // Only folders from the last scan, so the page can't write mods anywhere else.
  const checked = (dir) => {
    if (!known.has(dir)) throw new Error('Unknown instance folder');
    return known.get(dir);
  };
  // Dependencies first: Litescape alone stops the game from starting if Fabric API is missing.
  const installAll = async (dir, version) => {
    if (!mod) throw new Error('This build has no mod jar');
    await installDeps(dir, version);
    install(dir, mod);
  };
  handle('instances', list);
  handle('install', async (dir) => {
    const i = checked(dir);
    if (i.blocker) throw new Error(i.blocker);
    await installAll(i.dir, i.mc ?? mc);
    return list();
  });
  handle('create-instance', async () => {
    if (!mc) throw new Error('This build has no mod jar');
    await installAll(await createInstance(defaultRoots().vanilla[0], mc), mc);
    return list();
  });
  handle('uninstall', (dir) => {
    uninstall(checked(dir).dir);
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
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    title: 'Litescape',
    backgroundColor: '#171a21',
    ...(process.platform === 'darwin' && { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 18, y: 20 } }),
    webPreferences: { preload: path.join(import.meta.dirname, 'preload.cjs') },
  });
  setupInstaller(win);
  if (process.platform === 'darwin') win.webContents.on('dom-ready', () => win.webContents.insertCSS(MAC_CHROME));
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
