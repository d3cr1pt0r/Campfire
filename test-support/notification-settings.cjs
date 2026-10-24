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
        await click(
            a,
            'document.querySelector(\'button[aria-label="Enable reaction notifications"]\')',
        );
        await wait(
            a,
            'document.querySelector(\'button[aria-label="Enable reaction notifications"]\').getAttribute("aria-checked")==="false"',
            'reaction alerts can be disabled separately',
        );
        const reactionRules = await api(alice, '/notification-preferences');
        assert.equal(reactionRules.reactions, false);
        assert.equal((await saved()).reactionNotifications[key('*')], false);
        assert.equal((await saved()).messageSounds, false);
        const originalOrder = await api(alice, '/state');
        assert.equal(
            await js(
                a,
                'document.querySelectorAll(".channel-tree-notifications [draggable=true], .channel-tree-notifications .tree-grip").length',
            ),
            0,
        );
        assert.equal(
            await js(
                a,
                'document.querySelectorAll(".channel-tree-notifications .tree-channel select").length',
            ),
            originalOrder.channels.filter((channel) => channel.kind === 'text').length,
        );
        await click(a, 'document.querySelector(\'button[aria-label="Collapse Community"]\')');
        assert.equal(
            await js(
                a,
                'document.querySelector(\'select[aria-label="#general notifications"]\').closest(".tree-children").hidden',
            ),
            true,
        );
        await click(a, 'document.querySelector(\'button[aria-label="Expand Community"]\')');
        await js(
            a,
            'document.querySelectorAll(".channel-tree-notifications .tree-channel, .channel-tree-notifications .tree-category").forEach(row=>{row.dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowUp",altKey:true,bubbles:true}));row.dispatchEvent(new DragEvent("dragstart",{bubbles:true,dataTransfer:new DataTransfer()}));row.dispatchEvent(new DragEvent("drop",{bubbles:true,dataTransfer:new DataTransfer()}));})',
        );
        const afterOrder = await api(alice, '/state');
        assert.deepEqual(afterOrder.channels, originalOrder.channels);
        assert.deepEqual(afterOrder.categories, originalOrder.categories);
        assert.equal(
            await js(
                a,
                'document.querySelector("input[name=server-notification-mode][value=mentions]").checked',
            ),
            true,
        );
        await click(a, 'document.querySelector("input[name=server-notification-mode][value=all]")');
        assert.equal((await saved()).serverNotificationModes[key('*')], 'all');
        await select(a, 'select[aria-label="Community category notifications"]', 'muted');
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
        await select(a, 'select[aria-label="Community category notifications"]', 'inherit');
        assert.equal((await saved()).categoryNotifications[key(category.id)], undefined);
        assert.equal(
            await js(
                a,
                'document.querySelector(\'select[aria-label="#general notifications"] option[value=inherit]\').textContent',
            ),
            'Use server default · All messages',
        );
        await select(a, 'select[aria-label="Community category notifications"]', 'muted');
        console.log(
            'PASS server defaults, category/channel overrides, reset to inheritance, and read-only tree',
        );
        await click(
            a,
            'document.querySelector(\'button[aria-label="Alert for direct messages"]\')',
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
        await click(a, 'document.querySelector(\'button[aria-label="Show desktop popups"]\')');
        await wait(
            a,
            'document.querySelector(".notification-settings").textContent.includes("Desktop popups are blocked")',
            'blocked desktop permission is explained',
        );
        assert.equal((await saved()).notifications, false);
        await js(a, 'window.Notification.permission="granted"');
        await click(a, 'document.querySelector(\'button[aria-label="Show desktop popups"]\')');
        await wait(
            a,
            'document.querySelector(\'button[aria-label="Show desktop popups"]\').getAttribute("aria-checked")==="true"',
            'desktop delivery can be enabled',
        );
        await click(a, 'document.querySelector(\'button[aria-label="Show desktop popups"]\')');
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
        assert.equal((await saved()).reactionNotifications[key('*')], false);
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
                'Desktop notifications',
                'Sounds',
                'Server notifications',
                'Channel overrides',
                'Direct messages',
                'Reactions to your messages',
            ]) {
                await js(
                    a,
                    '{const scroller=document.querySelector(".settings-content"); const card=[...scroller.querySelectorAll("section")].find(node=>node.getAttribute("aria-label")===' +
                        JSON.stringify(label) +
                        '); scroller.scrollTop+=card.getBoundingClientRect().top-scroller.getBoundingClientRect().top;}',
                );
                const overflow = await js(
                    a,
                    '[...document.querySelectorAll(".settings-content,.channel-tree-notifications,.member-preference-row")].filter(node=>node.scrollWidth>node.clientWidth+1).map(node=>({class:node.className,client:node.clientWidth,scroll:node.scrollWidth,children:[...node.children].map(child=>({tag:child.tagName,class:child.className,width:child.getBoundingClientRect().width,scroll:child.scrollWidth}))}))',
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
        a.setSize(1440, 1000);
        await select(a, '#settings-section', 'appearance');
        await js(a, 'document.querySelector(\'input[name=theme][value="dark"]\').click()');
        if (process.env.NOTIFICATIONS_ONLY === '1') {
            assert.deepEqual(failures, []);
            a.destroy();
            app.exit(0);
            return;
        }
        const identityMetrics = (selector) =>
            js(
                a,
                `(() => {
            const root=document.querySelector(${JSON.stringify(selector)});
            const avatar=getComputedStyle(root.querySelector('.avatar'));
            const name=getComputedStyle(root.querySelector('strong'));
            return {avatar:avatar.width,avatarHeight:avatar.height,font:name.fontSize,line:name.lineHeight,display:getComputedStyle(root).display,direction:getComputedStyle(root).flexDirection,compact:root.getBoundingClientRect().height<=32};
        })()`,
            );
        const members = await identityMetrics('.member-list .member-identity');
        assert.deepEqual(members, {
            avatar: '28px',
            avatarHeight: '28px',
            font: '12px',
            line: '15px',
            display: 'flex',
            direction: 'row',
            compact: true,
        });
        for (const [section, selector] of [
            ['notifications', '.member-preference-row .member-identity'],
            ['roles', '.member-roles-card .member-identity'],
            ['server', '.server-member-card .member-identity'],
        ]) {
            await select(a, '#settings-section', section);
            if (section === 'server')
                await wait(
                    a,
                    '!!document.querySelector(\".storage-overview\") && !!document.querySelector(\".registration-settings select\")',
                    'server sections load before member review',
                );
            if (section === 'notifications')
                await js(a, 'document.querySelector(".dm-notification-settings").open=true');
            assert.deepEqual(
                await identityMetrics(selector),
                members,
                section + ' matches Members panel',
            );
            if (section === 'notifications')
                assert.equal(
                    await js(
                        a,
                        'getComputedStyle(document.querySelector(".member-preference-row .channel-notification-select > span")).display',
                    ),
                    'none',
                );
            await js(
                a,
                'document.querySelector(' +
                    JSON.stringify(selector) +
                    ').scrollIntoView({block:"center",behavior:"instant"})',
            );
            await screenshot(a, 'compact-members-' + section + '.png');
        }
        await click(a, 'document.querySelector(\'button[aria-label="Close dialog"]\')');
        await click(a, 'document.querySelector(\'.member[aria-label="Message Bob"]\')');
        assert.equal(
            await js(
                a,
                'document.querySelector(".direct-message .direct-message-name").textContent',
            ),
            'Bob',
        );
        assert.equal(
            await js(a, 'document.querySelectorAll(".direct-message .member-identity").length'),
            0,
        );
        await screenshot(a, 'compact-members-main.png');
        await js(a, 'document.querySelector(".composer [contenteditable=true]").focus()');
        await a.webContents.insertText('@B');
        await wait(
            a,
            '!!document.querySelector(".mention-suggestions .member-identity")',
            'mention suggestions open',
        );
        assert.deepEqual(await identityMetrics('.mention-suggestions .member-identity'), members);
        await screenshot(a, 'compact-members-mentions.png');
        await click(a, 'document.querySelector(".mention-suggestions button")');
        assert.equal(
            await js(
                a,
                'document.querySelector(".composer .rich-input").textContent.includes("@Bob")',
            ),
            true,
        );
        const message = await api(bob, '/messages', 'POST', {
            room: dm,
            body: 'Member list review',
        });
        await api(bob, '/messages/' + message.id + '/reaction', 'POST', { emoji: '👍' });
        await wait(a, '!!document.querySelector(".reactions button")', 'reaction arrives');
        await js(a, 'document.querySelector(".reactions button").focus()');
        await wait(
            a,
            '!!document.querySelector(".reaction-popup .member-identity")',
            'reaction member popup opens',
        );
        assert.deepEqual(await identityMetrics('.reaction-popup .member-identity'), members);
        await screenshot(a, 'compact-members-reactions.png');

        console.log(
            'PASS compact shared identity matches Members panel in notifications, roles, and management; sidebar DMs retain their original layout',
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
