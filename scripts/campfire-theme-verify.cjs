const { app, BrowserWindow, nativeTheme } = require('electron');
const fs = require('node:fs');
app.setPath('userData', '/tmp/campfire-theme-verification');
app.commandLine.appendSwitch('disable-gpu');
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
app.whenReady()
    .then(async () => {
        nativeTheme.themeSource = 'dark';
        const win = new BrowserWindow({
            width: 1440,
            height: 960,
            useContentSize: true,
            show: true,
            webPreferences: { backgroundThrottling: false },
        });
        const js = (code) => win.webContents.executeJavaScript(code);
        const check = async (code, label) => {
            if (!(await js(code))) throw Error(label);
            console.log('PASS', label);
        };
        const load = async () => {
            await win.loadURL('http://127.0.0.1:5182/?interactive=1');
            await pause(650);
        };
        await load();
        await js('localStorage.removeItem("preferences")');
        await load();
        await check(
            'document.documentElement.dataset.theme === "ember"',
            'new client defaults to System / dark OS',
        );
        nativeTheme.themeSource = 'light';
        await pause(200);
        await check(
            'document.documentElement.dataset.theme === "canvas"',
            'System follows live OS change to light',
        );
        await js(
            'window.__review.setModal("settings");window.__review.setSettingsTab("appearance")',
        );
        await pause(200);
        await check(
            'document.querySelector("input[name=theme][value=system]").checked',
            'System radio is selected by default',
        );
        await js('document.querySelector("input[name=theme][value=dark]").click()');
        await pause(200);
        await check(
            'document.documentElement.dataset.theme === "ember" && JSON.parse(localStorage.getItem("preferences")).theme === "dark"',
            'Dark selects Ember and persists locally',
        );
        fs.writeFileSync(
            'Docs/campfire-review/theme-settings-dark.png',
            (await win.webContents.capturePage()).toPNG(),
        );
        nativeTheme.themeSource = 'dark';
        nativeTheme.themeSource = 'light';
        await pause(200);
        await check(
            'document.documentElement.dataset.theme === "ember"',
            'explicit Dark ignores OS changes',
        );
        await load();
        await check('document.documentElement.dataset.theme === "ember"', 'Dark survives reload');
        await js(
            'window.__review.setModal("settings");window.__review.setSettingsTab("appearance")',
        );
        await pause(100);
        await js('document.querySelector("input[name=theme][value=light]").click()');
        await pause(200);
        await check(
            'document.documentElement.dataset.theme === "canvas" && JSON.parse(localStorage.getItem("preferences")).theme === "light"',
            'Light selects Canvas and persists locally',
        );
        fs.writeFileSync(
            'Docs/campfire-review/theme-settings-light.png',
            (await win.webContents.capturePage()).toPNG(),
        );
        nativeTheme.themeSource = 'dark';
        await pause(200);
        await check(
            'document.documentElement.dataset.theme === "canvas"',
            'explicit Light ignores dark OS',
        );
        await load();
        await check('document.documentElement.dataset.theme === "canvas"', 'Light survives reload');
        await js(
            'window.__review.setModal("settings");window.__review.setSettingsTab("appearance")',
        );
        await pause(100);
        await js('document.querySelector("input[name=theme][value=system]").click()');
        await pause(200);
        await check(
            'document.documentElement.dataset.theme === "ember"',
            'returning to System immediately follows dark OS',
        );
        nativeTheme.themeSource = 'light';
        await pause(200);
        await check(
            'document.documentElement.dataset.theme === "canvas"',
            'System resumes live changes',
        );
        await js(
            'window.__review.resetModals();window.__review.setToken("");window.__review.setState(null)',
        );
        await pause(200);
        await check(
            '!!document.querySelector(".auth-shell") && document.documentElement.dataset.theme === "canvas"',
            'theme applies to sign-in',
        );
        nativeTheme.themeSource = 'dark';
        await pause(200);
        await check(
            'document.documentElement.dataset.theme === "ember"',
            'sign-in continues following System',
        );
        fs.writeFileSync(
            'Docs/campfire-review/theme-verification.json',
            JSON.stringify({ result: 'passed', checks: 13 }, null, 2),
        );
        win.destroy();
        app.quit();
    })
    .catch((error) => {
        console.error(error);
        app.exit(1);
    });
