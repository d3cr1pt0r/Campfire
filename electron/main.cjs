const {
    app,
    BrowserWindow,
    Menu,
    Tray,
    session,
    desktopCapturer,
    dialog,
    ipcMain,
    safeStorage,
    shell,
    powerMonitor,
    clipboard,
} = require('electron');
const path = require('node:path');
const { clipboardAttachments } = require('./clipboard-files.cjs');
const { createRendererServer, listenRendererServer } = require('./renderer-server.cjs');
const { createClientState } = require('./client-state.cjs');
app.setAppUserModelId('org.driskord.desktop');
let assetServer;
let tray;
let quitting = false;
if (!app.requestSingleInstanceLock()) app.quit();
else {
    app.on('second-instance', () => {
        const win = BrowserWindow.getAllWindows()[0];
        if (win) {
            win.show();
            if (win.isMinimized()) win.restore();
            win.focus();
        }
    });
    app.whenReady()
        .then(async () => {
            Menu.setApplicationMenu(null);
            const clientState = createClientState(app.getPath('userData'), safeStorage);
            assetServer = createRendererServer(path.join(__dirname, '..', 'dist'));
            const rendererPort = await listenRendererServer(
                assetServer,
                Number(clientState.get('rendererPort') || 0),
            );
            clientState.set('rendererPort', JSON.stringify(rendererPort));
            const origin = `http://127.0.0.1:${assetServer.address().port}`;
            const trusted = (url) => {
                try {
                    return new URL(url).origin === origin;
                } catch {
                    return false;
                }
            };
            let readingClipboard = false;
            ipcMain.handle('clipboard:attachments', async (event) => {
                if (!trusted(event.senderFrame?.url)) throw Error('Untrusted clipboard request');
                if (readingClipboard) throw Error('Wait for the previous paste to finish');
                readingClipboard = true;
                try {
                    return await clipboardAttachments(clipboard);
                } finally {
                    readingClipboard = false;
                }
            });
            ipcMain.handle('presence:idle-state', (event) => {
                if (!trusted(event.senderFrame?.url)) return null;
                const state = powerMonitor.getSystemIdleState(60);
                if (state === 'unknown') return null;
                return { seconds: powerMonitor.getSystemIdleTime(), locked: state === 'locked' };
            });
            ipcMain.on('client-state:get', (event, key) => {
                event.returnValue = trusted(event.senderFrame?.url) ? clientState.get(key) : null;
            });
            ipcMain.on('client-state:set', (event, key, value) => {
                try {
                    event.returnValue =
                        trusted(event.senderFrame?.url) && clientState.set(key, value);
                } catch {
                    event.returnValue = false;
                }
            });
            session.defaultSession.setPermissionRequestHandler((wc, permission, callback) =>
                callback(
                    trusted(wc?.getURL()) &&
                        [
                            'media',
                            'display-capture',
                            'notifications',
                            'speaker-selection',
                            'fullscreen',
                        ].includes(permission),
                ),
            );
            session.defaultSession.setPermissionCheckHandler(
                (_wc, permission, requestingOrigin) =>
                    trusted(requestingOrigin) &&
                    [
                        'media',
                        'display-capture',
                        'notifications',
                        'speaker-selection',
                        'fullscreen',
                    ].includes(permission),
            );
            session.defaultSession.setDisplayMediaRequestHandler(
                async (request, callback) => {
                    try {
                        if (!trusted(request.frame?.url)) return callback({});
                        const sources = await desktopCapturer.getSources({
                            types: ['window', 'screen'],
                        });
                        const systemAudio = request.audioRequested && process.platform === 'win32';
                        const result = await dialog.showMessageBox({
                            type: 'question',
                            title: 'Share a screen or window',
                            message: 'Choose what to share',
                            detail: systemAudio
                                ? 'System audio includes sound from all applications, even when sharing a single window.'
                                : 'System audio capture may not be available on this platform.',
                            ...(systemAudio
                                ? { checkboxLabel: 'Share system audio', checkboxChecked: true }
                                : {}),
                            buttons: [...sources.map((s) => s.name), 'Cancel'],
                            cancelId: sources.length,
                            noLink: true,
                        });
                        if (result.response >= sources.length) return callback({});
                        callback({
                            video: sources[result.response],
                            ...(systemAudio && result.checkboxChecked ? { audio: 'loopback' } : {}),
                        });
                    } catch {
                        callback({});
                    }
                },
                { useSystemPicker: true },
            );
            const trayEnabled = () => {
                try {
                    return JSON.parse(clientState.get('preferences') || '{}').closeToTray === true;
                } catch {
                    return false;
                }
            };
            const showWindow = () => {
                const win = BrowserWindow.getAllWindows()[0];
                if (win) {
                    win.show();
                    if (win.isMinimized()) win.restore();
                    win.focus();
                }
            };
            const ensureTray = () => {
                if (tray && !tray.isDestroyed()) return true;
                try {
                    tray = new Tray(path.join(__dirname, 'icons', 'campfire.png'));
                    tray.setToolTip('Campfire');
                    tray.setContextMenu(
                        Menu.buildFromTemplate([
                            { label: 'Open Campfire', click: showWindow },
                            { type: 'separator' },
                            { label: 'Quit Campfire', click: () => app.quit() },
                        ]),
                    );
                    tray.on('click', showWindow);
                    tray.on('double-click', showWindow);
                    return true;
                } catch {
                    tray = null;
                    return false;
                }
            };
            const open = () => {
                const win = new BrowserWindow({
                    width: 1440,
                    height: 940,
                    minWidth: 960,
                    minHeight: 640,
                    title: 'Campfire',
                    icon: path.join(
                        __dirname,
                        'icons',
                        process.platform === 'win32' ? 'campfire.ico' : 'campfire.png',
                    ),
                    backgroundColor: '#211b18',
                    webPreferences: {
                        preload: path.join(__dirname, 'preload.cjs'),
                        contextIsolation: true,
                        nodeIntegration: false,
                        sandbox: true,
                        backgroundThrottling: false,
                    },
                });
                win.on('close', (event) => {
                    if (!quitting && trayEnabled() && ensureTray()) {
                        event.preventDefault();
                        win.hide();
                    }
                });
                win.webContents.setWindowOpenHandler(({ url }) => {
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
                win.webContents.on('will-navigate', (event, url) => {
                    if (!trusted(url)) event.preventDefault();
                });
                void win.loadURL(origin);
            };
            open();
            app.on('activate', () => {
                if (!BrowserWindow.getAllWindows().length) open();
                else showWindow();
            });
        })
        .catch((error) => {
            dialog.showErrorBox('Campfire could not start', error.message);
            app.quit();
        });
}
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});
app.on('before-quit', () => {
    quitting = true;
    tray?.destroy();
    assetServer?.close();
});
