const { app, BrowserWindow, session, ipcMain } = require('electron');
const { installScreenAudio } = require('../electron/screen-audio.cjs');
const { createRendererServer, listenRendererServer } = require('../electron/renderer-server.cjs');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
app.setPath('userData', process.env.SCREEN_AUDIO_PROFILE);
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const errors = [];
const js = (win, source) => win.webContents.executeJavaScript(source, true);
const wait = async (win, source, label) => {
    for (let attempt = 0; attempt < 100; attempt++) {
        if (await js(win, source)) {
            console.log('PASS', label);
            return;
        }
        await pause(100);
    }
    throw Error(
        `Timed out: ${label}\n${await js(win, 'document.body.textContent')}\n${JSON.stringify(await js(win, 'window.screenAudioTest.diagnostic()'))}\n${errors.join('\n')}`,
    );
};
const deadline = setTimeout(() => {
    console.error('Screen audio test timed out');
    app.exit(1);
}, 60000);
app.whenReady().then(async () => {
    const server = createRendererServer(process.env.SCREEN_AUDIO_DIST);
    let capture;
    try {
        await listenRendererServer(server, 0);
        const origin = `http://127.0.0.1:${server.address().port}`;
        capture = installScreenAudio({
            app,
            ipcMain,
            helperPath: path.resolve(__dirname, '../electron/native/bin/campfire-pipewire'),
            trusted: (url) => url?.startsWith(origin + '/'),
        });
        session.defaultSession.setPermissionRequestHandler((_contents, permission, callback) =>
            callback(permission === 'media'),
        );
        session.defaultSession.setPermissionCheckHandler(
            (_contents, permission) => permission === 'media',
        );
        const client = async () => {
            const win = new BrowserWindow({
                width: 1050,
                height: 760,
                show: true,
                webPreferences: {
                    preload: path.resolve(__dirname, '../electron/preload.cjs'),
                    contextIsolation: true,
                    sandbox: true,
                    nodeIntegration: false,
                    backgroundThrottling: false,
                },
            });
            win.webContents.on('console-message', (event) => {
                if (event.level === 'error') errors.push(event.message);
            });
            await win.loadURL(origin + '/test-support/screen-audio.html');
            await wait(
                win,
                "!!document.querySelector('#capture-status')",
                'fixture loads under desktop CSP',
            );
            return win;
        };
        const sender = await client(),
            receiver = await client();
        capture.selected(sender.webContents, { name: 'Synthetic game window' });
        await js(
            sender,
            "[...document.querySelectorAll('button')].find(node=>node.textContent==='Choose audio').click()",
        );
        await wait(
            sender,
            '!!document.querySelector(\'[aria-label="Screen-share audio"]\')',
            'audio confirmation opens',
        );
        await fs.mkdir(process.env.SCREEN_AUDIO_OUTPUT, { recursive: true });
        await fs.writeFile(
            path.join(process.env.SCREEN_AUDIO_OUTPUT, 'confirmation.png'),
            (await sender.webContents.capturePage()).toPNG(),
        );
        await js(
            sender,
            `(()=>{const select=document.querySelector('select');const option=[...select.options].find(option=>option.textContent==='Campfire browser test tone');if(!option)throw Error('Missing test application');const setter=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;setter.call(select,option.value);select.dispatchEvent(new Event('change',{bubbles:true}));})()`,
        );
        await js(
            sender,
            "[...document.querySelectorAll('button')].find(node=>node.textContent==='Start sharing').click()",
        );
        await wait(
            sender,
            "document.querySelector('#capture-status').textContent==='Sharing'",
            'Chromium captures the exact PipeWire virtual source',
        );
        const tracks = await js(sender, 'window.screenAudioTest.tracks()');
        assert.equal(
            tracks.filter((track) => track.kind === 'audio' && track.state === 'live').length,
            1,
        );
        assert.ok(tracks.find((track) => track.kind === 'audio').label.includes('campfire-share-'));
        const offer = await js(sender, 'window.screenAudioTest.offer()');
        const answer = await js(
            receiver,
            `window.screenAudioTest.answer(${JSON.stringify(offer)})`,
        );
        await js(sender, `window.screenAudioTest.connect(${JSON.stringify(answer)})`);
        await wait(
            receiver,
            'window.screenAudioTest.rms()>0.01',
            'remote client decodes audible screen-share samples',
        );
        const stats = await js(receiver, 'window.screenAudioTest.stats()');
        assert.ok(stats.some((entry) => entry.kind === 'audio' && entry.bytes > 0));
        console.log('PASS real audio RTP arrives in a second Electron client');
        await js(
            sender,
            "[...document.querySelectorAll('button')].find(node=>node.textContent==='Stop').click()",
        );
        await wait(
            sender,
            "window.screenAudioTest.tracks().every(track=>track.state==='ended')",
            'stop ends screen capture tracks',
        );
        await pause(200);
        const sources = JSON.parse(execFileSync('pw-dump', { encoding: 'utf8' }))
            .filter((entry) => entry.type.endsWith(':Node'))
            .map((entry) => entry.info.props['node.name']);
        assert.ok(!sources.some((name) => name?.startsWith('campfire-share-')));
        console.log('PASS temporary audio source is removed');
        capture.selected(sender.webContents, { name: 'Another window' });
        await js(
            sender,
            "[...document.querySelectorAll('button')].find(node=>node.textContent==='Choose audio').click()",
        );
        await wait(sender, "!!document.querySelector('select')", 'confirmation can reopen');
        await js(
            sender,
            "[...document.querySelectorAll('button')].find(node=>node.textContent==='Cancel').click()",
        );
        await wait(
            sender,
            "document.querySelector('#capture-status').textContent==='Cancelled'",
            'cancel stops the pending video capture',
        );
        assert.deepEqual(errors, []);
        console.log(`Screenshot: ${process.env.SCREEN_AUDIO_OUTPUT}/confirmation.png`);
        capture.close();
        server.close();
        clearTimeout(deadline);
        app.exit(0);
    } catch (error) {
        console.error(error);
        capture?.close();
        server.close();
        clearTimeout(deadline);
        app.exit(1);
    }
});
