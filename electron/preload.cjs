const { contextBridge, ipcRenderer } = require('electron');
// No arbitrary IPC, file access, shell commands, or Node APIs reach the renderer.
contextBridge.exposeInMainWorld('campfire', {
    updates: {
        getState: () => ipcRenderer.invoke('updates:state'),
        check: () => ipcRenderer.invoke('updates:check'),
        install: () => ipcRenderer.invoke('updates:install'),
        subscribe: (callback) => {
            const listener = (_event, state) => callback(state);
            ipcRenderer.on('updates:changed', listener);
            return () => ipcRenderer.removeListener('updates:changed', listener);
        },
    },
    avatars: {
        read: (key) => ipcRenderer.invoke('avatars:read', key),
        write: (key, bytes) => ipcRenderer.invoke('avatars:write', key, bytes),
    },
    readClipboardAttachments: (limit) => ipcRenderer.invoke('clipboard:attachments', limit),
    getIdleState: () => ipcRenderer.invoke('presence:idle-state'),
    insecureHttp: {
        isAllowed: (origin) => ipcRenderer.sendSync('http:is-allowed', origin),
        setAllowed: (origin, enabled) => ipcRenderer.invoke('http:set-allowed', origin, enabled),
    },
    pins: {
        check: (origin) => ipcRenderer.invoke('pins:check', origin),
        get: (origin) => ipcRenderer.invoke('pins:get', origin),
        trust: (origin, fingerprint) => ipcRenderer.invoke('pins:trust', origin, fingerprint),
        forget: (origin) => ipcRenderer.invoke('pins:forget', origin),
    },
    storage: {
        getItem: (key) => ipcRenderer.sendSync('client-state:get', key),
        setItem: (key, value) => ipcRenderer.sendSync('client-state:set', key, value),
        removeItem: (key) => ipcRenderer.sendSync('client-state:set', key, null),
    },
});
