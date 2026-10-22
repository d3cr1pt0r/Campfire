const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
app.setPath('userData', process.env.INVITE_PROFILE);
for (const flag of [
    'use-fake-device-for-media-stream',
    'use-fake-ui-for-media-stream',
    'disable-gpu',
])
    app.commandLine.appendSwitch(flag);
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.on('window-all-closed', () => {});
const [aliceAccount, bobAccount] = JSON.parse(process.env.INVITE_ACCOUNTS);
const origin = process.env.INVITE_ORIGIN,
    renderer = process.env.INVITE_RENDERER,
    output = process.env.INVITE_OUTPUT;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const errors = [];
const js = (win, source) => win.webContents.executeJavaScript(source, true);
const wait = async (win, source, label) => {
    for (let attempt = 0; attempt < 120; attempt++) {
        if (await js(win, source)) {
            console.log('PASS', label);
            return;
        }
        await pause(100);
    }
    throw Error(`Timed out: ${label}\n${errors.join('\n')}`);
};
const click = (win, selector) =>
    js(
        win,
        `(()=>{const element=document.querySelector(${JSON.stringify(selector)});if(!element) throw Error('Missing '+${JSON.stringify(selector)});element.click();})()`,
    );
const search = (win, value) =>
    js(
        win,
        `(()=>{const input=document.querySelector('.voice-invite-search input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`,
    );
const screenshot = async (win, name) => {
    await pause(220);
    await fs.writeFile(`${output}/${name}.png`, (await win.webContents.capturePage()).toPNG());
};
const api = async (account, path, method = 'GET', body) => {
    const response = await fetch(origin + '/api' + path, {
        method,
        headers: { Authorization: 'Bearer ' + account.token, 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
    });
    assert.equal(response.status, 200);
    return response.json();
};
async function client(account, name) {
    const win = new BrowserWindow({
        width: 1280,
        height: 900,
        show: true,
        webPreferences: {
            partition: 'invite-' + name,
            contextIsolation: true,
            sandbox: true,
            backgroundThrottling: false,
        },
    });
    win.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) =>
        callback(true),
    );
    win.webContents.on('console-message', (event) => {
        if (event.level === 'error') errors.push(event.message);
    });
    await win.loadURL(renderer);
    await js(
        win,
        `localStorage.setItem('connection',JSON.stringify(${JSON.stringify({ url: origin, token: account.token })}));localStorage.setItem('preferences',JSON.stringify({theme:'dark',noise:false,sounds:false,messageSounds:false,autoIdle:false}));`,
    );
    await win.reload();
    await wait(
        win,
        "document.querySelector('.server-heading small')?.textContent.includes('Connected')",
        name + ' connects',
    );
    return win;
}
const deadline = setTimeout(() => {
    console.error('Voice invite verification timed out');
    app.exit(1);
}, 60000);
app.whenReady()
    .then(async () => {
        const alice = await client(aliceAccount, 'Alice'),
            bob = await client(bobAccount, 'Bob');
        assert.equal(
            await js(alice, "document.querySelectorAll('.voice-channel-invite').length"),
            2,
        );
        await alice.webContents.sendInputEvent({ type: 'mouseMove', x: 500, y: 120 });
        assert.equal(
            await js(
                alice,
                "getComputedStyle(document.querySelector('.voice-channel-invite')).opacity",
            ),
            '0',
        );
        const bounds = await js(
            alice,
            "(()=>{const r=document.querySelector('.voice-channel-row').getBoundingClientRect();return {x:Math.round(r.x+15),y:Math.round(r.y+15)};})()",
        );
        alice.focus();
        alice.webContents.sendInputEvent({ type: 'mouseMove', ...bounds });
        await wait(
            alice,
            "getComputedStyle(document.querySelector('.voice-channel-invite')).opacity==='1'",
            'invite icons appear on voice-channel hover',
        );
        await click(alice, '[aria-label="Invite to lounge"]');
        await wait(
            alice,
            "document.querySelectorAll('.voice-invite-member').length===2",
            'searchable list includes online and offline members',
        );
        assert.equal(
            await js(
                alice,
                "document.activeElement===document.querySelector('.voice-invite-search input')",
            ),
            true,
        );
        assert.equal((await api(aliceAccount, '/state')).calls.length, 0);
        await search(alice, 'nobody-matches');
        await wait(
            alice,
            "document.querySelector('.voice-invite-list').textContent.includes('No matching members')",
            'empty search results are clear',
        );
        await search(alice, 'bOb');
        await wait(
            alice,
            "document.querySelectorAll('.voice-invite-member').length===1 && document.querySelector('.voice-invite-identity strong').textContent==='Bob'",
            'search is case insensitive',
        );
        assert.ok(
            await js(
                alice,
                "(()=>{const r=document.querySelector('.voice-invite-member').getBoundingClientRect(),b=document.querySelector('.voice-invite-member button').getBoundingClientRect();return Math.abs(r.right-b.right)<2;})()",
            ),
        );
        await click(bob, '.member[aria-label^="Message Alice"]');
        await click(alice, '.voice-invite-member button');
        await wait(
            alice,
            "document.querySelector('.voice-invite-member button').disabled && document.querySelector('.voice-invite-member button').textContent==='Sent'",
            'successful invitation becomes disabled Sent',
        );
        await wait(
            bob,
            '!!document.querySelector(\'.voice-invite-card [aria-label="Join lounge"]\')',
            'recipient receives a voice invitation as a normal direct message',
        );
        for (const theme of ['ember', 'canvas']) {
            await js(alice, `document.documentElement.dataset.theme=${JSON.stringify(theme)}`);
            await js(bob, `document.documentElement.dataset.theme=${JSON.stringify(theme)}`);
            assert.ok(
                await js(
                    bob,
                    "(() => {const style=getComputedStyle(document.querySelector('.voice-invite-card > button'));return style.color!==style.backgroundColor;})()",
                ),
                `${theme} Join text contrasts with its button`,
            );
            await screenshot(alice, theme + '-invite-popup');
            await screenshot(bob, theme + '-invitation-message');
        }
        await js(
            alice,
            "document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))",
        );
        await wait(
            alice,
            "!document.querySelector('.voice-invite-popup') && document.activeElement.getAttribute('aria-label')==='Invite to lounge'",
            'Escape closes popup and returns focus',
        );
        await click(alice, '[aria-label="Invite to lounge"]');
        await wait(
            alice,
            "[...document.querySelectorAll('.voice-invite-member')].some(row=>row.textContent.includes('Bob')&&!row.querySelector('button').disabled&&row.querySelector('button').textContent==='Invite')",
            'reopening allows a fresh invitation',
        );
        await js(
            alice,
            "document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))",
        );
        await click(bob, '.voice-invite-card button');
        await wait(
            bob,
            "document.querySelector('.voice-invite-card button').textContent==='Joined' && document.querySelector('.voice-invite-card button').disabled",
            'Join card connects recipient to the named voice channel',
        );
        assert.ok(
            (await api(aliceAccount, '/state')).calls.some(
                (call) => call.user === bobAccount.user.id && call.channel === 'lounge',
            ),
        );
        await wait(
            alice,
            '!!document.querySelector(".voice-member > .avatar.small")',
            'joined voice user uses the original small avatar row',
        );
        assert.equal(
            await js(
                alice,
                'document.querySelectorAll(".voice-member .member-identity, .voice-member .presence-dot, .tree-channel-manage, .tree-category-manage").length',
            ),
            0,
        );
        assert.equal(
            await js(
                alice,
                '[...document.querySelectorAll(".voice-member > span:not(.avatar)")].some(node=>node.textContent==="Bob")',
            ),
            true,
        );
        await screenshot(alice, 'restored-voice-user-layout');
        await bob.reload();
        await wait(
            bob,
            "document.querySelector('.server-heading small')?.textContent.includes('Connected')",
            'recipient reconnects',
        );
        if (!(await js(bob, "!!document.querySelector('.voice-invite-card')")))
            await click(bob, '.member[aria-label^="Message Alice"]');
        await wait(
            bob,
            '!!document.querySelector(\'.voice-invite-card [aria-label="Join lounge"]\')',
            'invitation card persists in DM history after reload',
        );
        bob.setContentSize(800, 700);
        await screenshot(bob, 'compact-invitation-message');
        assert.ok(
            await js(
                bob,
                "document.querySelector('.voice-invite-card').getBoundingClientRect().right<=innerWidth",
            ),
        );
        const roles = (await api(aliceAccount, '/state')).roles;
        const everyone = roles.find((role) => role.id === 'everyone');
        await api(aliceAccount, '/roles/everyone', 'PATCH', {
            name: everyone.name,
            color: everyone.color,
            permissions: everyone.permissions.filter((permission) => permission !== 'calls.join'),
        });
        await wait(
            bob,
            "document.querySelector('.voice-invite-card button').disabled && document.querySelector('.voice-invite-card button').textContent==='Unavailable'",
            'revoked channel access disables existing invitation cards',
        );
        assert.deepEqual(errors, []);
        console.log('PASS no renderer or CSP errors');
        clearTimeout(deadline);
        app.exit(0);
    })
    .catch((error) => {
        console.error(error);
        console.error(errors);
        clearTimeout(deadline);
        app.exit(1);
    });
