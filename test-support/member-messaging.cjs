const { app, BrowserWindow, ipcMain } = require('electron');
const { createClientState } = require('../electron/client-state.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
app.setPath('userData', process.env.MEMBER_PROFILE);
app.commandLine.appendSwitch('use-fake-device-for-media-stream');
app.commandLine.appendSwitch('use-fake-ui-for-media-stream');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.on('window-all-closed', () => {});
const [alice, bob, casey, dana] = JSON.parse(process.env.MEMBER_FIXTURE);
const origin = process.env.MEMBER_ORIGIN;
const output = process.env.MEMBER_OUTPUT;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const failures = [];
const clientStates = new Map();
const windowStates = new Map();
ipcMain.on('client-state:get', (event, key) => {
    event.returnValue = windowStates.get(event.sender.id).get(key);
});
ipcMain.on('client-state:set', (event, key, value) => {
    event.returnValue = windowStates.get(event.sender.id).set(key, value);
});
ipcMain.handle('presence:idle-state', () => ({ seconds: 0, locked: false }));
const js = async (win, source) => {
    try {
        return await win.webContents.executeJavaScript(source, true);
    } catch (error) {
        throw Error(`${source}\n${failures.join('\n')}\n${error}`);
    }
};
const wait = async (check, label) => {
    for (let i = 0; i < 150; i++) {
        if (await check()) {
            console.log('PASS', label);
            return;
        }
        await pause(100);
    }
    throw Error(`Timed out: ${label}\n${failures.join('\n')}`);
};
const deadline = setTimeout(() => {
    console.error('Member messaging verification timed out');
    app.exit(1);
}, 90000);
const selector = (name) => `.member[aria-label^="Message ${name}"]`;
const dmSelector = (name) => `.direct-message[aria-label^="Message ${name}"]`;
const clickMember = (win, name) =>
    js(win, `document.querySelector(${JSON.stringify(selector(name))}).click()`);
const badge = (win, name, count) =>
    js(
        win,
        `document.querySelector(${JSON.stringify(dmSelector(name))})?.querySelector('.dm-unread')?.textContent === ${JSON.stringify(String(count))}`,
    );
const api = async (account, route, method = 'GET', body) => {
    const response = await fetch(origin + '/api' + route, {
        method,
        headers: { Authorization: `Bearer ${account.token}`, 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
    });
    assert.equal(response.status, 200);
    return response.json();
};
async function client(account, partition) {
    const win = new BrowserWindow({
        width: 1440,
        height: 940,
        show: true,
        webPreferences: {
            preload: path.resolve(__dirname, '../electron/preload.cjs'),
            partition,
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
            backgroundThrottling: false,
        },
    });
    if (!clientStates.has(partition))
        clientStates.set(
            partition,
            createClientState(path.join(process.env.MEMBER_PROFILE, partition), {
                isEncryptionAvailable: () => false,
            }),
        );
    windowStates.set(win.webContents.id, clientStates.get(partition));
    win.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) =>
        callback(true),
    );
    win.webContents.on('console-message', (event) => {
        if (event.level === 'error') failures.push(event.message);
    });
    await win.loadURL('about:blank');
    win.webContents.debugger.attach('1.3');
    await win.webContents.debugger.sendCommand('Page.enable');
    await win.webContents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', {
        source: `window.__memberPeers = []; const OriginalPeer = window.RTCPeerConnection;
            window.RTCPeerConnection = class extends OriginalPeer {
                constructor(...args) { super(...args); window.__memberPeers.push(this); }
            };`,
    });
    await win.loadURL(origin);
    await js(
        win,
        `window.campfire.storage.setItem('connection', JSON.stringify(${JSON.stringify({ url: origin, token: account.token })})); window.campfire.storage.setItem('preferences', JSON.stringify({theme:'dark',autoIdle:false,notifications:false,messageSounds:false,sounds:false,noise:false}));`,
    );
    await win.loadURL(origin);
    await wait(
        () =>
            js(
                win,
                `!!document.querySelector('.member-list') && !!document.querySelector('.chat-area .composer') && document.querySelector('.server-heading small')?.textContent.includes('Connected')`,
            ),
        `${account.user.username} connected with member list`,
    );
    return win;
}
const send = async (win, text) => {
    await js(
        win,
        `{ const input = document.querySelector('.chat-area .composer .rich-input'); input.focus(); document.execCommand('insertText', false, ${JSON.stringify(text)}); }`,
    );
    await pause(50);
    await js(win, `document.querySelector('.chat-area .composer').requestSubmit()`);
};
app.whenReady()
    .then(async () => {
        let a = await client(alice, 'member-alice');
        let b = await client(bob, 'member-bob');
        for (const width of [1440, 960, 1800]) {
            a.setSize(width, 940);
            await pause(100);
            const spacing = await js(
                a,
                `(() => {
                const left = document.querySelector('.sidebar-content');
                const right = document.querySelector('.member-list');
                return {left: parseFloat(getComputedStyle(left).paddingTop), right: parseFloat(getComputedStyle(right).paddingTop)};
            })()`,
            );
            assert.deepEqual(spacing, { left: 8, right: 8 });
            const headings = await js(
                a,
                `(() => {
                const left = document.querySelector('.direct-messages-heading');
                const right = document.querySelector('.member-list-heading');
                return {leftPadding: parseFloat(getComputedStyle(left).paddingTop), leftHeight: left.getBoundingClientRect().height, rightHeight: right.getBoundingClientRect().height};
            })()`,
            );
            assert.equal(headings.leftPadding, 0);
            assert.equal(headings.leftHeight, headings.rightHeight);
        }
        a.setSize(1440, 940);
        console.log('PASS both sidebar top insets are 8px at 960, 1440 and 1800px');
        assert.equal(await js(a, 'document.querySelectorAll(".member-row").length'), 50);
        assert.equal(await js(a, 'document.querySelector(".composer-help") === null'), true);
        console.log('PASS 50-member directory and no empty composer helper container');
        assert.equal(
            await js(
                a,
                'document.querySelector(".top-actions .channel-notification-select, .top-actions button[aria-label=\\\"Mute conversation\\\"]") === null',
            ),
            true,
        );
        assert.equal(
            await js(
                a,
                'document.querySelector(".sidebar-content").textContent.includes("MESSAGES")',
            ),
            true,
        );
        assert.equal(
            await js(
                a,
                'document.querySelector(".friends-view") !== null || [...document.querySelectorAll("button")].some(b=>b.textContent.trim() === "Friends")',
            ),
            false,
        );
        for (const win of [a, b]) {
            assert.equal(
                await js(
                    win,
                    'document.querySelector(".sidebar-content").firstElementChild.classList.contains("direct-messages")',
                ),
                true,
            );
        }
        console.log('PASS Messages is first in both clients’ navigation');
        console.log('PASS Messages navigation visible without friendship system');
        await clickMember(b, 'Alice');
        await wait(
            () => js(b, 'document.querySelector(".channel-title strong")?.textContent === "Alice"'),
            'member opens DM',
        );
        assert.equal(
            await js(
                b,
                'document.querySelector(".top-actions .channel-notification-select, .top-actions button[aria-label=\\\"Mute conversation\\\"]") === null',
            ),
            true,
        );
        await send(b, 'Hello from Bob without a relationship');
        await wait(() => badge(a, 'Bob', 1), 'incoming DM appears in left navigation');
        assert.equal(await js(b, 'document.querySelectorAll(".dm-unread").length'), 0);
        console.log('PASS own messages do not produce unread badges');
        await fs.writeFile(path.join(output, 'dm-unread.png'), (await a.capturePage()).toPNG());
        await clickMember(a, 'Bob');
        await wait(
            () =>
                js(
                    a,
                    'document.querySelector(".chat-area").textContent.includes("Hello from Bob without a relationship") && !document.querySelector(".dm-unread")',
                ),
            'opening member reads DM and clears badge',
        );
        await fs.writeFile(path.join(output, 'member-dm.png'), (await a.capturePage()).toPNG());
        await js(
            a,
            'document.querySelector(".sidebar-content .channel").click(); document.querySelector("button[aria-label=\\\"Close member list\\\"]").click()',
        );
        await send(b, 'Second private message');
        await wait(
            () =>
                js(
                    a,
                    'document.querySelector(".direct-messages-heading .count")?.textContent === "1"',
                ),
            'hidden member directory leaves Messages unread count accessible',
        );
        await js(a, 'document.querySelector("button[aria-label=\\\"Members\\\"]").click()');
        await wait(() => badge(a, 'Bob', 1), 'reopening member list preserves unread badge');
        b.destroy();
        await wait(
            () => js(a, 'document.querySelector("button[aria-label=\\\"Call Bob\\\"]")?.disabled'),
            'offline member call disabled',
        );
        assert.equal(await badge(a, 'Bob', 1), true);
        console.log('PASS unread remains visible for offline members');
        const caseyRoom = 'dm:' + [alice.user.id, casey.user.id].sort().join(':');
        await api(casey, '/messages', 'POST', { room: caseyRoom, body: 'Offline sender message' });
        await wait(() => badge(a, 'Casey', 1), 'offline sender appears in Messages');
        const danaRoom = 'dm:' + [alice.user.id, dana.user.id].sort().join(':');
        await api(dana, '/messages', 'POST', { room: danaRoom, body: 'Third conversation' });
        await wait(
            () => badge(a, 'Dana', 1),
            'three unread conversations are accessible among 50 members',
        );
        assert.equal(
            await js(a, 'document.querySelector(".direct-message").textContent.includes("Dana")'),
            true,
        );
        await fs.writeFile(
            path.join(output, 'sidebar-50-members.png'),
            (await a.capturePage()).toPNG(),
        );
        await js(a, 'document.querySelector(".direct-messages-heading").click()');
        assert.equal(await js(a, 'document.querySelector("#direct-message-list").hidden'), true);
        assert.equal(
            await js(a, 'document.querySelector(".direct-messages-heading .count").textContent'),
            '3',
        );
        await js(a, 'document.querySelector(".direct-messages-heading").click()');
        await js(
            a,
            'document.querySelector("button[aria-label=\\\"Pin conversation with Bob\\\"]").click()',
        );
        assert.equal(
            await js(a, 'document.querySelector(".direct-message").textContent.includes("Bob")'),
            true,
        );
        await a.reload();
        await wait(
            () => js(a, '!!document.querySelector(".direct-message")'),
            'conversation history restores after reload',
        );
        assert.equal(
            await js(
                a,
                'document.querySelector("button[aria-label=\\\"Unpin conversation with Bob\\\"]")?.getAttribute("aria-pressed")',
            ),
            'true',
        );
        assert.equal(await js(a, 'document.querySelectorAll(".direct-message").length'), 3);
        console.log('PASS collapse, pinning and conversation persistence');
        const removeBob = () =>
            js(
                a,
                `document.querySelector('button[aria-label="Remove conversation with Bob from Messages"]').click()`,
            );
        const bobVisible = () =>
            js(a, '!!document.querySelector(\'button.direct-message[aria-label^="Message Bob"]\')');
        await js(
            a,
            'document.querySelector(\'button.direct-message[aria-label^="Message Bob"]\').click()',
        );
        await wait(
            () => js(a, '!!document.querySelector(".direct-message.selected")'),
            'Bob conversation opens before removal',
        );
        const rowBounds = await js(
            a,
            `(() => {const r=document.querySelector('.direct-message.selected').closest('.direct-message-row').getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};})()`,
        );
        a.webContents.sendInputEvent({ type: 'mouseMove', ...rowBounds });
        const documentNode = await a.webContents.debugger.sendCommand('DOM.getDocument');
        const hoveredRow = await a.webContents.debugger.sendCommand('DOM.querySelector', {
            nodeId: documentNode.root.nodeId,
            selector: '.direct-message-row:has(.selected)',
        });
        await a.webContents.debugger.sendCommand('CSS.enable');
        await a.webContents.debugger.sendCommand('CSS.forcePseudoState', {
            nodeId: hoveredRow.nodeId,
            forcedPseudoClasses: ['hover'],
        });
        assert.equal(
            await js(
                a,
                `getComputedStyle(document.querySelector('.direct-message.selected').closest('.direct-message-row').querySelector('.direct-message-delete')).opacity`,
            ),
            '1',
        );
        const compact = await js(
            a,
            `(() => { const row=document.querySelector('.direct-message.selected'); const dot=getComputedStyle(row.querySelector('.presence-dot')); return {font:getComputedStyle(row).fontSize,dot:dot.width,border:dot.borderWidth}; })()`,
        );
        assert.deepEqual(compact, { font: '13px', dot: '8px', border: '2px' });
        await fs.writeFile(
            path.join(output, 'dm-compact-actions.png'),
            (await a.capturePage()).toPNG(),
        );
        await removeBob();
        await wait(async () => !(await bobVisible()), 'remove hides the selected conversation');
        assert.equal(await js(a, '!!document.querySelector(".direct-message.selected")'), false);
        await a.reload();
        await wait(
            () => js(a, '!!document.querySelector(".server-heading")'),
            'reload after conversation removal',
        );
        assert.equal(await bobVisible(), false);
        const bobRoom = 'dm:' + [alice.user.id, bob.user.id].sort().join(':');
        await api(alice, '/messages', 'POST', {
            room: bobRoom,
            body: 'Outgoing from another device stays hidden',
        });
        await pause(100);
        assert.equal(await bobVisible(), false);
        await a.reload();
        await wait(
            () => js(a, '!!document.querySelector(".server-heading")'),
            'outgoing activity survives reload',
        );
        assert.equal(await bobVisible(), false);
        await api(bob, '/messages', 'POST', {
            room: bobRoom,
            body: 'New incoming restores the conversation',
        });
        await wait(bobVisible, 'new incoming message restores removed conversation');
        assert.equal(
            await js(
                a,
                'document.querySelector(\'button[aria-label="Pin conversation with Bob"]\').getAttribute("aria-pressed")',
            ),
            'false',
        );
        await removeBob();
        await wait(async () => !(await bobVisible()), 'second removal hides the conversation');
        a.destroy();
        await api(bob, '/messages', 'POST', {
            room: bobRoom,
            body: 'Incoming while Alice is offline',
        });
        a = await client(alice, 'member-alice');
        await wait(bobVisible, 'offline incoming message restores conversation on reconnect');
        const history = await api(alice, '/messages?' + new URLSearchParams({ room: bobRoom }));
        assert.ok(
            history.messages.some(
                (message) => message.body === 'Hello from Bob without a relationship',
            ),
        );
        console.log(
            'PASS compact DM styling, remove, persistence, incoming-only restoration and retained history',
        );

        a.setSize(960, 640);
        await pause(100);
        assert.equal(await js(a, 'document.documentElement.scrollWidth <= innerWidth'), true);
        await fs.writeFile(path.join(output, 'member-narrow.png'), (await a.capturePage()).toPNG());
        console.log('PASS narrow desktop layout has no document overflow');
        a.setSize(1440, 940);
        b = await client(bob, 'member-bob');
        await wait(
            () => js(a, '!document.querySelector("button[aria-label=\\\"Call Bob\\\"]").disabled'),
            'online member can be called',
        );
        await js(a, 'document.querySelector("button[aria-label=\\\"Call Bob\\\"]").click()');
        await wait(
            () => js(b, '!!document.querySelector(".call-invitations .primary")'),
            'member call sends invitation without friendship',
        );
        await js(b, 'document.querySelector(".call-invitations .primary").click()');
        await wait(
            async () =>
                (await api(alice, '/state')).calls.filter((c) => c.channel.startsWith('private:'))
                    .length === 2,
            'two real clients join private call with generated microphone capture',
        );
        await wait(
            async () =>
                (await js(
                    a,
                    'window.__memberPeers.some(peer => peer.connectionState === "connected")',
                )) &&
                (await js(
                    b,
                    'window.__memberPeers.some(peer => peer.connectionState === "connected")',
                )),
            'both clients establish a real WebRTC connection',
        );
        await fs.writeFile(path.join(output, 'member-call.png'), (await a.capturePage()).toPNG());
        const state = await api(alice, '/state');
        assert.equal('friends' in state, false);
        assert.deepEqual(failures, []);
        a.destroy();
        b.destroy();
        clearTimeout(deadline);
        app.exit(0);
    })
    .catch((error) => {
        console.error(error);
        clearTimeout(deadline);
        app.exit(1);
    });
