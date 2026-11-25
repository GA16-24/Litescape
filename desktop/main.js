import { app, BrowserWindow, shell } from 'electron';

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

app.whenReady().then(() => {
  let current = null;
  win = new BrowserWindow({ width: 1440, height: 900, title: 'Litescape', backgroundColor: '#171a21' });
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
