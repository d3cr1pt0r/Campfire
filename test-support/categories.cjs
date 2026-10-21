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
            partition: 'roles-' + account.user.id,
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
const treeChannel = (name) =>
    `[...document.querySelectorAll('.channel-tree-settings .tree-channel')].find(node=>node.querySelector('.tree-channel-select > span')?.textContent===${JSON.stringify(name)})`;
const treeCategory = (name, mode = 'settings') =>
    `[...document.querySelectorAll('.channel-tree-${mode} .tree-group')].find(node=>node.querySelector('.tree-category-name')?.textContent===${JSON.stringify(name)})`;
const drag = async (win, source, destination, after = false) => {
    await js(
        win,
        `window.categoryDragData=new DataTransfer();{const node=${source};node.dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:window.categoryDragData}));}`,
    );
    await pause(50);
    await js(
        win,
        `{const node=${destination};node.scrollIntoView({block:'nearest'});const r=node.getBoundingClientRect();node.dispatchEvent(new DragEvent('dragover',{bubbles:true,dataTransfer:window.categoryDragData,clientX:r.left+r.width/2,clientY:r.top+r.height*${after ? '.8' : '.2'}}));}`,
    );
    await pause(50);
    await js(
        win,
        `{const node=${destination};const r=node.getBoundingClientRect();node.dispatchEvent(new DragEvent('drop',{bubbles:true,dataTransfer:window.categoryDragData,clientX:r.left+r.width/2,clientY:r.top+r.height*${after ? '.8' : '.2'}}));}`,
    );
    await js(
        win,
        `${source}?.dispatchEvent(new DragEvent('dragend',{bubbles:true,dataTransfer:window.categoryDragData}))`,
    );
};
const browserDrag = async (win, source, destination) => {
    const bounds = async (expression) =>
        js(
            win,
            `{const node=${expression};node.scrollIntoView({block:'nearest'});const r=node.getBoundingClientRect();({x:r.left+r.width/2,y:r.top+r.height/2})}`,
        );
    const from = await bounds(source),
        to = await bounds(destination);
    const debug = win.webContents.debugger;
    debug.attach('1.3');
    try {
        await debug.sendCommand('Input.setInterceptDrags', { enabled: true });
        const data = new Promise((resolve, reject) => {
            const timeout = setTimeout(
                () => reject(Error('Browser did not initiate native drag')),
                3000,
            );
            const listener = (_event, method, params) => {
                if (method === 'Input.dragIntercepted') {
                    clearTimeout(timeout);
                    debug.removeListener('message', listener);
                    resolve(params.data);
                }
            };
            debug.on('message', listener);
        });
        await debug.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', ...from });
        await debug.sendCommand('Input.dispatchMouseEvent', {
            type: 'mousePressed',
            ...from,
            button: 'left',
            buttons: 1,
            clickCount: 1,
        });
        await debug.sendCommand('Input.dispatchMouseEvent', {
            type: 'mouseMoved',
            x: from.x + 12,
            y: from.y + 5,
            button: 'left',
            buttons: 1,
        });
        await debug.sendCommand('Input.dispatchMouseEvent', {
            type: 'mouseMoved',
            ...to,
            button: 'left',
            buttons: 1,
        });
        const payload = await data;
        for (const type of ['dragEnter', 'dragOver'])
            await debug.sendCommand('Input.dispatchDragEvent', { type, ...to, data: payload });
        await pause(100);
        await debug.sendCommand('Input.dispatchDragEvent', { type: 'drop', ...to, data: payload });
        console.log(
            'PASS Chromium initiates a drag from real mouse input and drops into the category',
        );
    } finally {
        await debug.sendCommand('Input.dispatchMouseEvent', {
            type: 'mouseReleased',
            ...to,
            button: 'left',
            buttons: 0,
            clickCount: 1,
        });
        debug.detach();
    }
};
const createItem = async (win, kind, name) => {
    await click(win, button('New'));
    await select(win, '.organizer-create select', kind);
    await input(win, '.organizer-create input', name);
    await js(win, 'document.querySelector(".organizer-create").requestSubmit()');
    await wait(win, '!document.querySelector(".organizer-create")', `${kind} ${name} created`);
};
const deadline = setTimeout(() => {
    console.error('Organizer UI verification timed out');
    app.exit(1);
}, 90000);
app.whenReady()
    .then(async () => {
        for (const [name, permissions, color] of [
            ['Members', ['channels.view', 'messages.send', 'calls.join'], '#82ae91'],
            ['Moderators', ['channels.view', 'messages.send', 'messages.deleteOthers'], '#bb91d2'],
            ['Guests', ['channels.view'], null],
        ])
            await api(alice, '/roles', 'POST', { name, permissions, color });
        const a = await client(alice),
            b = await client(bob);
        await js(
            a,
            'document.dispatchEvent(new KeyboardEvent("keydown",{key:",",ctrlKey:true,bubbles:true}))',
        );
        await wait(a, '!!document.querySelector(".settings-nav")', 'settings opens');
        await click(
            a,
            '[...document.querySelectorAll(".settings-nav button")].find(node=>node.textContent.trim()==="Channels")',
        );
        await wait(
            a,
            '!!document.querySelector(".channel-workspace")',
            'nested channel workspace opens',
        );
        await createItem(a, 'category', 'Community');
        await browserDrag(
            a,
            treeChannel('general'),
            `${treeCategory('Community')}.querySelector('.tree-category')`,
        );
        await wait(
            a,
            '!!document.querySelector(".move-policy-dialog")',
            'moving into category presents explicit permission choice',
        );
        await screenshot(a, 'drag-permission-choice.png');
        await click(a, 'document.querySelector(".move-policy-choice")');
        await wait(
            a,
            `${treeCategory('Community')}.querySelectorAll('.tree-channel').length===1`,
            'channel nested under category after drop',
        );
        await drag(a, treeChannel('lounge'), treeChannel('general'));
        await wait(
            a,
            '!!document.querySelector(".move-policy-dialog")',
            'voice can move into text category',
        );
        await click(a, 'document.querySelector(".move-policy-choice")');
        await wait(
            a,
            `${treeCategory('Community')}.querySelectorAll('.tree-channel').length===2`,
            'mixed channel types nest together',
        );
        await click(a, `${treeCategory('Community')}.querySelector('.tree-category-name')`);
        await createItem(a, 'text', 'announcements');
        await createItem(a, 'category', 'Media');
        await createItem(a, 'text', 'music');
        await createItem(a, 'text', 'pictures');
        await createItem(a, 'category', 'Games');
        await createItem(a, 'voice', 'Gaming');
        await createItem(a, 'text', 'planning');
        await drag(
            a,
            `${treeCategory('Games')}.querySelector('.tree-category')`,
            `${treeCategory('Media')}.querySelector('.tree-category-drop')`,
        );
        await wait(
            a,
            `[...document.querySelectorAll('.channel-tree-settings .tree-category-name')].map(node=>node.textContent).join('|')==='Community|Games|Media'`,
            'categories reorder by drag',
        );
        await drag(a, treeChannel('lounge'), treeChannel('general'), false);
        await wait(
            a,
            `${treeCategory('Community')}.querySelector('.tree-channel-select > span')?.textContent==='lounge'`,
            'mixed text and voice channels reorder by drag',
        );
        // Customize Default in the category using the segmented controls.
        await click(a, `${treeCategory('Community')}.querySelector('.tree-category-name')`);
        await click(a, button('Permissions'));
        await click(
            a,
            'document.querySelector(\'button[aria-label="Deny Send channel messages for Default"]\')',
        );
        await wait(
            a,
            '!!document.querySelector(".permission-savebar")',
            'unsaved permission changes are explicit',
        );
        await screenshot(a, 'unsaved-permission-changes.png');
        await click(a, `${treeChannel('general')}.querySelector('button')`);
        await wait(
            a,
            '!!document.querySelector("#unsaved-permissions-title")',
            'switching items protects unsaved permission changes',
        );
        await click(a, button('Keep editing'));
        await wait(
            a,
            '!document.querySelector("#unsaved-permissions-title")',
            'keep editing returns to draft',
        );

        await click(a, button('Save changes'));
        await wait(
            a,
            '!document.querySelector(".permission-savebar")',
            'category permission changes save',
        );
        await screenshot(a, 'nested-settings-permissions.png');
        await wait(
            b,
            `${treeCategory('Community', 'sidebar')}.querySelectorAll('.nav-item.channel').length===3`,
            'second window receives nested layout',
        );
        await click(
            b,
            '[...document.querySelectorAll(".nav-item.channel")].find(node=>node.textContent.trim()==="general")',
        );
        await wait(
            b,
            'document.querySelector(".chat-area .composer .rich-input")?.getAttribute("contenteditable")!=="true"',
            'category denial updates second window',
        );
        await screenshot(b, 'sidebar-expanded.png');
        await click(
            b,
            '[...document.querySelectorAll(".nav-item.channel")].find(node=>node.textContent.trim()==="introductions")',
        );
        await click(b, `${treeCategory('Community', 'sidebar')}.querySelector('.category-toggle')`);
        await api(alice, '/messages', 'POST', {
            room: 'general',
            body: 'Unread in a collapsed category',
        });
        await wait(
            b,
            `${treeCategory('Community', 'sidebar')}.querySelector('.count')?.textContent==='1'`,
            'collapsed category shows unread count',
        );
        await screenshot(b, 'sidebar-collapsed-unread.png');
        await js(b, "document.documentElement.dataset.theme='canvas'");
        await screenshot(b, 'sidebar-canvas.png');
        await b.reload();
        await wait(
            b,
            `${treeCategory('Community', 'sidebar')}?.querySelector('.category-toggle')?.getAttribute('aria-expanded')==='false'`,
            'collapse persists across reload',
        );
        await click(a, `${treeChannel('general')}.querySelector('button')`);
        await wait(
            a,
            'document.querySelector(".permission-source-card")?.textContent.includes("Synced with Community")',
            'selected channel names its permission source',
        );
        await screenshot(a, 'inherited-channel-permissions.png');
        await click(a, button('Customize this channel’s permissions'));
        await wait(
            a,
            'document.querySelector(".permission-source-card")?.textContent.includes("own permissions")',
            'customize switches to local permission editor',
        );
        assert.equal(
            (await api(bob, '/state')).channels
                .find((c) => c.id === 'general')
                .permissions.includes('messages.send'),
            false,
        );
        await click(
            a,
            'document.querySelector(\'button[aria-label="Allow Send channel messages for Default"]\')',
        );
        await click(a, button('Save changes'));
        await wait(
            a,
            '!document.querySelector(".permission-savebar")',
            'custom channel permission saves',
        );
        await screenshot(a, 'custom-channel-permissions.png');
        assert.equal(
            (await api(bob, '/state')).channels
                .find((c) => c.id === 'general')
                .permissions.includes('messages.send'),
            true,
        );
        // Sidebar uses the same drag interaction and allows moving back to the top level.
        const state = await api(alice, '/state');
        assert.equal(state.channels.find((c) => c.name === 'music').synced, true);
        const media = state.categories.find((c) => c.name === 'Media');
        const game = state.categories.find((c) => c.name === 'Games');
        await drag(
            b,
            `${treeCategory('Media', 'sidebar')}.querySelector('.tree-category')`,
            `${treeCategory('Games', 'sidebar')}.querySelector('.tree-category-drop')`,
        );
        // Bob has no reordering privilege; the API and UI both leave category order intact.
        assert.deepEqual(
            (await api(bob, '/state')).categories.map((c) => c.id),
            state.categories.map((c) => c.id),
        );
        await js(a, 'document.querySelector(".settings-header .modal-close").click()');
        await drag(
            a,
            `${treeCategory('Media', 'sidebar')}.querySelector('.tree-channel')`,
            "document.querySelector('.channel-tree-sidebar .tree-uncategorized')",
        );
        await wait(
            a,
            "document.querySelector('.channel-tree-sidebar .tree-uncategorized').textContent.includes('music')",
            'sidebar drag moves a channel out of a category',
        );
        const final = await api(alice, '/state');
        assert.equal(final.channels.find((c) => c.name === 'music').category, null);
        await click(a, `document.querySelector('button[aria-label="Edit general"]')`);
        await wait(
            a,
            'document.querySelector(".inspector-heading h3")?.textContent==="general"',
            'sidebar edit opens the exact channel',
        );

        assert.deepEqual(failures, []);
        console.log(
            'PASS nested settings, channel/category dragging, mixed ordering, direct creation, permission choices, role controls, inherited/custom policies, cross-window revocation, collapsed unread, persistence and sidebar dragging',
        );
        a.destroy();
        b.destroy();
        clearTimeout(deadline);
        app.exit(0);
    })
    .catch((error) => {
        console.error(error);
        console.error(failures);
        clearTimeout(deadline);
        app.exit(1);
    });
