const { app, BrowserWindow, session, ipcMain } = require('electron');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const { createRendererServer, listenRendererServer } = require('../electron/renderer-server.cjs');
const { createClientState } = require('../electron/client-state.cjs');
const { installHttpPolicy, createHttpPolicy } = require('../electron/http-policy.cjs');
app.setPath('userData', process.env.HTTP_PROFILE);
app.commandLine.appendSwitch('no-proxy-server');
app.on('window-all-closed', () => {});
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const deadline = setTimeout(() => {
    console.error('HTTP desktop check timed out');
    app.exit(1);
}, 60000);
const origin = process.env.HTTP_ORIGIN;
const output = '/tmp/campfire-http-review';
let server;
app.whenReady()
    .then(async () => {
        const root = path.resolve(__dirname, '..');
        server = createRendererServer(path.join(root, 'dist'));
        await listenRendererServer(server);
        const rendererOrigin = `http://127.0.0.1:${server.address().port}`;
        const trusted = (url) => {
            try {
                return new URL(url).origin === rendererOrigin;
            } catch {
                return false;
            }
        };
        const clientState = createClientState(process.env.HTTP_PROFILE, {
            isEncryptionAvailable: () => false,
        });
        let confirmations = 0,
            confirmAnswer = false;
        installHttpPolicy({
            session: session.defaultSession,
            ipcMain,
            clientState,
            trusted,
            confirm: async () => {
                confirmations++;
                return confirmAnswer;
            },
        });
        ipcMain.on('client-state:get', (event, key) => {
            event.returnValue = trusted(event.senderFrame?.url) ? clientState.get(key) : null;
        });
        ipcMain.on('client-state:set', (event, key, value) => {
            event.returnValue = trusted(event.senderFrame?.url) && clientState.set(key, value);
        });
        ipcMain.handle('presence:idle-state', () => null);
        const win = new BrowserWindow({
            width: 1400,
            height: 1000,
            show: true,
            webPreferences: {
                preload: path.join(root, 'electron/preload.cjs'),
                contextIsolation: true,
                sandbox: true,
            },
        });
        const js = (source) => win.webContents.executeJavaScript(source, true);
        const wait = async (expression, label) => {
            for (let i = 0; i < 120; i++) {
                if (await js(expression)) {
                    console.log('PASS', label);
                    return;
                }
                await pause(100);
            }
            throw Error(`Timed out: ${label}`);
        };
        const fill = (selector, value) =>
            js(
                `{const input=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}));}`,
            );
        const opensSocket = (target) =>
            js(
                `new Promise(resolve => {const socket=new WebSocket(${JSON.stringify(target.replace('http:', 'ws:') + '/socket.io/?EIO=4&transport=websocket')});const timer=setTimeout(()=>{socket.close();resolve(false)},2000);socket.onopen=()=>{clearTimeout(timer);socket.close();resolve(true)};socket.onerror=()=>{clearTimeout(timer);resolve(false)}})`,
            );
        const blocked = (target) =>
            js(`fetch(${JSON.stringify(target + '/api/info')}).then(()=>false,()=>true)`);
        await win.loadURL(rendererOrigin);
        await wait('!!document.querySelector("input[name=url]")', 'production login renders');
        await fill('input[name=url]', origin + '/#invite=' + 'a'.repeat(64));
        await wait(
            '!!document.querySelector(".http-approval input")',
            'remote HTTP offers per-server opt-in',
        );
        assert.equal(await js('document.querySelector("input[name=url]").value'), origin);
        assert.equal(
            await js(`document.querySelector('input[maxlength="64"]').value`),
            'a'.repeat(64),
        );
        console.log('PASS HTTP invitation links populate the form without granting approval');
        assert.equal(
            await js('document.querySelector(".auth-form button.primary").disabled'),
            true,
        );
        assert.equal(await blocked(origin), true);
        assert.equal(await opensSocket(origin), false);
        console.log('PASS remote HTTP and WebSockets are blocked before approval');
        await js('document.querySelector(".http-approval input").click()');
        await pause(200);
        assert.equal(await js('document.querySelector(".http-approval input").checked'), false);
        assert.equal(confirmations, 1);
        assert.equal(await blocked(origin), true);
        console.log('PASS cancelling the confirmation keeps HTTP blocked');
        confirmAnswer = true;
        await js('document.querySelector(".http-approval input").click()');
        await wait(
            'document.querySelector(".http-approval input").checked',
            'explicit approval enables only the chosen server',
        );
        assert.equal(
            await js(`fetch(${JSON.stringify(origin + '/api/info')}).then(r=>r.status)`),
            200,
        );
        assert.equal(await blocked(origin.replace('127.0.0.2', '127.0.0.3')), true);
        assert.equal(await opensSocket(origin), true);
        assert.equal(await opensSocket(origin.replace('127.0.0.2', '127.0.0.3')), false);
        await js('document.querySelector(".auth-switch button").click()');
        await fill('input[name=username]', 'HttpTester');
        await fill('input[name=password]', 'http-test-password');
        await js('document.querySelector(".auth-form form").requestSubmit()');
        await wait(
            'document.querySelector(".connection-status")?.textContent.includes("Connected · Insecure HTTP")',
            'HTTP sign-in and live socket connect through production CSP',
        );
        assert.equal(
            createHttpPolicy(
                createClientState(process.env.HTTP_PROFILE, { isEncryptionAvailable: () => false }),
            ).isAllowed(origin),
            true,
        );
        await win.reload();
        await wait(
            'document.querySelector(".connection-status")?.textContent.includes("Connected · Insecure HTTP")',
            'saved HTTP session reconnects after reload',
        );
        assert.equal(confirmations, 2);
        await fs.mkdir(output, { recursive: true });
        await fs.writeFile(
            path.join(output, 'connected.png'),
            (await win.webContents.capturePage()).toPNG(),
        );
        await js('document.querySelector(".server-rail button[title=Settings]").click()');
        await wait(
            '[...document.querySelectorAll("button")].some(b=>b.textContent.trim()==="Sign out")',
            'settings exposes sign-out',
        );
        await js(
            '[...document.querySelectorAll("button")].find(b=>b.textContent.trim()==="Sign out").click()',
        );
        await wait(
            '!!document.querySelector(".http-approval input")',
            'sign-out keeps the per-server choice available',
        );
        await js('document.querySelector(".http-approval input").click()');
        await wait(
            '!document.querySelector(".http-approval input").checked',
            'approval can be revoked',
        );
        assert.equal(await blocked(origin), true);
        assert.equal(createHttpPolicy(clientState).isAllowed(origin), false);
        await fs.writeFile(
            path.join(output, 'http-login.png'),
            (await win.webContents.capturePage()).toPNG(),
        );
        const browser = new BrowserWindow({
            show: false,
            webPreferences: { contextIsolation: true, sandbox: true },
        });
        await browser.loadURL(rendererOrigin);
        await pause(300);
        await browser.webContents.executeJavaScript(
            `{const input=document.querySelector('input[name=url]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(origin)});input.dispatchEvent(new Event('input',{bubbles:true}));}`,
        );
        await pause(100);
        assert.equal(
            await browser.webContents.executeJavaScript(
                '!!document.querySelector(".http-approval")',
            ),
            false,
        );
        assert.equal(
            await browser.webContents.executeJavaScript(
                'document.querySelector(".auth-form button.primary").disabled',
            ),
            true,
        );
        console.log('PASS browser mode offers no remote HTTP opt-in');
        console.log(
            'PASS HTTP opt-in, cancellation, exact-origin isolation, persisted approval/session, revocation and browser restriction',
        );
        clearTimeout(deadline);
        app.exit(0);
    })
    .catch((error) => {
        console.error(error);
        clearTimeout(deadline);
        app.exit(1);
    });
