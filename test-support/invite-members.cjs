const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
app.setPath('userData', process.env.INVITE_PROFILE);
app.commandLine.appendSwitch('disable-gpu');
app.on('window-all-closed', () => {});
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const errors = [];
const deadline = setTimeout(() => {
    console.error('Invite UI verification timed out', errors);
    app.exit(1);
}, 60000);
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
            for (let i = 0; i < 160; i++) {
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
                `(()=>{const node=[...document.querySelectorAll('button')].find(node=>node.getAttribute('aria-label')===${JSON.stringify(label)}||node.textContent.trim()===${JSON.stringify(label)});if(!node)throw Error('Missing button '+${JSON.stringify(label)});node.click()})()`,
            );
        const search = (value) =>
            js(
                `(()=>{const input=document.querySelector('[aria-label="Search members to invite"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}))})()`,
            );
        const names = () =>
            js(
                "[...document.querySelectorAll('.voice-invite-identity strong')].map(node=>node.textContent)",
            );
        const shot = async (name) => {
            await pause(150);
            await fs.writeFile(
                `${process.env.INVITE_OUTPUT}/${name}.png`,
                (await win.webContents.capturePage()).toPNG(),
            );
        };
        await win.loadURL(process.env.INVITE_RENDERER);
        const account = JSON.parse(process.env.INVITE_ACCOUNT);
        await js(
            `localStorage.setItem('connection',JSON.stringify(${JSON.stringify({ url: process.env.INVITE_ORIGIN, token: account.token })}));localStorage.setItem('preferences',JSON.stringify({sounds:false,messageSounds:false,theme:'dark'}))`,
        );
        await win.reload();
        await wait(
            "document.querySelector('.server-heading small')?.textContent.includes('Connected')",
            'connected',
        );
        await click('Invite to lounge');
        await wait(
            "document.querySelectorAll('.voice-invite-member').length===5",
            'voice invite list loaded',
        );
        assert.deepEqual(await names(), ['Able', 'Zeta', 'Idle', 'Busy', 'Offline']);
        assert.equal(
            await js("document.activeElement?.getAttribute('aria-label')"),
            'Search members to invite',
        );
        await search('off');
        assert.deepEqual(await names(), ['Offline']);
        await click('Invite Offline');
        await wait(
            "!!document.querySelector('[aria-label=" +
                JSON.stringify('Invitation sent to Offline') +
                "]')?.disabled",
            'Sent is disabled after invitation',
        );
        await shot('voice-sent');
        await click('Close invitations');
        assert.equal(
            await js("document.activeElement?.getAttribute('aria-label')"),
            'Invite to lounge',
        );
        await click('Invite to lounge');
        await wait(
            "document.querySelectorAll('.voice-invite-member').length===5",
            'voice popup reopened with reset search',
        );
        assert.equal(
            await js(
                "document.querySelector('[aria-label=" +
                    JSON.stringify('Invite Offline') +
                    "]')?.disabled",
            ),
            false,
        );
        await click('Invite Offline');
        await wait(
            "!!document.querySelector('[aria-label=" +
                JSON.stringify('Invitation sent to Offline') +
                "]')?.disabled",
            'reopened popup can send again immediately',
        );
        // Delay an old response and close its picker: it must not mark the next
        // opening Sent when that old request eventually completes.
        await js(
            `window.originalInviteFetch=window.fetch;window.fetch=async (...args)=>{const response=await window.originalInviteFetch(...args);if(String(args[0]).includes('/voice-channels/')&&args[1]?.method==='POST')await new Promise(resolve=>setTimeout(resolve,600));return response};void 0`,
        );
        await click('Invite Busy');
        await click('Close invitations');
        await click('Invite to lounge');
        await wait(
            "document.querySelectorAll('.voice-invite-member').length===5",
            'fresh popup opens during earlier send',
        );
        await pause(800);
        assert.equal(
            await js(
                "document.querySelector('[aria-label=" +
                    JSON.stringify('Invite Busy') +
                    "]')?.disabled",
            ),
            false,
        );
        await js('window.fetch=window.originalInviteFetch;void 0');
        for (const theme of ['ember', 'canvas']) {
            await js(`document.documentElement.dataset.theme='${theme}'`);
            await shot(`${theme}-voice-invite`);
        }
        win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
        await wait("!document.querySelector('.voice-invite-popup')", 'Escape closes voice popup');
        await js(
            `navigator.mediaDevices.getUserMedia=async()=>{const context=new AudioContext();const source=context.createOscillator();const output=context.createMediaStreamDestination();source.connect(output);source.start();window.inviteTestContext=context;return output.stream};void 0`,
        );
        await click('Call Zeta');
        await wait(
            "!!document.querySelector('[aria-label=" + JSON.stringify('Invite member') + "]')",
            'private call joined',
        );
        await click('Invite member');
        await wait(
            "!!document.querySelector('.call-invite-picker')",
            'call invite uses shared picker',
        );
        assert.deepEqual(await names(), ['Able', 'Zeta', 'Idle', 'Busy', 'Offline']);
        assert.equal(
            await js(
                "document.querySelector('[aria-label=" +
                    JSON.stringify('Invite Offline') +
                    "]')?.disabled",
            ),
            true,
        );
        await search('abl');
        assert.deepEqual(await names(), ['Able']);
        await click('Invite Able');
        await wait(
            "!!document.querySelector('[aria-label=" +
                JSON.stringify('Invitation sent to Able') +
                "]')?.disabled",
            'call invitation sent without closing member picker',
        );
        await search('');
        for (const theme of ['ember', 'canvas']) {
            await js(`document.documentElement.dataset.theme='${theme}'`);
            await shot(`${theme}-call-invite`);
        }
        await click('Close dialog');
        await click('Invite member');
        await wait(
            "document.querySelector('[aria-label=" +
                JSON.stringify('Invite Able') +
                "]')?.textContent.trim()==='Invited'",
            'existing private call invitation remains disabled',
        );
        assert.deepEqual(errors, []);
        console.log(
            'PASS ordering, search, per-opening Sent state, pending-response isolation, keyboard dismissal, focus restoration, and call availability',
        );
        clearTimeout(deadline);
        app.exit(0);
    })
    .catch((error) => {
        console.error(error);
        clearTimeout(deadline);
        app.exit(1);
    });
