const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { installWindowPolicy } = require('../electron/window-policy.cjs');
app.setPath('userData', process.env.POPOUT_PROFILE);
app.on('window-all-closed', () => {});
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const deadline = setTimeout(() => {
    console.error('Pop-out verification timed out');
    app.exit(1);
}, 45000);
app.whenReady()
    .then(async () => {
        const main = new BrowserWindow({
            width: 1200,
            height: 800,
            webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
        });
        installWindowPolicy(main, { openExternal: async () => {} });
        const failures = [];
        main.webContents.on('console-message', (event) => {
            if (event.level === 'error') failures.push(event.message);
        });
        const js = (source) => main.webContents.executeJavaScript(source, true);
        const wait = async (predicate, label) => {
            for (let i = 0; i < 100; i++) {
                if (await predicate()) {
                    console.log('PASS', label);
                    return;
                }
                await pause(100);
            }
            throw Error(`Timed out: ${label}\n${failures.join('\n')}`);
        };
        const children = () => BrowserWindow.getAllWindows().filter((w) => w !== main);
        const click = (i) => js(`document.querySelectorAll('.popout-video')[${i}].click()`);
        await main.loadURL(process.env.POPOUT_URL);
        await wait(
            () => js('document.querySelectorAll(".popout-video").length === 2'),
            'two participant pop-out buttons',
        );
        await click(0);
        await click(1);
        await wait(() => children().length === 2, 'two independent native windows');
        for (const child of children()) {
            await wait(
                () =>
                    child.webContents.executeJavaScript(
                        '!!document.querySelector("video")?.videoWidth && !document.querySelector("video").paused',
                    ),
                'live video frames in pop-out',
            );
            assert.equal(child.isResizable(), true);
            child.setBounds({ x: 100, y: 120, width: 400, height: 300 });
            assert.equal(child.getBounds().width, 400);
            assert.equal(
                await child.webContents.executeJavaScript(
                    'document.querySelectorAll("audio").length',
                ),
                0,
            );
            assert.equal(
                await child.webContents.executeJavaScript('document.querySelector("video").muted'),
                true,
            );
            assert.equal(await child.webContents.executeJavaScript('typeof require'), 'undefined');
            assert.equal(
                await child.webContents.executeJavaScript(
                    'getComputedStyle(document.querySelector("main")).display',
                ),
                'flex',
            );
        }
        console.log('PASS native resize/move, isolated renderer, muted video with shared audio');
        const first = children().find((w) => w.getTitle().startsWith('Participant 1'));
        await first.webContents.executeJavaScript(
            `const slider = document.querySelector('input[aria-label="Stream volume for Participant 1"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(slider,'0.35'); slider.dispatchEvent(new Event('input', {bubbles:true}));`,
            true,
        );
        await wait(
            () =>
                js(
                    'document.querySelector(\'input[aria-label="Stream volume for Participant 1"]\').value === "0.35"',
                ),
            'pop-out volume updates call controls',
        );
        await js('document.documentElement.dataset.theme = "canvas"');
        await wait(
            () =>
                first.webContents.executeJavaScript(
                    'document.documentElement.dataset.theme === "canvas"',
                ),
            'theme follows main window',
        );
        await fs.writeFile('/tmp/campfire-stream-popout.png', (await first.capturePage()).toPNG());
        await click(0);
        assert.equal(children().length, 2);
        console.log('PASS repeated click focuses existing participant window');
        first.close();
        await wait(
            () =>
                js(
                    'document.querySelectorAll(".popout-video")[0].getAttribute("aria-pressed") === "false"',
                ),
            'native close resets button',
        );
        assert.equal(
            await js('document.querySelectorAll(".watch-stream")[0].getAttribute("aria-pressed")'),
            'true',
        );
        await click(0);
        await wait(() => children().length === 2, 'closed stream window reopens');
        const reopened = children().find((w) => w.getTitle().startsWith('Participant 1'));
        await reopened.webContents.executeJavaScript(
            'document.querySelector("footer button").click()',
            true,
        );
        await wait(() => children().length === 1, 'Stop watching closes its pop-out');
        assert.equal(
            await js('document.querySelectorAll(".watch-stream")[0].getAttribute("aria-pressed")'),
            'false',
        );
        await click(0);
        await wait(() => children().length === 2, 'pop-out starts watching again');
        await js('window.fixture.setSharing([false, true])');
        await wait(() => children().length === 1, 'ending a share closes only its window');
        await js('window.fixture.setMembers([false, false])');
        await wait(() => children().length === 0, 'leaving call closes remaining windows');
        await js(
            'window.fixture.setMembers([true, true]); window.fixture.setSharing([true, true])',
        );
        await wait(
            () => js('document.querySelectorAll(".popout-video").length === 2'),
            'call can rejoin',
        );
        await click(0);
        await wait(() => children().length === 1, 'rejoined call opens stream');
        main.destroy();
        await wait(
            () => BrowserWindow.getAllWindows().length === 0,
            'closing opener destroys stream windows',
        );
        assert.deepEqual(failures, []);
        clearTimeout(deadline);
        app.exit(0);
    })
    .catch((error) => {
        console.error(error);
        clearTimeout(deadline);
        app.exit(1);
    });
