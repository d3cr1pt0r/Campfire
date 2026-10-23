const { app, BrowserWindow, desktopCapturer } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
app.setPath('userData', process.env.VIDEO_PROFILE);
for (const flag of ['use-fake-device-for-media-stream', 'use-fake-ui-for-media-stream'])
    app.commandLine.appendSwitch(flag);
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('force-device-scale-factor', '1');
// The fake microphone beeps; nobody should hear it through the other window.
app.commandLine.appendSwitch('mute-audio');
app.on('window-all-closed', () => {});
const [aliceAccount, bobAccount] = JSON.parse(process.env.VIDEO_ACCOUNTS);
const origin = process.env.VIDEO_ORIGIN,
    renderer = process.env.VIDEO_RENDERER,
    output = process.env.VIDEO_OUTPUT;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const errors = [];
const js = (win, source) => win.webContents.executeJavaScript(source, true);
const wait = async (win, source, label, attempts = 150) => {
    for (let attempt = 0; attempt < attempts; attempt++) {
        if (await js(win, source)) {
            console.log('PASS', label);
            return;
        }
        await pause(100);
    }
    throw Error(`Timed out: ${label}\n${errors.join('\n')}`);
};
const click = async (win, label) => {
    const found = await js(
        win,
        `(() => { const node=[...document.querySelectorAll('button')].find(n=>n.textContent.trim()===${JSON.stringify(label)} || n.getAttribute('aria-label')===${JSON.stringify(label)} || n.getAttribute('title')===${JSON.stringify(label)}); node?.click(); return !!node; })()`,
    );
    assert.ok(found, `Button exists: ${label}`);
};
// The control of a labelled field in the Camera or Screen sharing group.
const field = (legend, label, advanced = false) =>
    `[...([...document.querySelectorAll('${advanced ? '.video-advanced ' : ''}.video-quality-columns fieldset')].find(f=>f.querySelector('legend')?.textContent===${JSON.stringify(legend)})?.querySelectorAll('label') ?? [])].find(l=>l.textContent.startsWith(${JSON.stringify(label)}))?.querySelector('select,input')`;
// React listens for input events on ranges and change events on selects.
const setControl = (win, control, value) =>
    js(
        win,
        `(() => {const node=${control}; if(!node) throw Error('Missing control'); const prototype=node instanceof HTMLSelectElement?HTMLSelectElement.prototype:HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(prototype,'value').set.call(node,${JSON.stringify(String(value))}); node.dispatchEvent(new Event(node instanceof HTMLSelectElement?'change':'input',{bubbles:true}));})()`,
    );
const prefs = (win) => js(win, `JSON.parse(localStorage.getItem('preferences'))`);
// The GPU stays enabled so video uses the hardware encoder, and capturing a GPU-composited page
// occasionally fails; screenshots are for review only, so a failed one is skipped.
const screenshot = async (win, name) => {
    for (let attempt = 0; attempt < 3; attempt++) {
        await pause(250);
        try {
            const image = await win.webContents.capturePage();
            await fs.writeFile(`${output}/${name}.png`, image.toPNG());
            return;
        } catch (error) {
            if (attempt === 2) console.log('SKIP screenshot', name, error.message);
        }
    }
};
// The outgoing video sender's limits and the stats the app samples, from every connection.
const videoSenders = (win) =>
    js(
        win,
        `window.__video.peers.filter(pc=>pc.connectionState!=='closed').map(pc=>{const sender=pc.getTransceivers().find(t=>t.receiver.track.kind==='video')?.sender; const parameters=sender?.getParameters(); return {track:sender?.track?.kind||null, hint:sender?.track?.contentHint??null, settings:sender?.track?.getSettings()||null, encoding:parameters?.encodings?.[0]||null, degradation:parameters?.degradationPreference||null};})`,
    );
async function client(account, name) {
    const win = new BrowserWindow({
        width: 1400,
        height: 940,
        show: true,
        webPreferences: {
            partition: 'video-' + name,
            contextIsolation: true,
            sandbox: true,
            backgroundThrottling: false,
        },
    });
    win.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) =>
        callback(true),
    );
    // Shares the primary screen without the app's picker; it stays on this machine.
    win.webContents.session.setDisplayMediaRequestHandler(async (_request, callback) => {
        const [screen] = await desktopCapturer.getSources({ types: ['screen'] });
        callback({ video: screen });
    });
    win.webContents.on('console-message', (event) => {
        if (event.level === 'error') errors.push(`${name}: ${event.message}`);
    });
    await win.loadURL('about:blank');
    win.webContents.debugger.attach('1.3');
    await win.webContents.debugger.sendCommand('Page.enable');
    await win.webContents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', {
        source: `
        window.__video={peers:[],display:[],limit:null};
        const Peer=window.RTCPeerConnection;
        window.RTCPeerConnection=class extends Peer {
            constructor(...args){super(...args);window.__video.peers.push(this);}
            // Lets the check report a bandwidth limit, as Chromium does on a congested link.
            async getStats(...args){
                const report=await super.getStats(...args);
                if(!window.__video.limit) return report;
                const changed=new Map();
                report.forEach((stat,id)=>changed.set(id,stat.type==='outbound-rtp'&&stat.kind==='video'?{...stat,qualityLimitationReason:window.__video.limit}:stat));
                return changed;
            }
        };
        const display=navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices);
        navigator.mediaDevices.getDisplayMedia=async constraints=>{window.__video.display.push(constraints);return display(constraints);};
    `,
    });
    await win.loadURL(renderer);
    await js(
        win,
        `localStorage.setItem('connection',JSON.stringify(${JSON.stringify({ url: origin, token: account.token })}));localStorage.setItem('preferences',JSON.stringify({theme:'ember',noise:false,sounds:false,messageSounds:false,autoIdle:false,quality:'720'}));`,
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
    console.error('Video quality verification timed out');
    app.exit(1);
}, 150000);
app.whenReady()
    .then(async () => {
        const alice = await client(aliceAccount, 'Alice'),
            bob = await client(bobAccount, 'Bob');

        await click(alice, 'Settings');
        await click(alice, 'Audio & Video');
        await wait(alice, "!!document.querySelector('.video-quality-columns')", 'video settings');
        assert.equal(
            await js(alice, `${field('Screen sharing', 'Resolution')}.value`),
            'source',
            'screens default to their own resolution',
        );
        await setControl(alice, field('Screen sharing', 'Frame rate'), '15');
        await js(alice, "document.querySelector('.video-advanced').open=true");
        await setControl(alice, field('Screen sharing', 'Bitrate', true), '4');
        await wait(
            alice,
            "document.querySelector('.video-advanced').textContent.includes('High · up to')",
            'bitrate slider shows the resulting ceiling',
        );
        const saved = await prefs(alice);
        assert.equal(saved.screenFrameRate, 15);
        assert.equal(saved.screenBitrate, 2);
        for (const theme of ['ember', 'canvas']) {
            await js(alice, `document.documentElement.dataset.theme=${JSON.stringify(theme)}`);
            await js(alice, "document.querySelector('.video-advanced').scrollIntoView()");
            await screenshot(alice, `${theme}-video-settings`);
        }
        await js(alice, "document.documentElement.dataset.theme='ember'");
        await js(
            alice,
            `document.querySelector('.settings-modal [aria-label="Close dialog"]')?.click()`,
        );

        const join = (win) =>
            js(
                win,
                "[...document.querySelectorAll('.voice-channel-row button.nav-item')].find(b=>b.textContent.includes('lounge')).click()",
            );
        await join(alice);
        await join(bob);
        await wait(alice, "!!document.querySelector('.call-panel')", 'Alice is in the call');
        await wait(bob, "!!document.querySelector('.call-panel')", 'Bob is in the call');
        await wait(
            alice,
            "[...document.querySelectorAll('.media-tile')].some(tile=>tile.getAttribute('aria-label')==='Bob')",
            'Alice sees Bob in the call',
        );
        await click(alice, 'Share screen or window');
        await wait(
            alice,
            '!!document.querySelector(\'[aria-label="Stop screen sharing"]\')',
            'Alice shares',
        );
        const [constraints] = await js(alice, 'window.__video.display');
        assert.deepEqual(constraints.video, { frameRate: { ideal: 15, max: 15 } });
        await wait(bob, "!!document.querySelector('.watch-stream')", 'Bob sees the share');
        await js(bob, "document.querySelector('.watch-stream').click()");
        await wait(
            alice,
            "window.__video.peers.some(pc=>pc.getTransceivers().some(t=>t.receiver.track.kind==='video'&&t.sender.track))",
            'screen video attached for the subscribed viewer',
        );
        await wait(
            alice,
            "window.__video.peers.some(pc=>pc.getTransceivers().some(t=>t.sender.track?.kind==='video'&&t.sender.getParameters().encodings[0]?.maxBitrate))",
            'screen limits applied to the sender',
        );
        let [sender] = (await videoSenders(alice)).filter((entry) => entry.track);
        const { width, height } = sender.settings;
        console.log('Captured', `${width}x${height}`, 'sender', JSON.stringify(sender.encoding));
        assert.equal(sender.hint, 'detail');
        assert.equal(sender.degradation, 'maintain-resolution');
        assert.equal(sender.encoding.maxFramerate, 15);
        // 2x the 30 fps ceiling for this size, at 15 fps (0.75).
        const expected = Math.max(
            300_000,
            Math.round((ceiling(width * height) * 0.75 * 2) / 50_000) * 50_000,
        );
        assert.equal(sender.encoding.maxBitrate, expected);
        const automatic = Math.max(
            300_000,
            Math.round((ceiling(width * height) * 0.75) / 50_000) * 50_000,
        );

        // A setting changed mid-share reaches the running sender without a new share.
        await click(alice, 'Settings');
        await click(alice, 'Audio & Video');
        await wait(alice, "!!document.querySelector('.video-quality-columns')", 'settings reopen');
        await js(alice, "document.querySelector('.video-advanced').open=true");
        await setControl(alice, field('Screen sharing', 'Bitrate', true), '2');
        await js(
            alice,
            `document.querySelector('.settings-modal [aria-label="Close dialog"]')?.click()`,
        );
        await wait(
            alice,
            `window.__video.peers.some(pc=>pc.getTransceivers().some(t=>t.sender.track?.kind==='video'&&t.sender.getParameters().encodings[0]?.maxBitrate===${automatic}))`,
            'a mid-call bitrate change updates the sender',
        );

        // A lower resolution mid-share rescales the running capture and lowers the ceiling.
        await click(alice, 'Settings');
        await click(alice, 'Audio & Video');
        await wait(alice, "!!document.querySelector('.video-quality-columns')", 'settings reopen');
        await setControl(alice, field('Screen sharing', 'Resolution'), '720');
        await js(
            alice,
            `document.querySelector('.settings-modal [aria-label="Close dialog"]')?.click()`,
        );
        // Chromium's fake capture device, used here for a predictable microphone, restarts at its
        // own fixed size instead of scaling, so this checks the constraint reaching the running
        // track and the ceiling following the size it reports. Real screens scale to the limit.
        await wait(
            alice,
            "window.__video.peers.some(pc=>pc.getTransceivers().some(t=>t.sender.track?.kind==='video'&&t.sender.track.getConstraints().height?.max===720&&t.sender.track.getSettings().height!==" +
                height +
                '))',
            'the running share takes the 720p limit',
        );
        await pause(2000);
        [sender] = (await videoSenders(alice)).filter((entry) => entry.track);
        console.log('Resized', JSON.stringify(sender.settings), JSON.stringify(sender.encoding));
        assert.equal(
            sender.encoding.maxBitrate,
            Math.max(
                300_000,
                Math.round(
                    (ceiling(sender.settings.width * sender.settings.height) * 0.75) / 50_000,
                ) * 50_000,
            ),
        );

        await click(alice, 'Connection diagnostics');
        await click(bob, 'Connection diagnostics');
        await wait(
            alice,
            "/Your video to them: \\d+×\\d+ · .*(kbps|Mbps) of [\\d.]+ Mbps · VP8 on CPU/.test(document.querySelector('.call-details')?.textContent)",
            'Alice sees her live outgoing video bitrate against its ceiling',
        );
        await wait(
            bob,
            "/Their video to you: \\d+×\\d+ · .*(kbps|Mbps) · VP8/.test(document.querySelector('.call-details')?.textContent) && /Total upload: .* download: /.test(document.querySelector('.call-details').textContent)",
            'Bob sees the incoming video and totals',
        );
        await screenshot(alice, 'diagnostics-sender');
        await screenshot(bob, 'diagnostics-viewer');

        await js(alice, "window.__video.limit='bandwidth'");
        await wait(
            alice,
            "document.querySelector('.call-video-warning')?.getAttribute('aria-label').includes(\"The connection between you and Bob\")",
            'Alice is warned which connection reduces her video',
            120,
        );
        await wait(
            bob,
            "document.querySelector('.media-video-warning')?.getAttribute('aria-label').includes('between you and Alice')",
            "Bob's tile shows why Alice's video is reduced",
        );
        assert.match(
            await js(alice, "document.querySelector('.call-details').textContent"),
            /Your video to them: .* · The connection between you and Bob is reducing your video to them\./,
        );
        await screenshot(alice, 'warning-sender');
        await screenshot(bob, 'warning-viewer');
        await js(alice, 'window.__video.limit=null');
        await wait(alice, "!document.querySelector('.call-video-warning')", 'warning clears', 120);
        await wait(bob, "!document.querySelector('.media-video-warning')", 'viewer warning clears');
        assert.deepEqual(errors, []);
        console.log('Video quality verification passed');
        clearTimeout(deadline);
        app.exit(0);
    })
    .catch((error) => {
        console.error(error);
        app.exit(1);
    });
// The same 30 fps screen ceilings as src/videoQuality.ts.
function ceiling(pixels) {
    const points = [
        [1280 * 720, 3_000_000],
        [1920 * 1080, 5_000_000],
        [2560 * 1440, 8_000_000],
        [3840 * 2160, 14_000_000],
    ];
    let index = 1;
    while (index < points.length - 1 && pixels > points[index][0]) index++;
    const [x0, y0] = points[index - 1],
        [x1, y1] = points[index];
    return y0 + ((y1 - y0) * (pixels - x0)) / (x1 - x0);
}
