function installWindowPolicy(win, shell) {
    win.webContents.setWindowOpenHandler(({ url, frameName }) => {
        if (url === 'about:blank' && frameName.startsWith('campfire-stream-')) {
            return {
                action: 'allow',
                overrideBrowserWindowOptions: {
                    width: 960,
                    height: 600,
                    minWidth: 240,
                    minHeight: 180,
                    resizable: true,
                    autoHideMenuBar: true,
                    backgroundColor: '#211b18',
                    webPreferences: {
                        contextIsolation: true,
                        nodeIntegration: false,
                        sandbox: true,
                        backgroundThrottling: false,
                    },
                },
            };
        }
        try {
            const target = new URL(url);
            if (
                ['http:', 'https:'].includes(target.protocol) &&
                !target.username &&
                !target.password
            )
                void shell.openExternal(target.href).catch(() => {});
        } catch {}
        return { action: 'deny' };
    });
    win.webContents.on('did-create-window', (child) => {
        child.setMenu(null);
        child.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
        child.webContents.on('will-navigate', (event) => event.preventDefault());
    });
}

module.exports = { installWindowPolicy };
