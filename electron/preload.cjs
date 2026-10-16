const { contextBridge, ipcRenderer } = require('electron');
// No arbitrary IPC, file access, shell commands, or Node APIs reach the renderer.
contextBridge.exposeInMainWorld('driskord', {
  storage: {
    getItem: key => ipcRenderer.sendSync('client-state:get', key),
    setItem: (key, value) => ipcRenderer.sendSync('client-state:set', key, value),
    removeItem: key => ipcRenderer.sendSync('client-state:set', key, null),
  },
});
