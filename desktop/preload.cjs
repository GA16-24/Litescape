const { contextBridge, ipcRenderer } = require('electron');

// main.js only answers these from the bundled pages (waiting, settings).
contextBridge.exposeInMainWorld('litescape', {
  instances: () => ipcRenderer.invoke('instances'),
  install: (dir) => ipcRenderer.invoke('install', dir),
  uninstall: (dir) => ipcRenderer.invoke('uninstall', dir),
  createInstance: () => ipcRenderer.invoke('create-instance'),
  addFolder: () => ipcRenderer.invoke('add-folder'),
  folders: () => ipcRenderer.invoke('folders'),
  removeFolder: (dir) => ipcRenderer.invoke('remove-folder', dir),
});
