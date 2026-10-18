const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
app.setPath('userData', process.env.MEMBER_PROFILE);
app.commandLine.appendSwitch('use-fake-device-for-media-stream');
app.commandLine.appendSwitch('use-fake-ui-for-media-stream');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.on('window-all-closed', () => {});
const [alice, bob, casey] = JSON.parse(process.env.MEMBER_FIXTURE);
const origin = process.env.MEMBER_ORIGIN;
const output = process.env.MEMBER_OUTPUT;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const failures = [];
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
const clickMember = (win, name) =>
    js(win, `document.querySelector(${JSON.stringify(selector(name))}).click()`);
const badge = (win, name, count) =>
    js(
        win,
        `document.querySelector(${JSON.stringify(selector(name))})?.querySelector('.member-unread')?.textContent === ${JSON.stringify(String(count))}`,
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
            partition,
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
            backgroundThrottling: false,
        },
    });
    win.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) =>
        callback(true),
    );
    win.webContents.on('console-message', (event) => {
        if (event.level === 'error') failures.push(event.message);
    });
    await win.loadURL(origin);
    await js(
        win,
        `localStorage.setItem('connection', JSON.stringify(${JSON.stringify({ url: origin, token: account.token })})); localStorage.setItem('preferences', JSON.stringify({theme:'dark',autoIdle:false,notifications:false,messageSounds:false,sounds:false,noise:false}));`,
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
        `{ const input = document.querySelector('.chat-area .composer textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,${JSON.stringify(text)}); input.dispatchEvent(new Event('input',{bubbles:true})); }`,
    );
    await pause(50);
    await js(win, `document.querySelector('.chat-area .composer').requestSubmit()`);
};
app.whenReady()
    .then(async () => {
        const a = await client(alice, 'member-alice');
        let b = await client(bob, 'member-bob');
        assert.equal(
            await js(
                a,
                'document.querySelector(".sidebar-content").textContent.includes("DIRECT MESSAGES")',
            ),
            false,
        );
        assert.equal(
            await js(
                a,
                'document.querySelector(".friends-view") !== null || [...document.querySelectorAll("button")].some(b=>b.textContent.trim() === "Friends")',
            ),
            false,
        );
        console.log('PASS Friends and Direct Messages navigation removed');
        await clickMember(b, 'Alice');
        await wait(
            () => js(b, 'document.querySelector(".channel-title strong")?.textContent === "Alice"'),
            'member opens DM',
        );
        await send(b, 'Hello from Bob without a relationship');
        await wait(() => badge(a, 'Bob', 1), 'incoming DM marks member unread');
        assert.equal(await js(b, 'document.querySelectorAll(".member-unread").length'), 0);
        console.log('PASS own messages do not produce unread badges');
        await fs.writeFile(path.join(output, 'member-unread.png'), (await a.capturePage()).toPNG());
        await clickMember(a, 'Bob');
        await wait(
            () =>
                js(
                    a,
                    'document.querySelector(".chat-area").textContent.includes("Hello from Bob without a relationship") && !document.querySelector(".member-unread")',
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
                    'document.querySelector("button[aria-label=\\\"Members\\\"] .count")?.textContent === "1"',
                ),
            'closed member list exposes total unread count',
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
        await wait(() => badge(a, 'Casey', 1), 'offline member messages show in member list');
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
