const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
app.setPath('userData', process.env.MEMBER_PROFILE);
app.on('window-all-closed', () => {});
const [alice, bob] = JSON.parse(process.env.MEMBER_FIXTURE);
const origin = process.env.MEMBER_ORIGIN;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const deadline = setTimeout(() => {
    console.error('Notification sound verification timed out');
    app.exit(1);
}, 60000);
app.whenReady()
    .then(async () => {
        const win = new BrowserWindow({
            width: 1200,
            height: 800,
            webPreferences: {
                contextIsolation: true,
                sandbox: true,
                nodeIntegration: false,
                backgroundThrottling: false,
            },
        });
        const js = (source) => win.webContents.executeJavaScript(source);
        await win.loadURL('about:blank');
        win.webContents.debugger.attach('1.3');
        await win.webContents.debugger.sendCommand('Page.enable');
        await win.webContents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', {
            source: `
        window.__expectedToneCheckpoint = 0;
        window.__notificationAudio = { contexts: [], tones: 0, peak: 0, notifications: [] };
        window.Notification = class {
            static permission = 'granted';
            constructor(title, options) { window.__notificationAudio.notifications.push({ title, ...options }); }
        };
        const OriginalAudioContext = window.AudioContext;
        window.AudioContext = class extends OriginalAudioContext {
            constructor(...args) { super(...args); window.__notificationAudio.contexts.push(this); }
            createOscillator() {
                const node = super.createOscillator(), start = node.start.bind(node);
                node.start = (...args) => { window.__notificationAudio.tones++; return start(...args); };
                return node;
            }
            createGain() {
                const node = super.createGain(), analyser = this.createAnalyser();
                node.connect(analyser);
                const data = new Float32Array(analyser.fftSize);
                const timer = setInterval(() => {
                    if (this.state === 'closed') { clearInterval(timer); return; }
                    analyser.getFloatTimeDomainData(data);
                    window.__notificationAudio.peak = Math.max(window.__notificationAudio.peak, ...data.map(Math.abs));
                }, 10);
                return node;
            }
        };
    `,
        });
        const wait = async (source, label) => {
            for (let i = 0; i < 60; i++) {
                if (await js(source)) {
                    if (source.includes('__notificationAudio.tones'))
                        await js(
                            'window.__expectedToneCheckpoint = window.__notificationAudio.tones',
                        );
                    console.log('PASS', label);
                    return;
                }
                await pause(100);
            }
            console.error(
                'Audio diagnostics:',
                await js(
                    'JSON.stringify({contexts:window.__notificationAudio.contexts.length, tones:window.__notificationAudio.tones, peak:window.__notificationAudio.peak, states:window.__notificationAudio.contexts.map(c=>c.state)})',
                ),
            );
            throw Error('Timed out: ' + label);
        };
        await win.loadURL(origin);
        await js(
            `localStorage.setItem('connection', JSON.stringify(${JSON.stringify({ url: origin, token: alice.token })})); localStorage.setItem('preferences',JSON.stringify({notifications:true,messageSounds:true,autoIdle:false,sounds:false}));`,
        );
        await win.loadURL(origin);
        await wait(
            'document.querySelector(".server-heading small")?.textContent.includes("Connected")',
            'saved account connects without pointer or keyboard interaction',
        );
        win.hide();
        const send = async (body, room = 'dm:' + [alice.user.id, bob.user.id].sort().join(':')) => {
            const response = await fetch(origin + '/api/messages', {
                method: 'POST',
                headers: {
                    Authorization: 'Bearer ' + bob.token,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    room,
                    body,
                }),
            });
            assert.equal(response.status, 200);
        };
        await send('DM while the app is hidden immediately after startup');
        await wait(
            '!!document.querySelector(".dm-unread")',
            'DM arrives while the window is hidden',
        );
        await wait(
            'window.__notificationAudio.tones > window.__expectedToneCheckpoint && window.__notificationAudio.peak > 0.001',
            'hidden window produces nonzero DM notification audio without prior interaction',
        );
        await pause(800);
        await js('window.__notificationAudio.contexts[0].suspend()');
        await send('DM after the audio context was suspended');
        await wait(
            'window.__notificationAudio.tones > window.__expectedToneCheckpoint && window.__notificationAudio.contexts[0].state === "running"',
            'suspended sound context resumes on next DM',
        );
        await pause(800);
        win.show();
        await js(
            'document.dispatchEvent(new KeyboardEvent("keydown", { key: ",", ctrlKey: true, bubbles: true }))',
        );
        await wait('!!document.querySelector(".settings-nav")', 'settings opens for playback test');
        await js(
            '[...document.querySelectorAll(".settings-nav button")].find(button => button.textContent.includes("Notifications")).click()',
        );
        await wait(
            '[...document.querySelectorAll("button")].some(button => button.textContent === "Test notification sound")',
            'notification settings offer a sound test',
        );
        await js(
            '[...document.querySelectorAll("button")].find(button => button.textContent === "Test notification sound").click()',
        );
        await wait(
            'window.__notificationAudio.tones > window.__expectedToneCheckpoint',
            'test sound button uses the live notification player',
        );
        const openNotifications = async () => {
            await js(
                'document.dispatchEvent(new KeyboardEvent("keydown", { key: ",", ctrlKey: true, bubbles: true }))',
            );
            await wait('!!document.querySelector(".settings-nav")', 'notification settings open');
            await js(
                '[...document.querySelectorAll(".settings-nav button")].find(button => button.textContent.includes("Notifications")).click()',
            );
        };
        const setMode = async (mode, settings = false) => {
            if (!settings) await openNotifications();
            const label = '#general notifications';
            await js(
                `{ const select = [...document.querySelectorAll('select')].find(node => node.getAttribute('aria-label') === ${JSON.stringify(label)}); select.value = ${JSON.stringify(mode)}; select.dispatchEvent(new Event('change', { bubbles: true })); }`,
            );
            await pause(100);
            if (!settings)
                await js(`document.querySelector('button[aria-label="Close dialog"]').click()`);
        };
        await wait(
            `document.querySelector('input[name="server-notification-mode"][value="mentions"]').checked`,
            'server defaults to Mentions only',
        );
        await setMode('all', true);
        await fs.writeFile(
            path.join(process.env.MEMBER_OUTPUT, 'channel-notifications-settings.png'),
            (await win.capturePage()).toPNG(),
        );
        await js(`document.querySelector('button[aria-label="Close dialog"]').click()`);
        await wait(
            `!document.querySelector('.top-actions .channel-notification-select') && !document.querySelector('.top-actions button[aria-label="Mute conversation"]')`,
            'channel notification controls are absent from the header',
        );
        win.hide();
        await pause(800);
        await send('ordinary channel message in all mode', 'general');
        await wait(
            'window.__notificationAudio.tones > window.__expectedToneCheckpoint',
            'All messages plays a sound for ordinary channel messages',
        );
        await wait(
            'window.__notificationAudio.notifications.some(notice => notice.body === "Bob posted in #general" && notice.silent === true)',
            'channel desktop alert names the channel without exposing message text',
        );
        await setMode('mentions');
        await send('ordinary channel message in mentions mode', 'general');
        await wait(
            'document.querySelector(".chat-area").textContent.includes("ordinary channel message in mentions mode")',
            'mentions-only channel still receives ordinary messages',
        );
        await pause(800);
        assert.equal(
            await js('window.__notificationAudio.tones'),
            await js('window.__expectedToneCheckpoint'),
        );
        await send('@Alice mention in mentions mode', 'general');
        await wait(
            'window.__notificationAudio.tones > window.__expectedToneCheckpoint',
            'Mentions only plays a sound for a direct mention',
        );
        await setMode('muted');
        await pause(800);
        await send('@Alice mention in muted mode', 'general');
        await wait(
            'document.querySelector(".chat-area").textContent.includes("mention in muted mode")',
            'muted channel still receives messages',
        );
        await pause(300);
        assert.equal(
            await js('window.__notificationAudio.tones'),
            await js('window.__expectedToneCheckpoint'),
        );
        console.log('PASS Muted suppresses notification audio');
        await win.loadURL(origin);
        await wait('!!document.querySelector(".server-heading")', 'renderer reloads');
        await openNotifications();
        await wait(
            `document.querySelector('select[aria-label="#general notifications"]')?.value === 'muted'`,
            'channel mode survives renderer reload',
        );
        await js(`document.querySelector('button[aria-label="Close dialog"]').click()`);
        win.show();
        win.setSize(960, 640);
        await pause(300);
        assert.equal(await js('document.documentElement.scrollWidth <= innerWidth'), true);
        await fs.writeFile(
            path.join(process.env.MEMBER_OUTPUT, 'channel-notifications-header.png'),
            (await win.capturePage()).toPNG(),
        );
        console.log('PASS header without notification controls fits narrow desktop layout');
        await setMode('all');
        win.focus();
        await wait(
            'document.hasFocus() && document.visibilityState === "visible"',
            'channel window is visibly focused',
        );
        await send('focused current channel message', 'general');
        await wait(
            'document.querySelector(".chat-area").textContent.includes("focused current channel message")',
            'focused channel receives the message',
        );
        await pause(800);
        assert.equal(await js('window.__notificationAudio.tones'), 0);
        console.log('PASS focused current channel stays silent');
        await send('@Alice message in another channel', 'introductions');
        await wait(
            'window.__notificationAudio.tones > window.__expectedToneCheckpoint',
            'other channels still play notification sounds while focused',
        );
        await pause(800);
        const other = new BrowserWindow({ width: 400, height: 300 });
        await other.loadURL('about:blank');
        other.focus();
        await wait(
            '!document.hasFocus() && document.visibilityState === "visible"',
            'channel window remains visible but loses focus',
        );
        await send('unfocused current channel message', 'general');
        await wait(
            'window.__notificationAudio.tones > window.__expectedToneCheckpoint',
            'visible unfocused channel plays notification sounds',
        );
        other.destroy();
        win.hide();
        await pause(800);
        await send('hidden current channel message', 'general');
        await wait(
            'window.__notificationAudio.tones > window.__expectedToneCheckpoint',
            'hidden current channel plays notification sounds',
        );
        win.show();
        win.focus();
        await wait('document.hasFocus()', 'conversation window regains focus');
        await js(`document.querySelector('.member[aria-label^="Message Bob"]').click()`);
        await wait(
            'document.querySelector(".channel-title strong")?.textContent === "Bob"',
            'current DM opens',
        );
        await pause(800);
        await send('focused current DM message');
        await wait(
            'document.querySelector(".chat-area").textContent.includes("focused current DM message")',
            'focused DM receives the message',
        );
        await pause(300);
        assert.equal(
            await js('window.__notificationAudio.tones'),
            await js('window.__expectedToneCheckpoint'),
        );
        console.log('PASS focused current DM stays silent');
        // Exercise server/category inheritance through real UI changes and socket messages.
        const ownerApi = async (endpoint, method, body) => {
            const response = await fetch(origin + '/api' + endpoint, {
                method,
                headers: {
                    Authorization: 'Bearer ' + alice.token,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(body),
            });
            assert.equal(response.status, 200);
            return response.json();
        };
        const category = await ownerApi('/categories', 'POST', { name: 'Notification category' });
        await ownerApi('/channels/introductions/category', 'PUT', {
            category: category.id,
            synced: false,
        });
        await openNotifications();
        const choose = async (selector, value) =>
            js(
                '{const node=document.querySelector(' +
                    JSON.stringify(selector) +
                    ');node.value=' +
                    JSON.stringify(value) +
                    ';node.dispatchEvent(new Event("change",{bubbles:true}));}',
            );
        await wait(
            '!!document.querySelector(\'select[aria-label="Notification category category notifications"]\')',
            'new notification category is visible',
        );
        await js(
            'document.querySelector(\'input[name="server-notification-mode"][value="all"]\').click()',
        );
        await pause(800);
        await send('ordinary message inherits server all', 'introductions');
        await wait(
            'window.__notificationAudio.tones > window.__expectedToneCheckpoint',
            'server All messages reaches actual playback',
        );
        await choose('select[aria-label="Notification category category notifications"]', 'muted');
        await pause(800);
        await send('@Alice category suppresses this mention', 'introductions');
        await pause(400);
        assert.equal(
            await js('window.__notificationAudio.tones'),
            await js('window.__expectedToneCheckpoint'),
        );
        await choose('select[aria-label="#introductions notifications"]', 'all');
        await pause(800);
        await send('explicit channel wins over muted category', 'introductions');
        await wait(
            'window.__notificationAudio.tones > window.__expectedToneCheckpoint',
            'explicit channel override reaches actual playback',
        );
        await choose('select[aria-label="#introductions notifications"]', 'inherit');
        await pause(800);
        await send('@Alice back to silent category', 'introductions');
        await pause(400);
        assert.equal(
            await js('window.__notificationAudio.tones'),
            await js('window.__expectedToneCheckpoint'),
        );
        await choose(
            'select[aria-label="Notification category category notifications"]',
            'inherit',
        );
        await pause(800);
        await send('removed category falls back to server all', 'introductions');
        await wait(
            'window.__notificationAudio.tones > window.__expectedToneCheckpoint',
            'removing override restores inherited sound delivery',
        );

        // Closing the renderer disconnects its socket: badges must be restored from the
        // database rather than relying on message events or the old React state.
        await js('document.querySelector(\'button[aria-label="Close dialog"]\').click()');
        await js(
            'document.querySelector(\'button[aria-label="Remove conversation with Bob from Messages"]\').click()',
        );
        await js(`{
            const key = ${JSON.stringify('direct-messages:' + origin + ':' + alice.user.id)};
            const saved = JSON.parse(localStorage.getItem(key));
            for (const room in saved.hidden) saved.hidden[room] = Date.now() + 86400000;
            localStorage.setItem(key, JSON.stringify(saved));
        }`);
        win.hide();
        await win.loadURL('about:blank');
        await send('Missed DM while Campfire was closed');
        await send('Missed channel message while Campfire was closed', 'introductions');
        await win.loadURL(origin);
        await wait(
            'document.querySelector(".dm-unread")?.textContent.trim() === "1"',
            'missed DM restores its badge and reopens a previously hidden conversation',
        );
        await wait(
            '[...document.querySelectorAll(".nav-item.channel")].some(node => node.textContent.includes("introductions") && node.querySelector(".count"))',
            'missed channel badge restores after the renderer was closed',
        );
        assert.equal(await js('window.__notificationAudio.tones'), 0);
        assert.equal(await js('window.__notificationAudio.notifications.length'), 0);
        console.log('PASS restoring missed activity does not replay sounds or desktop alerts');
        win.show();
        win.focus();
        await wait('document.hasFocus()', 'restored app receives focus');
        await js('document.querySelector(\'.direct-message[aria-label^="Message Bob"]\').click()');
        await wait(
            '!document.querySelector(".dm-unread")',
            'opening the focused DM clears its persisted badge',
        );
        const dmRoom = 'dm:' + [alice.user.id, bob.user.id].sort().join(':');
        assert.equal((await ownerApi('/activity', 'GET')).unread[dmRoom], undefined);
        await send('Focused restored DM receives another message');
        await wait(
            'document.querySelector(".chat-area").textContent.includes("Focused restored DM receives another message") && !document.querySelector(".dm-unread")',
            'focused open DM receives new messages without an unread badge',
        );
        await pause(200);
        assert.equal(await js('window.__notificationAudio.tones'), 0);
        assert.equal((await ownerApi('/activity', 'GET')).unread[dmRoom], undefined);
        console.log('PASS focused DM suppression also persists its read position');

        win.destroy();
        clearTimeout(deadline);
        app.exit(0);
    })
    .catch((error) => {
        console.error(error);
        clearTimeout(deadline);
        app.exit(1);
    });
