const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createClientState } = require('../electron/client-state.cjs');
const { createAvatarStore } = require('../electron/avatar-cache.cjs');
const profile = process.env.AVATAR_PROFILE;
const browser = process.env.AVATAR_PHASE.startsWith('browser');
app.setPath('userData', profile);
app.commandLine.appendSwitch('disable-gpu');
app.on('window-all-closed', () => {});
const state = createClientState(profile, { isEncryptionAvailable: () => false });
const store = createAvatarStore(path.join(profile, 'avatars'));
ipcMain.on('client-state:get', (event, key) => {
    event.returnValue = state.get(key);
});
ipcMain.on('client-state:set', (event, key, value) => {
    event.returnValue = state.set(key, value);
});
ipcMain.on('http:is-allowed', (event) => {
    event.returnValue = false;
});
ipcMain.handle('presence:idle-state', () => ({ seconds: 0, locked: false }));
ipcMain.handle('avatars:read', (_event, key) => store.read(key));
ipcMain.handle('avatars:write', (_event, key, bytes) => store.write(key, bytes));
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const errors = [];
const deadline = setTimeout(() => {
    console.error('Avatar verification timeout', errors);
    app.exit(1);
}, 45000);
app.whenReady()
    .then(async () => {
        const account = JSON.parse(process.env.AVATAR_ACCOUNT);
        state.set(
            'connection',
            JSON.stringify({ url: process.env.AVATAR_ORIGIN, token: account.token }),
        );
        state.set(
            'preferences',
            JSON.stringify({ messageAvatars: 'compact', sounds: false, messageSounds: false }),
        );
        const win = new BrowserWindow({
            width: 1440,
            height: 1000,
            show: true,
            webPreferences: {
                preload: browser ? undefined : path.join(__dirname, '../electron/preload.cjs'),
                sandbox: true,
                contextIsolation: true,
                backgroundThrottling: false,
            },
        });
        win.webContents.on('console-message', (event) => {
            if (event.level === 'error') errors.push(event.message);
        });
        const js = (code) => win.webContents.executeJavaScript(code, true);
        const wait = async (code, label) => {
            for (let i = 0; i < 150; i++) {
                if (await js(code)) {
                    console.log('PASS', label);
                    return;
                }
                await pause(100);
            }
            throw Error(`Timed out: ${label}\n${errors.join('\n')}`);
        };
        const loaded =
            "(()=>{const images=[...document.querySelectorAll('.virtual-message .avatar img')];return images.length>8 && images.every(image=>image.complete && image.naturalWidth===512) && !document.querySelector('.virtual-message .avatar .image-placeholder')})()";
        await win.loadURL(process.env.AVATAR_RENDERER);
        if (browser) {
            await js(
                `localStorage.setItem('connection', ${JSON.stringify(state.get('connection'))});localStorage.setItem('preferences', ${JSON.stringify(state.get('preferences'))})`,
            );
            await win.reload();
        }
        await wait(loaded, 'all visible avatars loaded');
        const sources = await js(
            "[...new Set([...document.querySelectorAll('.virtual-message .avatar img')].map(image=>image.src))]",
        );
        assert.equal(sources.length, 2, 'all repeated avatars share two object URLs');
        for (let i = 0; i < 3; i++) {
            await js("document.querySelector('.chat-area .messages').scrollTop=0");
            await pause(200);
            await js(
                "(()=>{const scroller=document.querySelector('.chat-area .messages');scroller.scrollTop=scroller.scrollHeight})()",
            );
            await wait(loaded, 'avatars remain available after scrolling');
        }
        const afterScroll = await js(
            "[...new Set([...document.querySelectorAll('.virtual-message .avatar img')].map(image=>image.src))]",
        );
        assert.deepEqual(afterScroll.sort(), sources.sort());
        await win.reload();
        await wait(loaded, 'avatars loaded after renderer reload');
        // Ensure the current IDs, including an updated Alice picture, are on disk.
        for (const id of JSON.parse(process.env.AVATAR_IDS)) {
            const key = JSON.stringify([
                process.env.AVATAR_ORIGIN,
                account.user.id,
                `/avatars/${id}`,
            ]);
            if (browser) {
                assert.equal(
                    await js(
                        `new Promise((resolve,reject)=>{const request=indexedDB.open('campfire-avatars',1);request.onsuccess=()=>{const db=request.result;const entry=db.transaction('avatars').objectStore('avatars').get(${JSON.stringify(key)});entry.onsuccess=()=>{resolve(entry.result instanceof Blob && entry.result.size>8);db.close()};entry.onerror=()=>reject(entry.error)};request.onerror=()=>reject(request.error)})`,
                    ),
                    true,
                );
            } else {
                const bytes = await store.read(key);
                assert.ok(bytes?.length > 8);
            }
        }
        assert.deepEqual(errors, []);
        console.log(
            'PASS shared URLs, persistent bytes, and no renderer errors:',
            process.env.AVATAR_PHASE,
        );
        clearTimeout(deadline);
        app.exit(0);
    })
    .catch((error) => {
        console.error(error);
        clearTimeout(deadline);
        app.exit(1);
    });
