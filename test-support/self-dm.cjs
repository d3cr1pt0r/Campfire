const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
app.setPath('userData', process.env.SELF_DM_PROFILE);
app.commandLine.appendSwitch('disable-gpu');
app.on('window-all-closed', () => {});
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const errors = [];
const deadline = setTimeout(() => {
    console.error('Self-DM verification timed out', errors);
    app.exit(1);
}, 45000);
app.whenReady()
    .then(async () => {
        const win = new BrowserWindow({
            width: 1440,
            height: 1000,
            show: true,
            webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false },
        });
        win.webContents.on('console-message', (event) => {
            if (event.level === 'error') errors.push(event.message);
        });
        const js = (code) => win.webContents.executeJavaScript(code, true);
        const wait = async (code, label) => {
            for (let i = 0; i < 150; i++) {
                if (await js(code)) {
                    console.log('PASS', label);
                    return;
                }
                await pause(100);
            }
            throw Error(`Timed out: ${label}\n${errors.join('\n')}`);
        };
        const click = (label) =>
            js(
                `(()=>{const node=[...document.querySelectorAll('button')].find(node=>node.getAttribute('aria-label')===${JSON.stringify(label)}||node.getAttribute('title')===${JSON.stringify(label)}||node.textContent.trim()===${JSON.stringify(label)});if(!node)throw Error('Missing button '+${JSON.stringify(label)});node.click()})()`,
            );
        await win.loadURL(process.env.SELF_DM_RENDERER);
        const account = JSON.parse(process.env.SELF_DM_ACCOUNT);
        await js(
            `localStorage.setItem('connection',JSON.stringify(${JSON.stringify({ url: process.env.SELF_DM_ORIGIN, token: account.token })}));localStorage.setItem('preferences',JSON.stringify({sounds:false,messageSounds:false,theme:'dark'}))`,
        );
        await win.reload();
        await wait(
            "document.querySelector('.server-heading small')?.textContent.includes('Connected')",
            'connected',
        );
        await click('Message Owner (you)');
        await wait(
            "document.querySelector('.channel-description')?.textContent.includes('Your private space')",
            'self member opens a personal DM',
        );
        assert.equal(await js("!!document.querySelector('.settings-modal')"), false);
        assert.equal(
            await js('document.querySelector(\'[aria-label="Call member"]\')?.disabled'),
            true,
        );
        assert.equal(
            await js(
                '!!document.querySelector(\'.member-row:has([aria-label="Message Owner (you)"]) .member-call\')',
            ),
            false,
        );
        await js("document.querySelector('.composer [contenteditable=true]').focus()");
        await win.webContents.insertText('A note to myself');
        await js(
            "(()=>{const input=document.querySelector('.composer input[type=file]');const transfer=new DataTransfer();transfer.items.add(new File(['Personal file'], 'personal.txt', {type:'text/plain'}));input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}))})()",
        );
        await wait(
            "!document.querySelector('.send-button').disabled",
            'self DM composer accepts text and file',
        );
        await click('Send message');
        await wait(
            "[...document.querySelectorAll('.message-text')].filter(node=>node.textContent==='A note to myself').length===1",
            'self note appears exactly once',
        );
        await wait(
            "!!document.querySelector('.message .file-pill') || document.querySelector('.messages')?.textContent.includes('personal.txt')",
            'personal file is shown',
        );
        await click('general');
        await wait(
            "document.querySelector('.channel-title strong')?.textContent==='general'",
            'channel navigation works',
        );
        await win.reload();
        await wait(
            "document.querySelector('.direct-message-name')?.textContent==='Owner (you)'",
            'self DM remains in Messages after reload',
        );
        await js("document.querySelector('.direct-message').click()");
        await wait(
            "[...document.querySelectorAll('.message-text')].some(node=>node.textContent==='A note to myself')",
            'personal history loads again',
        );
        assert.equal(
            await js('document.querySelector(\'[aria-label="Call member"]\')?.disabled'),
            true,
        );
        assert.equal(await js("document.querySelectorAll('.dm-unread').length"), 0);
        for (const theme of ['ember', 'canvas']) {
            await js(`document.documentElement.dataset.theme='${theme}'`);
            await pause(150);
            await fs.writeFile(
                `${process.env.SELF_DM_OUTPUT}/${theme}-self-dm.png`,
                (await win.webContents.capturePage()).toPNG(),
            );
        }
        // Other members retain their normal call control.
        await click('Message Other');
        await wait(
            "document.querySelector('.channel-title strong')?.textContent==='Other'",
            'normal member DM still opens',
        );
        assert.equal(
            await js('document.querySelector(\'[aria-label="Call member"]\')?.disabled'),
            false,
        );
        assert.deepEqual(errors, []);
        console.log(
            'PASS own messages stay read, self calls disabled, other member calls available, no renderer errors',
        );
        clearTimeout(deadline);
        app.exit(0);
    })
    .catch((error) => {
        console.error(error);
        clearTimeout(deadline);
        app.exit(1);
    });
