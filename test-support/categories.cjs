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
const browserScrollDrag = async (win, source, destination, direction) => {
    const from = await js(
        win,
        `{
        const node=${source};
        const outline=document.querySelector('.organizer-outline');
        outline.scrollTop += node.getBoundingClientRect().top-outline.getBoundingClientRect().top-outline.clientHeight/2;
        const r=node.getBoundingClientRect();
        ({x:r.left+r.width/2,y:r.top+r.height/2});
    }`,
    );
    const debug = win.webContents.debugger;
    debug.attach('1.3');
    let edge;
    try {
        await debug.sendCommand('Input.setInterceptDrags', { enabled: true });
        const intercepted = new Promise((resolve, reject) => {
            const timeout = setTimeout(
                () => reject(Error('Native scroll drag did not start')),
                3000,
            );
            const listener = (_event, method, params) => {
                if (method !== 'Input.dragIntercepted') return;
                clearTimeout(timeout);
                debug.removeListener('message', listener);
                resolve(params.data);
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
            x: from.x + 24,
            y: from.y + 10,
            button: 'left',
            buttons: 1,
        });
        const data = await intercepted;
        edge = await js(
            win,
            `{
            const r=document.querySelector('.organizer-outline').getBoundingClientRect();
            ({x:r.left+r.width/2,y:${direction === 'down' ? 'r.bottom-8' : 'r.top+8'}});
        }`,
        );
        const initial = await js(win, 'document.querySelector(".organizer-outline").scrollTop');
        await debug.sendCommand('Input.dispatchDragEvent', { type: 'dragEnter', ...edge, data });
        await debug.sendCommand('Input.dispatchDragEvent', { type: 'dragOver', ...edge, data });
        await wait(
            win,
            `Math.abs(document.querySelector('.organizer-outline').scrollTop-${initial})>60`,
            `native drag scrolls ${direction} while pointer stays at the edge`,
        );
        await wait(
            win,
            `{
            const o=document.querySelector('.organizer-outline');
            ${
                direction === 'down'
                    ? 'o.scrollTop+o.clientHeight>=o.scrollHeight-2'
                    : 'o.scrollTop<=2'
            };
        }`,
            `held edge reaches the ${direction === 'down' ? 'bottom' : 'top'} of the list`,
        );
        const to = await js(
            win,
            `{
            const node=${destination};const r=node.getBoundingClientRect();
            ({x:r.left+r.width/2,y:r.top+r.height*.2});
        }`,
        );
        await debug.sendCommand('Input.dispatchDragEvent', { type: 'dragOver', ...to, data });
        await debug.sendCommand('Input.dispatchDragEvent', { type: 'drop', ...to, data });
    } finally {
        await debug.sendCommand('Input.dispatchMouseEvent', {
            type: 'mouseReleased',
            ...from,
            button: 'left',
            buttons: 0,
            clickCount: 1,
        });
        debug.detach();
    }
    await pause(100);
    const stopped = await js(win, 'document.querySelector(".organizer-outline").scrollTop');
    await pause(200);
    assert.equal(await js(win, 'document.querySelector(".organizer-outline").scrollTop'), stopped);
    console.log('PASS edge scrolling stops after drop');
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
        assert.equal(
            await js(
                a,
                'document.querySelector(\'.inspector-tabs [aria-selected="true"]\').textContent',
            ),
            'Overview',
        );
        await click(a, button('Permissions'));
        await click(a, `${treeChannel('lounge')}.querySelector('button')`);
        assert.equal(
            await js(
                a,
                'document.querySelector(\'.inspector-tabs [aria-selected="true"]\').textContent',
            ),
            'Overview',
        );
        console.log('PASS initial selection and switching channels default to Overview');
        for (const width of [1440, 960, 600]) {
            a.setSize(width, 1000);
            await pause(100);
            const bounds = () =>
                js(
                    a,
                    `{
                const r=document.querySelector('.settings-modal').getBoundingClientRect();
                ({x:r.x,y:r.y,width:r.width,height:r.height});
            }`,
                );
            const expected = await bounds();
            if (width >= 960) assert.equal(expected.width, Math.min(1120, width - 40));
            const sections = await js(
                a,
                '[...document.querySelectorAll("#settings-section option")].map(node=>node.value)',
            );
            for (const section of sections) {
                await select(a, '#settings-section', section);
                assert.deepEqual(
                    await bounds(),
                    expected,
                    `Settings geometry changes on ${section} at ${width}px`,
                );
                assert.equal(await js(a, 'document.documentElement.scrollWidth<=innerWidth'), true);
            }
            await select(a, '#settings-section', 'channels');
            if (width === 600) {
                assert.equal(
                    await js(
                        a,
                        `{
                    const editor=document.querySelector('.channel-workspace').getBoundingClientRect();
                    const signout=document.querySelector('.settings-mobile-signout').getBoundingClientRect();
                    signout.top>=editor.bottom-1;
                }`,
                    ),
                    true,
                );
            }
            assert.equal(
                await js(
                    a,
                    `[...document.querySelectorAll('.organizer-inspector, .permission-choice-row')].every(node=>node.scrollWidth<=node.clientWidth+1)`,
                ),
                true,
            );
            await click(a, button('Permissions'));
            if (width >= 960) {
                assert.equal(
                    await js(
                        a,
                        `{
                    const list=document.querySelector('.permission-role-list').getBoundingClientRect();
                    const editor=document.querySelector('.permission-role-editor').getBoundingClientRect();
                    editor.left>=list.right && Math.abs(editor.top-list.top)<1;
                }`,
                    ),
                    true,
                );
            }
            console.log(`PASS all settings sections keep identical bounds at ${width}px`);
        }
        await screenshot(a, 'settings-consistent-width-mobile.png');
        a.setSize(1440, 1000);
        await pause(100);
        await screenshot(a, 'settings-consistent-width-channels.png');
        await select(a, '#settings-section', 'account');
        await screenshot(a, 'settings-consistent-width-account.png');
        await select(a, '#settings-section', 'channels');
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
        assert.equal(
            await js(
                a,
                'document.querySelector(\'.inspector-tabs [aria-selected="true"]\').textContent',
            ),
            'Overview',
        );
        await screenshot(a, 'channel-default-overview.png');
        await click(a, button('Permissions'));
        await wait(
            a,
            'document.querySelector(".permission-source-card")?.textContent.includes("Synced with Community")',
            'selected channel names its permission source',
        );
        assert.equal(
            await js(
                a,
                `{
            const customize=[...document.querySelectorAll('.inspector-body button')].find(node=>node.textContent.trim()==='Customize this channel’s permissions');
            !!customize.closest('.permission-source-actions') && !customize.classList.contains('secondary');
        }`,
            ),
            true,
        );
        await screenshot(a, 'inherited-channel-permissions.png');
        await click(a, button('Edit Community permissions →'));
        assert.equal(
            await js(
                a,
                'document.querySelector(\'.inspector-tabs [aria-selected="true"]\').textContent',
            ),
            'Permissions',
        );
        assert.equal(
            await js(a, 'document.querySelector(".inspector-heading h3").textContent'),
            'Community',
        );
        await click(a, `${treeChannel('general')}.querySelector('button')`);
        assert.equal(
            await js(
                a,
                'document.querySelector(\'.inspector-tabs [aria-selected="true"]\').textContent',
            ),
            'Overview',
        );
        await click(a, button('Permissions'));
        console.log(
            'PASS explicit category permissions link opens Permissions while ordinary selections open Overview',
        );

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
        const generalCategory = (await api(alice, '/state')).channels.find(
            (c) => c.id === 'general',
        ).category;
        const categoryName = (await api(alice, '/state')).categories.find(
            (c) => c.id === generalCategory,
        ).name;
        assert.equal(
            await js(
                a,
                `{
            const replace=[...document.querySelectorAll('.permission-source-actions button')].find(node=>node.textContent.trim()===${JSON.stringify('Replace with ')}+${JSON.stringify(categoryName)}+${JSON.stringify(' permissions')});
            !!replace && replace.classList.contains('permission-link') && !replace.classList.contains('secondary');
        }`,
            ),
            true,
        );
        await click(a, button(`Replace with ${categoryName} permissions`));
        await wait(
            a,
            'document.querySelector(".permission-source-card")?.textContent.includes("Synced with Community")',
            'inline replace restores category inheritance',
        );
        assert.equal(
            (await api(alice, '/state')).channels.find((c) => c.id === 'general').synced,
            true,
        );
        await click(a, button('Customize this channel’s permissions'));
        await wait(
            a,
            'document.querySelector(".permission-source-card")?.textContent.includes("own permissions")',
            'inline customize restores custom editing',
        );

        // Navigation cannot reorder channels or categories, including for the owner.
        const state = await api(alice, '/state');
        assert.equal(state.channels.find((c) => c.name === 'music').synced, true);
        await js(a, 'document.querySelector(".settings-header .modal-close").click()');
        for (const win of [a, b]) {
            assert.equal(
                await js(
                    win,
                    'document.querySelectorAll(".channel-tree-sidebar [draggable=true]").length',
                ),
                0,
            );
            assert.equal(
                await js(
                    win,
                    'document.querySelector(".sidebar-content").firstElementChild.classList.contains("direct-messages")',
                ),
                true,
            );
            await drag(
                win,
                `${treeCategory('Media', 'sidebar')}.querySelector('.tree-category')`,
                `${treeCategory('Games', 'sidebar')}.querySelector('.tree-category-drop')`,
            );
            await drag(
                win,
                `${treeCategory('Media', 'sidebar')}.querySelector('.tree-channel')`,
                "document.querySelector('.channel-tree-sidebar .tree-uncategorized')",
            );
            await js(
                win,
                `for (const selector of ['.tree-category-name', '.tree-channel .channel']) {
                document.querySelector('.channel-tree-sidebar ' + selector).dispatchEvent(
                    new KeyboardEvent('keydown', {key:'ArrowUp', altKey:true, bubbles:true})
                );
            }`,
            );
        }
        await pause(200);
        const final = await api(alice, '/state');
        assert.deepEqual(final.categories, state.categories);
        assert.deepEqual(final.channels, state.channels);
        console.log(
            'PASS sidebar drag and keyboard reorder attempts leave owner and member layouts unchanged',
        );
        await screenshot(a, 'sidebar-messages-first.png');
        for (const win of [a, b])
            assert.equal(
                await js(
                    win,
                    'document.querySelectorAll(".channel-tree-sidebar .tree-channel-manage, .channel-tree-sidebar .tree-category-manage").length',
                ),
                0,
            );
        await js(
            a,
            'document.dispatchEvent(new KeyboardEvent("keydown",{key:",",ctrlKey:true,bubbles:true}))',
        );
        await wait(
            a,
            '!!document.querySelector("#settings-section")',
            'settings opens from the app control',
        );
        await select(a, '#settings-section', 'channels');

        // Overflow fixture: drag beyond the original viewport without scrollIntoView during the drag.
        for (let i = 0; i < 18; i++) {
            await api(alice, '/categories', 'POST', { name: `Overflow ${i}` });
        }
        const scrollState = await api(alice, '/state');
        const lastCategory = scrollState.categories.find((c) => c.name === 'Overflow 17');
        const bottomChannel = await api(alice, '/channels', 'POST', {
            name: 'bottom-channel',
            kind: 'text',
            category: lastCategory.id,
        });
        await wait(
            a,
            'document.querySelector(".channel-tree-settings").textContent.includes("bottom-channel")',
            'overflow fixture reaches the organizer',
        );
        await browserScrollDrag(
            a,
            `${treeCategory('Community')}.querySelector('.tree-category')`,
            `${treeCategory('Overflow 17')}.querySelector('.tree-category-drop')`,
            'down',
        );
        await wait(
            a,
            `[...document.querySelectorAll('.channel-tree-settings .tree-category-name')].at(-2)?.textContent==='Community'`,
            'category reorder persists after scrolling down',
        );
        await browserScrollDrag(
            a,
            treeChannel('bottom-channel'),
            treeChannel('introductions'),
            'up',
        );
        await wait(
            a,
            `document.querySelector('.channel-tree-settings .tree-uncategorized').textContent.includes('bottom-channel')`,
            'channel move persists after scrolling up',
        );
        assert.equal(
            (await api(alice, '/state')).channels.find((c) => c.id === bottomChannel.id).category,
            null,
        );
        await screenshot(a, 'drag-scroll-organizer.png');

        assert.deepEqual(failures, []);
        console.log(
            'PASS nested settings, channel/category dragging, mixed ordering, direct creation, permission choices, role controls, inherited/custom policies, cross-window revocation, collapsed unread, persistence and settings-only reordering',
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
