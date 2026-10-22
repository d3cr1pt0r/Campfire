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

const phase = process.env.SETTINGS_CAPTURE_PHASE || 'after';
app.whenReady()
    .then(async () => {
        await fs.mkdir(path.join(output, phase), { recursive: true });
        const category = await api(alice, '/categories', 'POST', { name: 'Community' });
        await api(alice, '/channels/general/category', 'PUT', {
            category: category.id,
            synced: true,
        });
        await api(alice, '/roles', 'POST', {
            name: 'Moderator',
            permissions: ['channels.view', 'messages.send'],
            color: '#a080c0',
        });
        await api(alice, '/registration', 'PATCH', { mode: 'invite' });
        await api(alice, '/invitations', 'POST', { label: 'Community invitation' });
        await api(alice, '/emojis', 'POST', {
            name: 'campfire_test',
            data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=',
        });
        const a = await client(alice);
        await js(
            a,
            'document.dispatchEvent(new KeyboardEvent("keydown",{key:",",ctrlKey:true,bubbles:true}))',
        );
        await wait(a, '!!document.querySelector(".settings-nav")', 'settings opens');
        const sections = await js(
            a,
            '[...document.querySelectorAll("#settings-section option")].map(node=>node.value)',
        );
        for (const [width, height, theme] of [
            [1440, 1000, 'dark'],
            [960, 900, 'dark'],
            [600, 900, 'dark'],
            [1440, 1000, 'light'],
        ]) {
            a.setSize(width, height);
            // Use Appearance's actual control so React applies the full theme.
            await select(a, '#settings-section', 'appearance');
            await js(a, `document.querySelector('input[name=theme][value="${theme}"]').click()`);
            const expected = await js(
                a,
                'document.querySelector(".settings-modal").getBoundingClientRect().width',
            );
            for (const section of sections) {
                await select(a, '#settings-section', section);
                await pause(100);
                if (section === 'server')
                    await wait(
                        a,
                        '!!document.querySelector(".storage-overview")',
                        'server storage loads',
                    );
                assert.equal(
                    await js(
                        a,
                        'document.querySelector(".settings-modal").getBoundingClientRect().width',
                    ),
                    expected,
                );
                if (phase === 'after') {
                    const overflow = await js(
                        a,
                        `[...document.querySelectorAll('.settings-content,.organizer-inspector,.organizer-outline')].filter(node=>node.scrollWidth>node.clientWidth+1).map(node=>({class:node.className,width:node.clientWidth,scroll:node.scrollWidth}))`,
                    );
                    assert.deepEqual(overflow, [], `Overflow in ${section} at ${width}px ${theme}`);
                    assert.equal(
                        await js(a, 'document.documentElement.scrollWidth<=innerWidth'),
                        true,
                    );
                    assert.equal(
                        await js(
                            a,
                            '!!document.querySelector(".settings-content .account-section,.settings-content .settings-section,.settings-content .organizer-inspector")',
                        ),
                        true,
                        `Missing grouped sections in ${section}`,
                    );
                }
                await screenshot(a, `${phase}/${theme}-${width}-${section}.png`);
                await js(
                    a,
                    `for(const node of document.querySelectorAll('.settings-content,.organizer-inspector')) node.scrollTop=node.scrollHeight`,
                );
                await screenshot(a, `${phase}/${theme}-${width}-${section}-bottom.png`);
            }
            await select(a, '#settings-section', 'channels');
            await click(a, button('Overview'));
            assert.equal(
                await js(
                    a,
                    'document.querySelector(".organizer-inspector").scrollWidth<=document.querySelector(".organizer-inspector").clientWidth+1',
                ),
                true,
            );
            await screenshot(a, `${phase}/${theme}-${width}-category-overview.png`);
            await click(
                a,
                '[...document.querySelectorAll(".tree-channel-select")].find(node=>node.querySelector("span").textContent==="general")',
            );
            await screenshot(a, `${phase}/${theme}-${width}-channel-overview.png`);
            console.log(`PASS all settings sections captured at ${width}px in ${theme}`);
        }
        if (phase === 'after') {
            await select(a, '#settings-section', 'account');
            await input(a, '.account-nickname-form input[name=nickname]', 'Alice Updated');
            await js(a, 'document.querySelector(".account-nickname-form").requestSubmit()');
            await wait(
                a,
                'document.querySelector(".account-profile h3").textContent==="Alice Updated"',
                'account save still works',
            );
            await select(a, '#settings-section', 'notifications');
            await js(
                a,
                `document.querySelector('button[aria-label="Notify for direct messages"]').click()`,
            );
            await select(a, '#settings-section', 'appearance');
            await select(a, 'select[aria-label="Message avatars"]', 'compact');
            await select(a, '#settings-section', 'notifications');
            assert.equal(
                await js(
                    a,
                    `document.querySelector('button[aria-label="Notify for direct messages"]').getAttribute("aria-checked")`,
                ),
                'false',
            );
            await select(a, '#settings-section', 'appearance');
            assert.equal(
                await js(a, `document.querySelector('select[aria-label="Message avatars"]').value`),
                'compact',
            );
            await select(a, '#settings-section', 'roles');
            await js(
                a,
                `document.querySelector('button[aria-label="Edit Moderator role"]').click()`,
            );
            await wait(a, '!!document.querySelector(".role-editor")', 'role editor opens');
            await js(
                a,
                'document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))',
            );
            await wait(
                a,
                '!!document.querySelector(".settings-nav")',
                'role editor returns to settings',
            );
            console.log('PASS account save, preference persistence, and nested role navigation');
        }
        assert.deepEqual(failures, []);
        a.destroy();
        app.exit(0);
    })
    .catch((error) => {
        console.error(error);
        app.exit(1);
    });
setTimeout(() => {
    console.error('Settings UI verification timed out');
    app.exit(1);
}, 120000);
