import { app, BrowserWindow, shell } from 'electron';

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

app.whenReady().then(() => {
  let current = null;
  const win = new BrowserWindow({ width: 1440, height: 900, title: 'Litescape', backgroundColor: '#171a21' });
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
