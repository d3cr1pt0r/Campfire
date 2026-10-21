const { app, BrowserWindow, ipcMain } = require('electron');
const { createClientState } = require('../electron/client-state.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
app.setPath('userData', process.env.MEMBER_PROFILE);
app.on('window-all-closed', () => {});
const [alice, bob] = JSON.parse(process.env.MEMBER_FIXTURE);
const origin = process.env.MEMBER_ORIGIN;
const output = '/tmp/campfire-roles-review';
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
const openRoles = async (win) => {
    await js(
        win,
        'document.dispatchEvent(new KeyboardEvent("keydown",{key:",",ctrlKey:true,bubbles:true}))',
    );
    await wait(win, '!!document.querySelector(".settings-nav")', 'settings opens');
    await js(
        win,
        '[...document.querySelectorAll(".settings-nav button")].find(button=>button.textContent.includes("Roles & permissions")).click()',
    );
    await wait(
        win,
        '!!document.querySelector(".roles-settings")',
        'redesigned roles workspace opens',
    );
};
const input = async (win, selector, value) =>
    js(
        win,
        `{const node=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(node,${JSON.stringify(value)});node.dispatchEvent(new Event('input',{bubbles:true}));node.dispatchEvent(new Event('change',{bubbles:true}));}`,
    );
const screenshot = async (win, name) => {
    await pause(180);
    await fs.writeFile(path.join(output, name), (await win.capturePage()).toPNG());
};
const createRole = async (win, name, colored = false) => {
    await js(
        win,
        '[...document.querySelectorAll("button")].find(button=>button.textContent.trim()==="Create role").click()',
    );
    await wait(win, '!!document.querySelector(".role-editor")', 'role editor opens');
    await input(win, '.role-editor input[name="name"]', name);
    if (colored) {
        await js(win, 'document.querySelector(".role-color-control input[type=checkbox]").click()');
        await input(win, '.role-editor input[name="color"]', '#d076b3');
        await js(
            win,
            '[...document.querySelectorAll(".role-permission-group label")].find(label=>label.textContent.includes("Send channel messages")).querySelector("input").click()',
        );
    }
    await screenshot(win, colored ? 'role-editor.png' : 'role-no-color.png');
    await js(win, 'document.querySelector(".role-editor").requestSubmit()');
    await wait(
        win,
        `!![...document.querySelectorAll('.role-card strong')].find(node=>node.textContent===${JSON.stringify(name)})`,
        'role saved',
    );
};
const deadline = setTimeout(() => {
    console.error('Roles Electron validation timed out');
    app.exit(1);
}, 90000);
app.whenReady()
    .then(async () => {
        await fs.mkdir(output, { recursive: true });
        const a = await client(alice),
            b = await client(bob);
        await openRoles(a);
        await createRole(a, 'Presenter', true);
        await createRole(a, 'Helper');
        let state = await api(alice, '/state');
        assert.equal(
            state.roles.some((role) => role.id === 'member' || role.name === 'Member'),
            false,
        );
        const presenter = state.roles.find((role) => role.name === 'Presenter'),
            helper = state.roles.find((role) => role.name === 'Helper');
        assert.equal(helper.color, null);
        assert.deepEqual(
            helper.permissions,
            state.roles.find((role) => role.id === 'everyone').permissions,
        );
        assert.equal(presenter.color, '#d076b3');
        await js(
            a,
            'document.querySelector("button[aria-label=\\\"Move Presenter up\\\"]").click()',
        );
        await wait(
            a,
            'document.querySelector(".role-card strong").textContent==="Presenter"',
            'role reordering works',
        );
        await js(
            a,
            '[...document.querySelectorAll(".member-roles-card")].find(card=>card.querySelector("summary strong").textContent==="Bob").open=true',
        );
        await js(
            a,
            '{const card=[...document.querySelectorAll(".member-roles-card")].find(card=>card.querySelector("summary strong").textContent==="Bob");for(const name of ["Presenter","Helper"]) [...card.querySelectorAll("label")].find(label=>label.textContent.trim()===name).querySelector("input").click();card.querySelector("form").requestSubmit();}',
        );
        await wait(
            b,
            `document.querySelector('.member[aria-label="Message Bob (you)"]')?.textContent.includes('Presenter')`,
            'second client receives multiple roles live',
        );
        state = await api(bob, '/state');
        assert.equal(state.me.roles.length, 2);
        assert.equal(
            await js(
                b,
                'getComputedStyle(document.querySelector(".member[aria-label=\\\"Message Bob (you)\\\"] strong")).color',
            ),
            'rgb(208, 118, 179)',
        );
        await screenshot(b, 'member-role-color.png');
        await js(
            a,
            '{const card=[...document.querySelectorAll(".member-roles-card")].find(card=>card.querySelector("summary strong").textContent==="Bob");card.open=true;const select=card.querySelector(".permission-inspector select");select.value="general";select.dispatchEvent(new Event("change",{bubbles:true}));}',
        );
        await wait(
            a,
            '!!document.querySelector(".effective-permission-list small")',
            'effective permission reasons are rendered',
        );
        await screenshot(a, 'roles-overview.png');
        await js(
            a,
            'document.querySelector(".effective-permission-list").closest(".member-roles-card").scrollIntoView({block:"start"})',
        );
        await screenshot(a, 'roles-and-members.png');
        await js(
            a,
            'document.querySelector("button[aria-label=\\\"Edit Presenter role\\\"]").click()',
        );
        await wait(a, '!!document.querySelector(".role-editor")', 'existing role opens');
        await js(a, 'document.querySelector("#role-channels-tab").click()');
        await js(
            a,
            '{const detail=[...document.querySelectorAll(".role-channel-overrides")].find(node=>node.querySelector("summary").textContent.includes("general"));detail.open=true;}',
        );
        await js(
            a,
            '{for(const [permission,effect] of [["messages.send","deny"],["reactions.add","allow"]]){const select=document.querySelector(`select[aria-label="Presenter ${permission} in general"]`);select.value=effect;select.dispatchEvent(new Event("change",{bubbles:true}));}}',
        );
        await js(
            a,
            'document.querySelector(".role-channel-overrides[open]").scrollIntoView({block:"center"})',
        );
        await screenshot(a, 'channel-overrides.png');
        await js(a, 'document.querySelector(".role-editor").requestSubmit()');
        await wait(
            b,
            'document.querySelector(".chat-area .composer .rich-input")?.getAttribute("contenteditable") === "false"',
            'channel send denial updates second client',
        );
        assert.equal(
            await js(
                b,
                'document.body.textContent.includes("Full access") || document.body.textContent.includes("Read only")',
            ),
            false,
        );
        const privateChannel = await api(alice, '/channels', 'POST', {
            name: 'private-team',
            kind: 'text',
            private: true,
        });
        assert.equal(
            (await api(bob, '/state')).channels.some((entry) => entry.id === privateChannel.id),
            false,
        );
        await api(alice, `/roles/${presenter.id}/access`, 'PUT', {
            overrides: [
                { channel: privateChannel.id, permission: 'channels.view', effect: 'allow' },
            ],
        });
        await wait(
            b,
            '!![...document.querySelectorAll(".sidebar-content .channel")].find(node=>node.textContent.includes("private-team"))',
            'private channel appears only after explicit role grant',
        );
        await openRoles(b);
        assert.equal(
            await js(
                b,
                'document.querySelector("button[aria-label=\\\"Edit Default role\\\"]").disabled',
            ),
            true,
        );
        await screenshot(b, 'member-permissions-readonly.png');
        await b.reload();
        await wait(
            b,
            '!!document.querySelector(".server-heading")',
            'desktop reload retains session and roles',
        );
        for (const width of [960, 1440]) {
            a.setSize(width, 900);
            await pause(150);
            assert.equal(await js(a, 'document.documentElement.scrollWidth<=innerWidth'), true);
        }
        // The current Default settings are a creation template, including changed colors and overrides.
        const templatePermissions = ['channels.view', 'messages.send', 'reactions.add'];
        await api(alice, '/roles/everyone', 'PATCH', {
            name: 'Default',
            color: '#3c9f86',
            permissions: templatePermissions,
            overrides: [
                { channel: 'general', permission: 'messages.send', effect: 'deny' },
                { channel: 'general', permission: 'reactions.add', effect: 'allow' },
                { channel: 'lounge', permission: 'calls.camera', effect: 'deny' },
            ],
        });
        await wait(
            a,
            'document.querySelector(".roles-settings").textContent.includes("#3c9f86")',
            'current Default settings arrive',
        );
        await js(
            a,
            '[...document.querySelectorAll("button")].find(button=>button.textContent.trim()==="Create role").click()',
        );
        await wait(
            a,
            '!!document.querySelector(".role-editor")',
            'new role opens with baseline template',
        );
        assert.equal(
            await js(a, 'document.querySelector(".role-editor input[name=name]").value'),
            '',
        );
        assert.equal(
            await js(
                a,
                'document.querySelector(".role-color-control input[type=checkbox]").checked',
            ),
            true,
        );
        assert.equal(
            await js(a, 'document.querySelector(".role-editor input[name=color]").value'),
            '#3c9f86',
        );
        assert.deepEqual(
            await js(
                a,
                '[...document.querySelectorAll(".role-permission-group input:checked")].map(input=>input.closest("label").textContent.trim()).sort()',
            ),
            ['Add reactions', 'Send channel messages', 'View channels'].sort(),
        );
        await js(a, 'document.querySelector("#role-channels-tab").click()');
        for (const [permission, channel, effect] of [
            ['messages.send', 'general', 'deny'],
            ['reactions.add', 'general', 'allow'],
            ['calls.camera', 'lounge', 'deny'],
        ])
            assert.equal(
                await js(
                    a,
                    `document.querySelector(${JSON.stringify(`select[aria-label="New role ${permission} in ${channel}"]`)}).value`,
                ),
                effect,
            );
        await input(a, '.role-editor input[name=name]', 'Everyone copy');
        await js(a, 'document.querySelector(".role-editor").requestSubmit()');
        await wait(
            a,
            '!![...document.querySelectorAll(".role-card strong")].find(node=>node.textContent==="Everyone copy")',
            'baseline copy saves',
        );
        const copiedState = await api(alice, '/state');
        const copy = copiedState.roles.find((role) => role.name === 'Everyone copy');
        assert.equal(copy.color, '#3c9f86');
        assert.deepEqual(copy.permissions, templatePermissions);
        const overridesFor = (id) =>
            copiedState.channelPermissions
                .filter((entry) => entry.role === id)
                .map(({ channel, permission, effect }) => ({ channel, permission, effect }))
                .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
        assert.deepEqual(overridesFor(copy.id), overridesFor('everyone'));
        console.log(
            'PASS new roles copy Default permissions, optional color and channel overrides while keeping the name blank',
        );
        // Default becomes inactive with any explicit role and returns when the last checkbox is cleared.
        await api(alice, '/roles/everyone/access', 'PUT', {
            overrides: [{ channel: 'general', permission: 'messages.send', effect: 'inherit' }],
        });
        const restricted = await api(alice, '/roles', 'POST', {
            name: 'Restricted',
            color: null,
            permissions: ['channels.view'],
        });
        await api(alice, `/users/${bob.user.id}/roles`, 'PATCH', { roles: [restricted.id] });
        await wait(
            b,
            'document.querySelector(".chat-area .composer .rich-input")?.getAttribute("contenteditable") === "false"',
            'explicit restricted role replaces Default sending',
        );
        await wait(
            a,
            '[...document.querySelectorAll(".member-roles-card summary")].some(node=>node.textContent.includes("Bob") && node.textContent.includes("Restricted"))',
            'explicit assignment reaches role settings',
        );
        await js(
            a,
            '{const card=[...document.querySelectorAll(".member-roles-card")].find(card=>card.querySelector("summary strong").textContent==="Bob");card.open=true; [...card.querySelectorAll("label")].find(label=>label.textContent.trim()==="Restricted").querySelector("input").click();card.querySelector("form").requestSubmit();}',
        );
        await wait(
            b,
            'document.querySelector(".chat-area .composer .rich-input")?.getAttribute("contenteditable") === "true"',
            'clearing the last role restores Default sending',
        );
        assert.deepEqual((await api(bob, '/state')).me.roles, []);
        await wait(
            a,
            '[...document.querySelectorAll(".member-roles-card summary")].some(node=>node.textContent.includes("Bob") && node.textContent.includes("Default"))',
            'Default fallback appears in member summary',
        );
        await js(
            a,
            '{const card=[...document.querySelectorAll(".member-roles-card")].find(card=>card.querySelector("summary strong").textContent==="Bob");card.open=true;card.scrollIntoView({block:"start"});}',
        );
        await screenshot(a, 'default-fallback-active.png');
        console.log(
            'PASS explicit roles replace Default and clearing the final role restores it through the UI',
        );
        assert.deepEqual(failures, []);
        console.log(
            'PASS role creation, colors, multiple assignments, ordering, overrides, effective reasons, private access and cross-window updates',
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
