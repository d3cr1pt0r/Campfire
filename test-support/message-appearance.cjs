const { app, BrowserWindow, ipcMain } = require('electron');
const { createClientState } = require('../electron/client-state.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
app.setPath('userData', process.env.APPEARANCE_PROFILE);
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.commandLine.appendSwitch('mute-audio');
app.on('window-all-closed', () => {});
const [alice, bob] = JSON.parse(process.env.APPEARANCE_ACCOUNTS);
const origin = process.env.APPEARANCE_ORIGIN,
    renderer = process.env.APPEARANCE_RENDERER,
    output = process.env.APPEARANCE_OUTPUT;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const errors = [],
    states = new Map();
ipcMain.on('client-state:get', (event, key) => {
    event.returnValue = states.get(event.sender.id).get(key);
});
ipcMain.on('client-state:set', (event, key, value) => {
    event.returnValue = states.get(event.sender.id).set(key, value);
});
ipcMain.on('http:is-allowed', (event) => {
    event.returnValue = false;
});
ipcMain.handle('presence:idle-state', () => ({ seconds: 0, locked: false }));
const js = (win, source) => win.webContents.executeJavaScript(source, true);
const wait = async (win, source, label) => {
    for (let i = 0; i < 140; i++) {
        if (await js(win, source)) {
            console.log('PASS', label);
            return;
        }
        await pause(100);
    }
    throw Error(`Timed out: ${label}\n${errors.join('\n')}`);
};
const click = (win, label) =>
    js(
        win,
        `(()=>{const node=[...document.querySelectorAll('button')].find(node=>node.textContent.trim()===${JSON.stringify(label)}||node.getAttribute('aria-label')===${JSON.stringify(label)}||node.getAttribute('title')===${JSON.stringify(label)});if(!node)throw Error('Missing button '+${JSON.stringify(label)});node.click();})()`,
    );
const select = (win, selector, value) =>
    js(
        win,
        `(()=>{const node=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(node,${JSON.stringify(value)});node.dispatchEvent(new Event('change',{bubbles:true}));})()`,
    );
const input = (win, selector, value) =>
    js(
        win,
        `(()=>{const node=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(node,${JSON.stringify(value)});node.dispatchEvent(new Event('input',{bubbles:true}));})()`,
    );
const preferences = (win) => js(win, "JSON.parse(window.campfire.storage.getItem('preferences'))");
const shot = async (win, name) => {
    await pause(200);
    await fs.writeFile(`${output}/${name}.png`, (await win.webContents.capturePage()).toPNG());
};
const settings = async (win, tab = 'My account') => {
    await click(win, 'Settings');
    await click(win, tab);
    await wait(win, "!!document.querySelector('.settings-content')", tab + ' opens');
};
const closeSettings = async (win) => {
    await click(win, 'Close dialog');
    await wait(win, "!document.querySelector('.settings-modal')", 'settings close');
};
async function client(account, name) {
    const win = new BrowserWindow({
        width: 1440,
        height: 1000,
        show: true,
        webPreferences: {
            preload: path.resolve(__dirname, '../electron/preload.cjs'),
            partition: 'appearance-' + name,
            contextIsolation: true,
            sandbox: true,
            backgroundThrottling: false,
        },
    });
    states.set(
        win.webContents.id,
        createClientState(path.join(process.env.APPEARANCE_PROFILE, name), {
            isEncryptionAvailable: () => false,
        }),
    );
    win.webContents.on('console-message', (event) => {
        if (event.level === 'error') errors.push(event.message);
    });
    await win.loadURL(renderer);
    await js(
        win,
        `window.campfire.storage.setItem('connection',JSON.stringify(${JSON.stringify({ url: origin, token: account.token })}));window.campfire.storage.setItem('preferences',JSON.stringify({theme:'dark',autoIdle:false,sounds:false,messageSounds:false}));`,
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
    console.error('Message appearance verification timed out');
    app.exit(1);
}, 90000);
app.whenReady()
    .then(async () => {
        const win = await client(alice, 'alice');
        await settings(win);
        if (process.env.APPEARANCE_BASELINE) {
            for (const theme of ['ember', 'canvas']) {
                await js(
                    win,
                    `document.documentElement.dataset.theme='${theme}';document.querySelector('.settings-content').scrollTop=0;`,
                );
                await shot(win, `${theme}-account-before`);
            }
            await closeSettings(win);
            await shot(win, 'messages-normal-before');
            clearTimeout(deadline);
            app.exit(0);
            return;
        }
        assert.equal(
            await js(win, "document.querySelectorAll('.account-behavior [role=switch]').length"),
            2,
        );
        assert.equal(
            await js(
                win,
                "!!document.querySelector('.account-security:not([open])') && !!document.querySelector('.account-frames:not([open])')",
            ),
            true,
        );
        await click(win, 'Close to system tray');
        await click(win, 'Set Idle automatically when I’m away');
        await select(win, '.account-idle-delay select', '10');
        let saved = await preferences(win);
        assert.equal(saved.closeToTray, false);
        assert.equal(saved.autoIdle, true);
        assert.equal(saved.idleMinutes, 10);
        await input(win, 'input[name=nickname]', 'Ali');
        await click(win, 'Save nickname');
        await wait(
            win,
            "document.querySelector('.profile-card h3').textContent==='Ali'",
            'nickname save still updates profile',
        );
        await click(win, 'Dismiss notification');
        assert.equal(
            await js(win, "document.querySelector('.account-nickname-form input[readonly]').value"),
            'Alice',
        );
        await js(win, "document.querySelector('.account-frames').open=true");
        assert.ok(
            await js(
                win,
                "document.querySelectorAll('.account-frames input[type=radio]').length>20",
            ),
        );
        await js(
            win,
            "document.querySelector('.account-frames').open=false;document.querySelector('.account-security').open=true",
        );
        assert.equal(
            await js(
                win,
                "[...document.querySelectorAll('.account-security input')].filter(input=>input.required).length",
            ),
            3,
        );
        await js(win, "document.querySelector('.account-security').open=false");
        for (const theme of ['ember', 'canvas']) {
            await js(
                win,
                `document.documentElement.dataset.theme='${theme}';document.querySelector('.settings-content').scrollTop=0;`,
            );
            await shot(win, `${theme}-account-after`);
            await js(
                win,
                "document.querySelector('.account-security').open=true;document.querySelector('.account-security').scrollIntoView({block:'start'})",
            );
            await shot(win, `${theme}-account-security`);
            await js(
                win,
                "document.querySelector('.account-security').open=false;document.querySelector('.settings-content').scrollTop=0",
            );
        }
        win.setContentSize(760, 780);
        await pause(150);
        assert.equal(
            await js(
                win,
                "document.querySelector('.settings-content').scrollWidth>document.querySelector('.settings-content').clientWidth",
            ),
            false,
        );
        await shot(win, 'account-compact');
        win.setContentSize(1440, 1000);
        await click(win, 'Appearance');
        await wait(
            win,
            '!!document.querySelector(\'[aria-label="Message avatars"]\')',
            'message avatar settings available in Appearance',
        );
        const heights = {};
        for (const mode of ['normal', 'compact', 'hidden']) {
            await select(win, '[aria-label="Message avatars"]', mode);
            await wait(
                win,
                `document.querySelector('.message-avatar-preview .message').classList.contains('message-avatars-${mode}')`,
                'live layout preview ' + mode,
            );
            assert.equal((await preferences(win)).messageAvatars, mode);
            if (mode === 'hidden') await shot(win, 'appearance-message-controls');
            await closeSettings(win);
            await pause(250);
            await wait(
                win,
                `[...document.querySelectorAll('.chat-area .virtual-message .message')].every(node=>node.classList.contains('message-avatars-${mode}'))`,
                'channel mode ' + mode,
            );
            const size = await js(
                win,
                `(()=>{const nodes=[...document.querySelectorAll('.chat-area .virtual-message .message')];const row=nodes.find(node=>node.querySelector('.message-text')?.textContent.startsWith('Short message'));if(!row) throw Error('No single-line sample');return {height:row.getBoundingClientRect().height,avatar:row.querySelector(':scope > .avatar')?.getBoundingClientRect().width||0,text:row.querySelector('.message-text').textContent,author:!!row.querySelector('.message-meta'),all:nodes.map(node=>({top:node.getBoundingClientRect().top,bottom:node.getBoundingClientRect().bottom}))};})()`,
            );
            heights[mode] = size.height;
            assert.equal(size.avatar, mode === 'hidden' ? 0 : mode === 'compact' ? 20 : 28);
            assert.ok(size.author);
            for (let i = 1; i < size.all.length; i++)
                assert.ok(
                    size.all[i].top >= size.all[i - 1].bottom - 1,
                    'virtual messages do not overlap',
                );
            for (const theme of ['ember', 'canvas']) {
                await js(win, `document.documentElement.dataset.theme='${theme}'`);
                await shot(win, `${theme}-messages-${mode}`);
            }
            await js(
                win,
                `document.querySelector('[data-message-id="${process.env.APPEARANCE_PARENT}"] .thread-replies').click()`,
            );
            await wait(
                win,
                `document.querySelectorAll('.thread-panel .message.message-avatars-${mode}').length>=2`,
                'thread mode ' + mode,
            );
            assert.equal(
                await js(
                    win,
                    "document.querySelectorAll('.thread-panel .message > .avatar').length===0",
                ),
                mode === 'hidden',
            );
            await shot(win, `thread-${mode}`);
            await click(win, 'Close thread');
            await js(win, 'document.querySelector(\'.member[aria-label^="Message Bob"]\').click()');
            await wait(
                win,
                `document.querySelector('.chat-area .message.message-avatars-${mode} .message-text')?.textContent.startsWith('Direct message')`,
                'DM mode ' + mode,
            );
            assert.ok(await js(win, "document.querySelectorAll('.member-list .avatar').length>0"));
            await shot(win, `dm-${mode}`);
            await js(
                win,
                "[...document.querySelectorAll('.channel')].find(node=>node.textContent.trim()==='general').click()",
            );
            await wait(
                win,
                `!!document.querySelector('[data-message-id="${process.env.APPEARANCE_PARENT}"] .thread-replies')`,
                'return to channel',
            );
            await settings(win, 'Appearance');
        }
        assert.ok(
            heights.hidden < heights.compact && heights.compact < heights.normal,
            JSON.stringify(heights),
        );
        console.log('PASS measured single-line message heights', JSON.stringify(heights));
        await closeSettings(win);
        await win.reload();
        await wait(
            win,
            "document.querySelector('.chat-area .message.message-avatars-hidden')",
            'hidden avatars persist after reload',
        );
        saved = await preferences(win);
        assert.equal(saved.autoIdle, true);
        assert.equal(saved.closeToTray, false);
        assert.equal(saved.idleMinutes, 10);
        await settings(win);
        assert.equal(
            await js(win, "document.querySelector('.account-idle-delay select').value"),
            '10',
        );
        assert.equal(
            await js(
                win,
                "document.querySelector('.account-behavior [aria-label=\"Close to system tray\"]').getAttribute('aria-checked')",
            ),
            'false',
        );
        console.log('PASS Behavior preferences persist after reload');
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
