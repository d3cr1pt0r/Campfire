// The update feed comes from the packaged configuration, never from a community server.
function updateSupport(app, platform = process.platform, env = process.env) {
    if (!app.isPackaged) return 'Updates are available in installed desktop releases.';
    if (platform === 'win32' && !env.PORTABLE_EXECUTABLE_DIR) return null;
    if (platform === 'linux' && env.APPIMAGE) return null;
    return 'Download a Windows installer or Linux AppImage to receive automatic updates.';
}

function createUpdateController({ updater, version, unsupported, notify = () => {} }) {
    let state = {
        status: unsupported ? 'unsupported' : 'idle',
        currentVersion: version,
        message: unsupported || '',
    };
    let pending;
    const set = (patch) => {
        state = { ...state, ...patch };
        notify({ ...state });
    };
    if (!unsupported) {
        updater.autoDownload = true;
        updater.autoInstallOnAppQuit = true;
        updater.allowPrerelease = false;
        updater.allowDowngrade = false;
        updater.on('checking-for-update', () => set({ status: 'checking', message: '' }));
        updater.on('update-available', (info) =>
            set({ status: 'downloading', version: info.version, percent: 0, message: '' }),
        );
        updater.on('download-progress', (progress) =>
            set({ status: 'downloading', percent: Math.max(0, Math.min(100, progress.percent)) }),
        );
        updater.on('update-not-available', () => set({ status: 'current', message: '' }));
        updater.on('update-downloaded', (info) =>
            set({ status: 'ready', version: info.version, percent: 100, message: '' }),
        );
        updater.on('error', () =>
            set({
                status: 'error',
                message: 'Could not update Campfire. Check your connection and try again.',
            }),
        );
    }
    return {
        getState: () => ({ ...state }),
        async check() {
            if (unsupported || ['ready', 'downloading', 'installing'].includes(state.status))
                return { ...state };
            if (!pending) {
                set({ status: 'checking', message: '' });
                pending = Promise.resolve()
                    .then(() => updater.checkForUpdates())
                    .catch(() => {
                        set({
                            status: 'error',
                            message:
                                'Could not update Campfire. Check your connection and try again.',
                        });
                    })
                    .finally(() => {
                        pending = null;
                    });
            }
            await pending;
            return { ...state };
        },
        install() {
            if (state.status !== 'ready') return false;
            set({ status: 'installing' });
            try {
                updater.quitAndInstall(false, true);
                return true;
            } catch {
                set({
                    status: 'error',
                    message:
                        'Could not install the update. Download the latest release and try again.',
                });
                return false;
            }
        },
    };
}

function installUpdates({
    app,
    ipcMain,
    BrowserWindow,
    dialog,
    trusted,
    loadUpdater = () => require('electron-updater').autoUpdater,
    platform = process.platform,
    env = process.env,
}) {
    const unsupported = updateSupport(app, platform, env);
    const controller = createUpdateController({
        updater: unsupported ? null : loadUpdater(),
        version: app.getVersion(),
        unsupported,
        notify: (state) => {
            for (const window of BrowserWindow.getAllWindows()) {
                if (trusted(window.webContents.getURL()))
                    window.webContents.send('updates:changed', state);
            }
        },
    });
    const authorized = (event) => {
        if (!trusted(event.senderFrame?.url) || event.senderFrame !== event.sender.mainFrame)
            throw Error('Untrusted update request');
    };
    ipcMain.handle('updates:state', (event) => {
        authorized(event);
        return controller.getState();
    });
    ipcMain.handle('updates:check', (event) => {
        authorized(event);
        return controller.check();
    });
    let confirming = false;
    ipcMain.handle('updates:install', async (event) => {
        authorized(event);
        if (confirming || controller.getState().status !== 'ready') return false;
        confirming = true;
        try {
            const { response } = await dialog.showMessageBox(
                BrowserWindow.fromWebContents(event.sender),
                {
                    type: 'question',
                    title: 'Update Campfire',
                    message: 'Restart to install the update?',
                    detail: 'Campfire will close and reopen. Any active call or screen sharing will end.',
                    buttons: ['Later', 'Restart to update'],
                    defaultId: 0,
                    cancelId: 0,
                    noLink: true,
                },
            );
            return response === 1 && controller.install();
        } finally {
            confirming = false;
        }
    });
    if (!unsupported) {
        const startup = setTimeout(() => void controller.check(), 15000);
        const periodic = setInterval(() => void controller.check(), 4 * 60 * 60 * 1000);
        startup.unref();
        periodic.unref();
        app.once('before-quit', () => {
            clearTimeout(startup);
            clearInterval(periodic);
        });
    }
    return controller;
}
module.exports = { updateSupport, createUpdateController, installUpdates };
