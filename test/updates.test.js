import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const {
    updateSupport,
    createUpdateController,
    installUpdates,
} = require('../electron/updates.cjs');
const fake = () => {
    const updater = new EventEmitter();
    updater.checks = 0;
    updater.installs = 0;
    updater.checkForUpdates = async () => {
        updater.checks++;
        updater.emit('update-not-available');
    };
    updater.quitAndInstall = () => {
        updater.installs++;
    };
    return updater;
};
test('only packaged NSIS and AppImage clients enable updates', () => {
    assert.equal(updateSupport({ isPackaged: true }, 'win32', {}), null);
    assert.equal(
        updateSupport({ isPackaged: true }, 'linux', { APPIMAGE: '/home/me/Campfire.AppImage' }),
        null,
    );
    assert.ok(updateSupport({ isPackaged: false }, 'win32', {}));
    assert.ok(
        updateSupport({ isPackaged: true }, 'win32', { PORTABLE_EXECUTABLE_DIR: 'C:\\Apps' }),
    );
    assert.ok(updateSupport({ isPackaged: true }, 'linux', {}));
    const controller = createUpdateController({ unsupported: 'Manual updates', version: '0.2.2' });
    assert.equal(controller.getState().status, 'unsupported');
    assert.equal(controller.install(), false);
});
test('checks coalesce, failures can retry, and downloads never trigger a restart', async () => {
    const updater = fake();
    const snapshots = [];
    const controller = createUpdateController({
        updater,
        version: '0.2.2',
        notify: (s) => snapshots.push(s),
    });
    assert.equal(updater.autoDownload, true);
    assert.equal(updater.autoInstallOnAppQuit, true);
    assert.equal(updater.allowPrerelease, false);
    assert.equal(updater.allowDowngrade, false);
    await Promise.all([controller.check(), controller.check()]);
    assert.equal(updater.checks, 1);
    assert.equal(controller.getState().status, 'current');
    updater.checkForUpdates = async () => {
        throw Error('offline');
    };
    await controller.check();
    assert.equal(controller.getState().status, 'error');
    updater.checkForUpdates = async () => updater.emit('update-available', { version: '0.2.3' });
    await controller.check();
    updater.emit('download-progress', { percent: 42 });
    assert.equal(controller.getState().percent, 42);
    assert.equal(controller.install(), false);
    updater.emit('update-downloaded', { version: '0.2.3' });
    assert.equal(updater.installs, 0);
    await controller.check();
    assert.equal(controller.getState().status, 'ready');
    assert.equal(controller.install(), true);
    assert.equal(controller.install(), false);
    assert.equal(updater.installs, 1);
    assert.equal(snapshots.at(-1).status, 'installing');
});
test('update IPC rejects foreign frames and restart requires native confirmation', async () => {
    const app = new EventEmitter();
    app.isPackaged = true;
    app.getVersion = () => '0.2.2';
    const handlers = new Map();
    const updater = fake();
    const frame = { url: 'http://127.0.0.1:1234/' };
    const event = { senderFrame: frame, sender: { mainFrame: frame } };
    let response = 0;
    let prompts = 0;
    const controller = installUpdates({
        app,
        ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
        BrowserWindow: { getAllWindows: () => [], fromWebContents: () => ({}) },
        dialog: {
            showMessageBox: async () => {
                prompts++;
                return { response };
            },
        },
        trusted: (url) => url === frame.url,
        loadUpdater: () => updater,
        platform: 'win32',
        env: {},
    });
    try {
        assert.throws(
            () =>
                handlers.get('updates:state')({
                    ...event,
                    senderFrame: { url: 'https://foreign.example' },
                }),
            /Untrusted/,
        );
        assert.throws(
            () => handlers.get('updates:state')({ ...event, senderFrame: { ...frame } }),
            /Untrusted/,
        );
        updater.emit('update-downloaded', { version: '0.2.3' });
        assert.equal(await handlers.get('updates:install')(event), false);
        assert.equal(updater.installs, 0);
        response = 1;
        assert.equal(await handlers.get('updates:install')(event), true);
        assert.equal(updater.installs, 1);
        assert.equal(prompts, 2);
    } finally {
        app.emit('before-quit');
    }
});
