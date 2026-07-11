const { contextBridge, ipcRenderer } = require('electron');

// Minimal surface for the in-app update flow: download the installer to a
// temp file with progress, then hand off to the OS to run it. Everything
// else the renderer needs stays fully sandboxed (nodeIntegration: false).
contextBridge.exposeInMainWorld('havoroUpdater', {
  download: (url) => ipcRenderer.invoke('updater:download', url),
  install: (filePath) => ipcRenderer.invoke('updater:install', filePath),
  onProgress: (callback) => {
    const listener = (event, progress) => callback(progress);
    ipcRenderer.on('updater:progress', listener);
    return () => ipcRenderer.removeListener('updater:progress', listener);
  },
});
