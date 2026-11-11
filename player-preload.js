const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('argusPlayer', {
  report: (key, pos, dur) => ipcRenderer.send('player:progress', key, pos, dur),
});
