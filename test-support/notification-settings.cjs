const { app, BrowserWindow, ipcMain } = require('electron');
const { createClientState } = require('../electron/client-state.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
app.setPath('userData', process.env.MEMBER_PROFILE);
app.on('window-all-closed', () => {});
const [alice, bob] = JSON.parse(process.env.MEMBER_FIXTURE);
const origin = process.env.MEMBER_ORIGIN;
const output = process.env.MEMBER_OUTPUT;
const stores = new Map(),
    failures = [];
ipcMain.on(
    'client-state:get',
    (event, key) => (event.returnValue = stores.get(event.sender.id).get(key)),
);
ipcMain.on(
    'client-state:set',
    (event, key, value) => (event.returnValue = stores.get(event.sender.id).set(key, value)),
);
ipcMain.handle('presence:idle-state', () => ({ seconds: 0, locked: false }));
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const js = (win, source) => win.webContents.executeJavaScript(source, true);
const wait = async (win, source, label) => {
    for (let i = 0; i < 120; i++) {
        if (await js(win, source)) {
            console.log('PASS', label);
            return;
        }
        await pause(100);
    }
    throw Error(`Timed out ${label}: ${failures.join('\n')}`);
};
const api = async (account, endpoint, method = 'GET', body) => {
    const response = await fetch(origin + '/api' + endpoint, {
        method,
        headers: { Authorization: `Bearer ${account.token}`, 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const data = await response.json();
    assert.equal(response.status, 200, JSON.stringify(data));
    return data;
};
async function client(account) {
    const win = new BrowserWindow({
        width: 1440,
        height: 1000,
        show: true,
        webPreferences: {
            preload: path.resolve(__dirname, '../electron/preload.cjs'),
            partition: 'settings-' + account.user.id,
            contextIsolation: true,
            sandbox: true,
            backgroundThrottling: false,
        },
    });
    stores.set(
        win.webContents.id,
        createClientState(path.join(process.env.MEMBER_PROFILE, account.user.id), {
            isEncryptionAvailable: () => false,
        }),
    );
    win.webContents.on('console-message', (event) => {
        if (event.level === 'error') failures.push(event.message);
    });
    await win.loadURL(origin);
    await js(
        win,
        `window.campfire.storage.setItem('connection',JSON.stringify(${JSON.stringify({ url: origin, token: account.token })}));window.campfire.storage.setItem('preferences',JSON.stringify({theme:'dark',autoIdle:false,notifications:false,messageSounds:false}));`,
    );
    await win.reload();
    await wait(win, '!!document.querySelector(".server-heading")', 'desktop client connects');
    return win;
}
const input = async (win, selector, value) =>
    js(
        win,
        `{const node=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(node,${JSON.stringify(value)});node.dispatchEvent(new Event('input',{bubbles:true}));node.dispatchEvent(new Event('change',{bubbles:true}));}`,
    );
const screenshot = async (win, name) => {
    await pause(180);
    await fs.writeFile(path.join(output, name), (await win.capturePage()).toPNG());
};
const click = (win, expression) => js(win, `${expression}.click()`);
const button = (text) =>
    `[...document.querySelectorAll('button')].find(node=>node.textContent.trim()===${JSON.stringify(text)})`;
const select = (win, selector, value) =>
    js(
        win,
        `{const node=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(node,${JSON.stringify(value)});node.dispatchEvent(new Event('change',{bubbles:true}));}`,
    );

app.whenReady()
    .then(async () => {
        const category = await api(alice, '/categories', 'POST', { name: 'Community' });
        await api(alice, '/channels/general/category', 'PUT', {
            category: category.id,
            synced: false,
        });
        const a = await client(alice);
        const open = async () => {
            await js(
                a,
                'document.dispatchEvent(new KeyboardEvent("keydown",{key:",",ctrlKey:true,bubbles:true}))',
            );
            await wait(a, '!!document.querySelector(".settings-nav")', 'settings opens');
            await select(a, '#settings-section', 'notifications');
        };
        const saved = async () => {
            await pause(30);
            return js(a, 'JSON.parse(window.campfire.storage.getItem("preferences"))');
        };
        const key = (scope) => JSON.stringify([new URL(origin).host, alice.user.id, scope]);
        await open();
        assert.equal(
            await js(
                a,
                'document.querySelector("input[name=server-notification-mode][value=mentions]").checked',
            ),
            true,
        );
        await click(a, 'document.querySelector("input[name=server-notification-mode][value=all]")');
        assert.equal((await saved()).serverNotificationModes[key('*')], 'all');
        await select(
            a,
            'select[aria-label="Add notification override"]',
            'category:' + category.id,
        );
        await select(a, 'select[aria-label="Community category notifications"]', 'muted');
        await select(a, 'select[aria-label="Add notification override"]', 'channel:general');
        assert.equal(
            await js(
                a,
                'document.querySelector(\'select[aria-label="#general notifications"] option[value=inherit]\').textContent',
            ),
            'Use category default · Nothing',
        );
        await select(a, 'select[aria-label="#general notifications"]', 'all');
        assert.equal((await saved()).channelNotifications[key('general')], 'all');
        await select(a, 'select[aria-label="#general notifications"]', 'inherit');
        assert.equal((await saved()).channelNotifications[key('general')], undefined);
        await select(a, 'select[aria-label="#general notifications"]', 'mentions');
        await click(
            a,
            'document.querySelector(\'button[aria-label="Remove Category · Community override"]\')',
        );
        assert.equal((await saved()).categoryNotifications[key(category.id)], undefined);
        assert.equal(
            await js(
                a,
                'document.querySelector(\'select[aria-label="#general notifications"] option[value=inherit]\').textContent',
            ),
            'Use server default · All messages',
        );
        assert.equal(
            await js(a, 'document.activeElement.getAttribute("aria-label")'),
            'Add notification override',
        );
        await select(
            a,
            'select[aria-label="Add notification override"]',
            'category:' + category.id,
        );
        await select(a, 'select[aria-label="Community category notifications"]', 'muted');
        console.log(
            'PASS server defaults, category/channel overrides, reset to inheritance, and remove focus',
        );
        await click(
            a,
            'document.querySelector(\'button[aria-label="Notify for direct messages"]\')',
        );
        await js(a, 'document.querySelector(".dm-notification-settings").open=true');
        await input(a, '.dm-notification-settings input[type=search]', 'Bob');
        await select(a, 'select[aria-label="Bob DM notifications"]', 'all');
        const dm = 'dm:' + [alice.user.id, bob.user.id].sort().join(':');
        assert.equal((await saved()).channelNotifications[key(dm)], 'all');
        assert.equal((await saved()).dmNotifications, false);
        // Exercise both permission outcomes without showing an OS dialog.
        await js(
            a,
            'window.Notification=class {static permission="denied";static async requestPermission(){return this.permission}};true',
        );
        await click(a, 'document.querySelector(\'button[aria-label="Desktop notifications"]\')');
        await wait(
            a,
            'document.querySelector(".notification-settings").textContent.includes("Desktop alerts are blocked")',
            'blocked desktop permission is explained',
        );
        assert.equal((await saved()).notifications, false);
        await js(a, 'window.Notification.permission="granted"');
        await click(a, 'document.querySelector(\'button[aria-label="Desktop notifications"]\')');
        await wait(
            a,
            'document.querySelector(\'button[aria-label="Desktop notifications"]\').getAttribute("aria-checked")==="true"',
            'desktop delivery can be enabled',
        );
        await click(a, 'document.querySelector(\'button[aria-label="Desktop notifications"]\')');
        await click(a, 'document.querySelector(\'button[aria-label="Mute Notification review"]\')');
        await a.reload();
        await wait(a, '!!document.querySelector(".server-heading")', 'client reloads');
        await open();
        assert.equal(
            await js(
                a,
                'document.querySelector("input[name=server-notification-mode][value=all]").checked',
            ),
            true,
        );
        assert.equal((await saved()).serverNotifications[key('*')], false);
        assert.equal((await saved()).categoryNotifications[key(category.id)], 'muted');
        assert.equal((await saved()).channelNotifications[key(dm)], 'all');
        await click(a, 'document.querySelector(\'button[aria-label="Mute Notification review"]\')');
        for (const [width, theme] of [
            [1440, 'dark'],
            [960, 'dark'],
            [600, 'dark'],
            [1440, 'light'],
        ]) {
            a.setSize(width, 1000);
            await select(a, '#settings-section', 'appearance');
            await js(
                a,
                'document.querySelector(\'input[name=theme][value="' + theme + '"]\').click()',
            );
            await select(a, '#settings-section', 'notifications');
            await js(a, 'document.querySelector(".dm-notification-settings").open=true');
            for (const label of [
                'Notification delivery',
                'Server notification defaults',
                'Notification overrides',
                'Direct message notifications',
            ]) {
                await js(
                    a,
                    '{const scroller=document.querySelector(".settings-content"); const card=[...scroller.querySelectorAll("section")].find(node=>node.getAttribute("aria-label")===' +
                        JSON.stringify(label) +
                        '); scroller.scrollTop+=card.getBoundingClientRect().top-scroller.getBoundingClientRect().top;}',
                );
                const overflow = await js(
                    a,
                    '[...document.querySelectorAll(".settings-content,.notification-override")].filter(node=>node.scrollWidth>node.clientWidth+1).map(node=>({class:node.className,client:node.clientWidth,scroll:node.scrollWidth,children:[...node.children].map(child=>({tag:child.tagName,class:child.className,width:child.getBoundingClientRect().width,scroll:child.scrollWidth}))}))',
                );
                assert.deepEqual(overflow, [], width + ' ' + label);
                await screenshot(
                    a,
                    theme + '-' + width + '-' + label.toLowerCase().replaceAll(' ', '-') + '.png',
                );
            }
        }
        console.log(
            'PASS persistence, DM overrides, delivery permissions, dark/light, and three window sizes',
        );
        assert.deepEqual(failures, []);
        a.destroy();
        app.exit(0);
    })
    .catch((error) => {
        console.error(error);
        app.exit(1);
    });
setTimeout(() => {
    console.error('Notification settings verification timed out');
    app.exit(1);
}, 90000);
