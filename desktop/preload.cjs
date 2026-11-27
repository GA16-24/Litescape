const { contextBridge, ipcRenderer } = require('electron');

// main.js only answers these from the bundled pages (waiting, settings, server).
contextBridge.exposeInMainWorld('litescape', {
  instances: () => ipcRenderer.invoke('instances'),
  install: (dir) => ipcRenderer.invoke('install', dir),
  uninstall: (dir) => ipcRenderer.invoke('uninstall', dir),
  createInstance: () => ipcRenderer.invoke('create-instance'),
  addFolder: () => ipcRenderer.invoke('add-folder'),
  folders: () => ipcRenderer.invoke('folders'),
  removeFolder: (dir) => ipcRenderer.invoke('remove-folder', dir),
  openServer: () => ipcRenderer.invoke('open-server'),
  openFarm: () => ipcRenderer.invoke('open-farm'),
  server: () => ipcRenderer.invoke('server'),
  startServer: (agree) => ipcRenderer.invoke('server-start', agree),
  stopServer: () => ipcRenderer.invoke('server-stop'),
  serverCommand: (cmd) => ipcRenderer.invoke('server-command', cmd),
  serverFolder: () => ipcRenderer.invoke('server-folder'),
  onServer: (fn) => ipcRenderer.on('server', (_e, msg) => fn(msg)),
});
