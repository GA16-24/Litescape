import fs from 'node:fs';
import path from 'node:path';
import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron';
import { setupFarm } from './farmwindow.js';
import {
  bundledMods,
  createInstance,
  defaultRoots,
  install,
  installDeps,
  mcBase,
  mcBases,
  modFor,
  scan,
  shouldUpdate,
  uninstall,
} from './instances.js';
import { acceptEula, eulaAccepted, findJava, javaDirs, LocalServer } from './localserver.js';

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
  button, input, select, a, dialog, [role=button], [tabindex] { -webkit-app-region: no-drag; }
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
function saveFolders(list) {
  fs.mkdirSync(path.dirname(FOLDERS()), { recursive: true });
  fs.writeFileSync(FOLDERS(), JSON.stringify(list));
}

// The installer and server API is for the bundled pages (waiting, settings, server) only, never the viewer page loaded from a local port.
function handle(channel, fn) {
  ipcMain.handle(channel, (e, ...args) => {
    if (!e.senderFrame?.url.startsWith('file:')) throw new Error('Not allowed from this page');
    return fn(...args);
  });
}

function setupInstaller(win) {
  const mods = bundledMods(MOD_DIR);
  // New instances get the newest Minecraft version the app has a jar for.
  const newest = mcBases(mods).at(-1);
  // Every jar carries the same mod version, followed by +<Minecraft line>.
  const version = mods[0]?.version.split('+')[0];
  let known = new Map();
  const list = () => {
    const instances = scan(defaultRoots(), folders(), mods);
    // Keeps installed copies current and on the right Minecraft line, so updating the app updates the mod.
    for (const i of instances) {
      if (i.blocker || !i.mod || !shouldUpdate(i.installed, i.mod.version)) continue;
      try {
        install(i.dir, i.mod);
        i.installed = i.mod.version;
      } catch (e) {
        console.warn(`Couldn't update the mod in ${i.dir}:`, e.message); // usually the game has the jar open
      }
    }
    // Profiles can share a folder. Reversed so the first row wins, and scan sorts the installable ones first.
    known = new Map(instances.toReversed().map((i) => [i.dir, i]));
    return { mod: version && { version }, instances };
  };
  // Only folders from the last scan, so the page can't write mods anywhere else.
  const checked = (dir) => {
    if (!known.has(dir)) throw new Error('Unknown instance folder');
    return known.get(dir);
  };
  // Dependencies first: Litescape alone stops the game from starting if Fabric API is missing.
  const installAll = async (dir, mc) => {
    const mod = modFor(mods, mc);
    if (!mod) throw new Error(`This build has no mod jar for Minecraft ${mc}`);
    await installDeps(dir, mc);
    install(dir, mod);
  };
  handle('instances', list);
  handle('install', async (dir) => {
    const i = checked(dir);
    if (i.blocker) throw new Error(i.blocker);
    await installAll(i.dir, i.mc);
    return list();
  });
  handle('create-instance', async () => {
    if (!newest) throw new Error('This build has no mod jar');
    await installAll(await createInstance(defaultRoots().vanilla[0], newest), newest);
    return list();
  });
  handle('uninstall', (dir) => {
    uninstall(checked(dir).dir);
    return list();
  });
  handle('add-folder', async () => {
    // Attach to the window that asked: the waiting page or the settings window.
    const { canceled, filePaths } = await dialog.showOpenDialog(BrowserWindow.getFocusedWindow() ?? win, {
      title: 'Choose a Minecraft instance folder',
      properties: ['openDirectory'],
    });
    if (!canceled) saveFolders([...new Set([...folders(), filePaths[0]])]);
    return list();
  });
  handle('folders', folders);
  handle('remove-folder', (dir) => {
    saveFolders(folders().filter((f) => f !== dir));
    return folders();
  });
  setupServer(modFor(mods, newest), mods); // the test server runs the newest Minecraft the app has a jar for
}

const SERVER_DIR = () => path.join(app.getPath('userData'), 'server');
let serverWin = null;
const server = new LocalServer(
  (msg) => serverWin?.isDestroyed() === false && serverWin.webContents.send('server', msg),
);

let openFarm = () => {};
function setupServer(mod, mods) {
  const startServer = async () => {
    if (!mod) throw new Error('This build has no mod jar');
    if (!eulaAccepted(SERVER_DIR())) throw new Error('Agree to the Minecraft EULA first');
    const need = mcBase(mod.mc).startsWith('1.') ? 21 : 25; // 1.21.x launchers ship Java 21, 26.x needs 25
    const java = await findJava(javaDirs(defaultRoots()), need);
    if (!java)
      throw new Error(
        `The server needs Java ${need}. Start Minecraft ${mcBase(mod.mc)} once so your launcher downloads it, or install Java ${need}`,
      );
    await server.start(SERVER_DIR(), mod, java.bin);
  };
  // Scanning reads every mod jar, so the farm window's file list rescans the instances at most every 30 seconds.
  let dirs = { at: 0, list: [] };
  const instanceDirs = () => {
    if (Date.now() - dirs.at > 30000)
      dirs = { at: Date.now(), list: scan(defaultRoots(), folders(), mods).map((i) => i.dir) };
    return dirs.list;
  };
  openFarm = setupFarm({ mod, server, serverDir: SERVER_DIR, startServer, instanceDirs, openOutside });
  handle('open-farm', openFarm);
  handle('open-server', openServer);
  handle('server', () => ({
    state: server.state,
    log: server.log,
    eula: eulaAccepted(SERVER_DIR()),
    load: server.load,
  }));
  handle('server-start', async (agree) => {
    if (agree === true) acceptEula(SERVER_DIR());
    await startServer();
  });
  handle('server-stop', () => server.stop());
  handle('server-command', (cmd) => server.send(cmd));
  handle('server-folder', () => {
    fs.mkdirSync(SERVER_DIR(), { recursive: true });
    return shell.openPath(SERVER_DIR());
  });
}

function openServer() {
  if (serverWin && !serverWin.isDestroyed()) return serverWin.focus();
  serverWin = new BrowserWindow({
    width: 760,
    height: 640,
    title: 'Test Server',
    fullscreenable: false,
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(import.meta.dirname, 'preload.cjs') },
  });
  serverWin.webContents.setWindowOpenHandler(({ url }) => {
    openOutside(url);
    return { action: 'deny' };
  });
  serverWin.loadFile('server.html');
}

let settingsWin = null;
function openSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) return settingsWin.focus();
  settingsWin = new BrowserWindow({
    parent: win,
    width: 600,
    height: 460,
    title: 'Settings',
    minimizable: false,
    fullscreenable: false,
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(import.meta.dirname, 'preload.cjs') },
  });
  settingsWin.loadFile('settings.html');
}

function setupMenu() {
  const settings = { label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: openSettings };
  const testServer = { label: 'Test Server…', accelerator: 'CmdOrCtrl+Shift+S', click: openServer };
  const farmTest = { label: 'Farm Test…', accelerator: 'CmdOrCtrl+Shift+F', click: () => openFarm() };
  const first =
    process.platform === 'darwin'
      ? {
          label: app.name,
          submenu: [
            { role: 'about' },
            { type: 'separator' },
            settings,
            farmTest,
            testServer,
            { type: 'separator' },
            { role: 'services' },
            { type: 'separator' },
            { role: 'hide' },
            { role: 'hideOthers' },
            { role: 'unhide' },
            { type: 'separator' },
            { role: 'quit' },
          ],
        }
      : { label: 'File', submenu: [settings, farmTest, testServer, { type: 'separator' }, { role: 'quit' }] };
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([first, { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' }]),
  );
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
  setupMenu();
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
// Quitting saves and stops the test server first, so its world isn't cut off mid-write.
app.on('before-quit', (e) => {
  if (!server.running) return;
  e.preventDefault();
  server.stop().then(() => app.quit());
});
