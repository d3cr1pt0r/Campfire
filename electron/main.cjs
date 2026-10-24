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
    webContents,
    nativeTheme,
} = require('electron');
const path = require('node:path');
const { installUpdates } = require('./updates.cjs');
const { installWindowPolicy } = require('./window-policy.cjs');
const { clipboardAttachments } = require('./clipboard-files.cjs');
const { createRendererServer, listenRendererServer } = require('./renderer-server.cjs');
const { createClientState } = require('./client-state.cjs');
const { createAvatarStore } = require('./avatar-cache.cjs');
const { installHttpPolicy } = require('./http-policy.cjs');
const { installScreenAudio } = require('./screen-audio.cjs');
const {
    fingerprint,
    normalizeFingerprint,
    parseOrigin,
    createPinStore,
    verifyDecision,
    checkState,
    inspectServer,
} = require('./pins.cjs');
app.setAppUserModelId('org.campfire.desktop');
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
            const pinStore = createPinStore(
                () => clientState.getInternal('pins'),
                (value) => clientState.setInternal('pins', value),
            );
            // Every TLS connection the renderer makes is checked against the pinned identity.
            session.defaultSession.setCertificateVerifyProc((request, callback) => {
                let presented = null;
                try {
                    presented = fingerprint(request.certificate.data);
                } catch {
                    /* Unparseable certificates are rejected below. */
                }
                callback(verifyDecision(pinStore, request.hostname, presented, request.errorCode));
            });
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
            installUpdates({ app, ipcMain, BrowserWindow, dialog, trusted });
            const screenAudio =
                process.platform === 'linux'
                    ? installScreenAudio({
                          app,
                          ipcMain,
                          trusted,
                          helperPath: app.isPackaged
                              ? path.join(process.resourcesPath, 'campfire-pipewire')
                              : path.join(__dirname, 'native', 'bin', 'campfire-pipewire'),
                      })
                    : null;
            installHttpPolicy({
                session: session.defaultSession,
                ipcMain,
                clientState,
                trusted,
                confirm: async (event, target) => {
                    const { response } = await dialog.showMessageBox(
                        BrowserWindow.fromWebContents(event.sender),
                        {
                            type: 'warning',
                            title: 'Allow insecure HTTP',
                            message: `Allow insecure HTTP for ${target}?`,
                            detail: 'Passwords, session tokens, messages and files can be read or changed in transit. This connection has no server identity verification. This choice is saved only for this address and port.',
                            buttons: ['Cancel', 'Allow insecure HTTP'],
                            defaultId: 0,
                            cancelId: 0,
                            noLink: true,
                        },
                    );
                    return response === 1;
                },
            });
            let readingClipboard = false;
            ipcMain.handle('clipboard:attachments', async (event, limit) => {
                if (!trusted(event.senderFrame?.url)) throw Error('Untrusted clipboard request');
                if (readingClipboard) throw Error('Wait for the previous paste to finish');
                readingClipboard = true;
                try {
                    return await clipboardAttachments(clipboard, limit);
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
            // The identity each server presented to the latest check; trust must match it.
            const observed = new Map();
            const restart = () => {
                app.relaunch();
                app.exit(0);
            };
            ipcMain.handle('pins:check', async (event, origin) => {
                if (!trusted(event.senderFrame?.url)) throw Error('Untrusted identity request');
                const target = parseOrigin(origin);
                try {
                    const result = await inspectServer(target);
                    observed.set(target.origin, result.fingerprint);
                    return {
                        state: checkState(
                            pinStore,
                            target.origin,
                            result.fingerprint,
                            result.authorized,
                        ),
                        fingerprint: result.fingerprint,
                    };
                } catch (error) {
                    return { state: 'unreachable', message: error.message };
                }
            });
            ipcMain.handle('pins:get', (event, origin) =>
                trusted(event.senderFrame?.url) ? pinStore.get(origin) : null,
            );
            ipcMain.handle('pins:trust', async (event, origin, value) => {
                if (!trusted(event.senderFrame?.url)) throw Error('Untrusted identity request');
                const target = parseOrigin(origin);
                const presented = normalizeFingerprint(value);
                if (!presented || observed.get(target.origin) !== presented)
                    return {
                        ok: false,
                        reason: 'The server presented a different identity. Check the address and try again.',
                    };
                const saved = pinStore.get(target.origin);
                if (saved === presented) return { ok: true };
                if (saved) {
                    // Replacing a pin is exactly what an attacker needs, so the main process asks.
                    const { response } = await dialog.showMessageBox(
                        BrowserWindow.fromWebContents(event.sender),
                        {
                            type: 'warning',
                            title: 'Server identity changed',
                            message: `Trust a new identity for ${target.origin}?`,
                            detail: 'Only continue if the server owner told you the server was reinstalled and you got this link directly from them. Otherwise someone may be intercepting your connection. Campfire restarts to apply the change.',
                            buttons: ['Keep the saved identity', 'Trust new identity and restart'],
                            defaultId: 0,
                            cancelId: 0,
                            noLink: true,
                        },
                    );
                    if (response !== 1) return { ok: false, reason: 'cancelled' };
                    pinStore.set(target.origin, presented);
                    restart();
                    return { ok: true, restarting: true };
                }
                pinStore.set(target.origin, presented);
                return { ok: true };
            });
            ipcMain.handle('pins:forget', async (event, origin) => {
                if (!trusted(event.senderFrame?.url)) throw Error('Untrusted identity request');
                const target = parseOrigin(origin);
                if (!pinStore.get(target.origin)) return { ok: true };
                const { response } = await dialog.showMessageBox(
                    BrowserWindow.fromWebContents(event.sender),
                    {
                        type: 'warning',
                        title: 'Forget server identity',
                        message: `Forget the saved identity for ${target.origin}?`,
                        detail: 'Campfire will ask you to confirm this server again on your next connection. Only do this if the server owner told you the server changed. Campfire restarts to apply the change.',
                        buttons: ['Cancel', 'Forget and restart'],
                        defaultId: 0,
                        cancelId: 0,
                        noLink: true,
                    },
                );
                if (response !== 1) return { ok: false, reason: 'cancelled' };
                pinStore.remove(target.origin);
                restart();
                return { ok: true, restarting: true };
            });
            ipcMain.on('client-state:get', (event, key) => {
                event.returnValue = trusted(event.senderFrame?.url) ? clientState.get(key) : null;
            });
            const avatars = createAvatarStore(path.join(app.getPath('userData'), 'avatars'));
            ipcMain.handle('avatars:read', (event, key) =>
                trusted(event.senderFrame?.url) ? avatars.read(key) : null,
            );
            ipcMain.handle('avatars:write', (event, key, bytes) =>
                trusted(event.senderFrame?.url) ? avatars.write(key, bytes) : false,
            );
            ipcMain.on('client-state:set', (event, key, value) => {
                try {
                    event.returnValue =
                        trusted(event.senderFrame?.url) && clientState.set(key, value);
                    if (event.returnValue && key === 'preferences') applyWindowTheme();
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
                        const result =
                            process.platform === 'linux' && sources.length === 1
                                ? { response: 0, checkboxChecked: false }
                                : await dialog.showMessageBox({
                                      type: 'question',
                                      title: 'Share a screen or window',
                                      message: 'Choose what to share',
                                      detail: systemAudio
                                          ? 'System audio includes sound from all applications, even when sharing a single window.'
                                          : 'System audio capture may not be available on this platform.',
                                      ...(systemAudio
                                          ? {
                                                checkboxLabel: 'Share system audio',
                                                checkboxChecked: true,
                                            }
                                          : {}),
                                      buttons: [...sources.map((s) => s.name), 'Cancel'],
                                      cancelId: sources.length,
                                      noLink: true,
                                  });
                        if (result.response >= sources.length) return callback({});
                        const source = sources[result.response];
                        const windowId =
                            process.env.XDG_SESSION_TYPE !== 'wayland' &&
                            !process.env.WAYLAND_DISPLAY
                                ? /^window:(\d+):/.exec(source.id)?.[1]
                                : undefined;
                        screenAudio?.selected(webContents.fromFrame(request.frame), {
                            name: source.name,
                            windowId: windowId ? Number(windowId) : undefined,
                        });
                        callback({
                            video: source,
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
                    return (
                        JSON.parse(clientState.get('preferences') || '{}')?.closeToTray !== false
                    );
                } catch {
                    return true;
                }
            };
            // The native title bar and the colour shown before the page paints follow the saved
            // theme: Graphite unless the user picked Light or System.
            const applyWindowTheme = () => {
                let theme;
                try {
                    theme = JSON.parse(clientState.get('preferences') || '{}')?.theme;
                } catch {
                    theme = undefined;
                }
                nativeTheme.themeSource = theme === 'light' || theme === 'system' ? theme : 'dark';
                const background = nativeTheme.shouldUseDarkColors ? '#19191b' : '#ffffff';
                for (const win of BrowserWindow.getAllWindows()) win.setBackgroundColor(background);
                return background;
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
                    backgroundColor: applyWindowTheme(),
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
                installWindowPolicy(win, shell);
                win.webContents.on('will-navigate', (event, url) => {
                    if (!trusted(url)) event.preventDefault();
                });
                void win.loadURL(origin);
            };
            ensureTray();
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
