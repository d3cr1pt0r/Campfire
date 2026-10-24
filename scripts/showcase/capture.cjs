const { app, BrowserWindow, nativeTheme } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { version } = require('../../package.json');

app.setPath('userData', process.env.SHOWCASE_PROFILE);
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('mute-audio');
app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.commandLine.appendSwitch('lang', 'en-US');
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const hash = (buffer) => createHash('sha256').update(buffer).digest('hex');
const preview = process.env.SHOWCASE_PREVIEW === '1';
const deadline = setTimeout(() => {
    console.error('Showcase capture timed out before the UI was ready.');
    app.exit(1);
}, 45000);

app.whenReady()
    .then(async () => {
        const { scenario, replies, state } = await import('./fixture.mjs');
        const replyCount = replies.filter((reply) => reply.thread === scenario.thread).length;
        nativeTheme.themeSource = 'dark';
        const window = new BrowserWindow({
            width: scenario.width,
            height: scenario.height,
            useContentSize: true,
            show: true,
            backgroundColor: '#19191b',
            webPreferences: { backgroundThrottling: false },
        });
        const failures = [];
        window.webContents.on('console-message', (event) => {
            if (event.level === 'error') failures.push(event.message);
        });
        const session = window.webContents.session;
        session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
        session.setPermissionCheckHandler(() => false);
        const origin = process.env.SHOWCASE_URL;
        session.webRequest.onBeforeRequest((request, callback) => {
            const allowed =
                request.url === 'about:blank' ||
                request.url.startsWith(`${origin}/`) ||
                request.url.startsWith(`${origin.replace('http:', 'ws:')}/`) ||
                /^(blob:|data:)/.test(request.url);
            if (!allowed) failures.push(`Blocked unexpected request: ${request.url}`);
            callback({ cancel: !allowed });
        });
        session.webRequest.onCompleted((request) => {
            if (request.statusCode >= 400) failures.push(`${request.statusCode}: ${request.url}`);
        });
        console.log('Preparing showcase browser…');
        await window.loadURL('about:blank');
        window.webContents.debugger.attach('1.3');
        await window.webContents.debugger.sendCommand('Emulation.setTimezoneOverride', {
            timezoneId: scenario.timezone,
        });
        const js = (source) => window.webContents.executeJavaScript(source);
        const waitFor = async (expression, label) => {
            for (let attempt = 0; attempt < 120; attempt++) {
                if (await js(expression)) return;
                if (failures.length) throw new Error(failures.join('\n'));
                await pause(100);
            }
            throw new Error(`Showcase was not ready: ${label}`);
        };
        const check = async (expression, label) => {
            if (!(await js(expression))) throw new Error(`Showcase check failed: ${label}`);
            console.log(`PASS ${label}`);
        };
        console.log('Loading the sample community…');
        await window.loadURL(origin);
        console.log('Waiting for the application UI…');
        await window.webContents.insertCSS(
            '*, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }',
        );
        await waitFor(
            '!!window.__showcase && !!document.querySelector(".call-splitter") && !!document.querySelector(".chat-area .composer")',
            'sample community and call',
        );
        await js('document.fonts.ready.then(() => window.__showcase.mediaReady)');
        console.log('Preparing the call and thread layout…');

        // Use the real resize handler and thread action, rather than setting component internals.
        const key = async (value) => {
            await js(
                `document.querySelector('.call-splitter').dispatchEvent(new KeyboardEvent('keydown', {key:${JSON.stringify(value)},bubbles:true}))`,
            );
            await pause(30);
        };
        await key('Home');
        const minimum = await js(
            `Number(document.querySelector('.call-splitter').getAttribute('aria-valuemin'))`,
        );
        const steps = Math.round((scenario.callHeight - minimum) / 20);
        for (let step = 0; step < steps; step++) await key('ArrowUp');
        const replySelector = `[data-message-id="${scenario.thread}"] .thread-replies`;
        await waitFor(
            `!!document.querySelector(${JSON.stringify(replySelector)})`,
            'thread action',
        );
        await js(`document.querySelector(${JSON.stringify(replySelector)}).click()`);
        await waitFor(
            `document.querySelectorAll('.thread-panel .messages .message').length === ${replyCount}`,
            'thread replies',
        );
        await waitFor(
            `[...document.images].every(image => image.complete && image.naturalWidth > 0)`,
            'sample avatars',
        );
        await js('window.__showcase.requestFrame()');
        await waitFor(
            `[...document.querySelectorAll('.call-participant video')].some(video => video.readyState >= 2 && video.videoWidth === 1280)`,
            'synthetic shared screen',
        );
        for (let pass = 0; pass < 3; pass++) {
            await js(
                `document.querySelectorAll('.messages').forEach(element => {element.scrollTop=element.scrollHeight; element.dispatchEvent(new Event('scroll'));})`,
            );
            await pause(150);
        }
        await js('document.activeElement?.blur()');
        window.webContents.sendInputEvent({ type: 'mouseMove', x: 1, y: 1 });

        await check(
            `document.documentElement.dataset.theme === 'graphite' && innerWidth === ${scenario.width} && innerHeight === ${scenario.height} && devicePixelRatio === 1`,
            'fixed dark theme, viewport, and device scale',
        );
        await check(
            `document.querySelector('.server-heading .connection-status').textContent.includes('Connected to server')`,
            'current sidebar connection status',
        );
        await check(
            `document.querySelectorAll('.call-participant:not([hidden])').length === ${state.calls.length} && !!document.querySelector('[aria-label="More call options"]')`,
            'current call layout and options',
        );
        await check(
            `!!document.querySelector('.thread-original .message') && !document.querySelector('.thread-panel .messages [data-message-id="${scenario.thread}"]') && !!document.querySelector('.thread-header input')`,
            'separate original message and compact thread search',
        );
        await check(
            `(() => {const a=document.querySelector('.chat-area .composer').getBoundingClientRect(),b=document.querySelector('.thread-panel .composer').getBoundingClientRect();return a.height===50 && b.height===50 && Math.abs(a.bottom-b.bottom)<1})()`,
            'compact aligned message composers',
        );
        await check(
            `(() => {const a=document.querySelector('.call-heading .panel-expand').getBoundingClientRect(),b=document.querySelector('.top-actions .panel-expand').getBoundingClientRect();return Math.abs(a.left-b.left)<1 && document.documentElement.scrollWidth===innerWidth})()`,
            'aligned expand controls and no horizontal overflow',
        );
        if (failures.length) throw new Error(failures.join('\n'));

        // Require two identical frames so partially loaded images or moving layout never replace the README.
        let png;
        let previous;
        for (let attempt = 0; attempt < 12; attempt++) {
            await pause(200);
            const capture = await window.webContents.capturePage();
            const size = capture.getSize();
            if (size.width !== scenario.width || size.height !== scenario.height)
                throw new Error(`Unexpected screenshot dimensions: ${JSON.stringify(size)}`);
            const current = capture.toPNG();
            if (previous && hash(current) === hash(previous)) {
                png = current;
                break;
            }
            previous = current;
        }
        if (!png) throw new Error('Showcase pixels did not settle into a repeatable frame.');
        const output = process.env.SHOWCASE_OUTPUT;
        const metadata = {
            scenario: scenario.id,
            appVersion: version,
            viewport: { width: scenario.width, height: scenario.height, scale: 1 },
            timezone: scenario.timezone,
            theme: 'dark',
            data: 'Synthetic community, avatars, and shared screen; no live account or call.',
            sha256: hash(png),
        };
        await fs.mkdir(path.dirname(output), { recursive: true });
        await fs.writeFile(`${output}.tmp`, png);
        await fs.rename(`${output}.tmp`, output);
        await fs.writeFile(
            output.replace(/\.png$/, '.json'),
            `${JSON.stringify(metadata, null, 2)}\n`,
        );
        console.log(`Saved ${output}\nSHA-256 ${metadata.sha256}`);
        clearTimeout(deadline);
        if (preview) {
            console.log('Showcase preview is open. Close its window to stop the fixture server.');
            window.on('closed', () => app.quit());
        } else {
            window.destroy();
            app.quit();
        }
    })
    .catch((error) => {
        clearTimeout(deadline);
        console.error(error);
        app.exit(1);
    });
