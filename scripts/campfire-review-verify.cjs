const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
app.setPath('userData', '/tmp/campfire-review-verification');
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
app.whenReady()
    .then(async () => {
        const win = new BrowserWindow({
            show: false,
            width: 1440,
            height: 960,
            useContentSize: true,
            webPreferences: { backgroundThrottling: false },
        });
        const js = (s) => win.webContents.executeJavaScript(s);
        await win.loadURL('http://127.0.0.1:5182/Docs/campfire-review/index.html');
        const check = async (expression, label) => {
            if (!(await js(expression))) {
                console.log(
                    await js(
                        '({count:document.querySelectorAll(".screen").length,filter:document.querySelector("#filter")?.value,group:document.querySelector("#group")?.value,titles:[...document.querySelectorAll(".screen h3")].map(e=>e.textContent)})',
                    ),
                );
                throw Error(label);
            }
            console.log('PASS', label);
        };
        await check(
            'document.querySelectorAll(".screen").length===46',
            'all 46 comparisons render',
        );
        await js('document.querySelector(".tabs [data-theme=forest]").click()');
        await check(
            'document.querySelector("#screens .pair figure:last-child img").getAttribute("src").startsWith("forest/")',
            'direction selector changes comparison images',
        );
        await js(
            'document.querySelector("#filter").value="role";document.querySelector("#filter").dispatchEvent(new window.Event("input",{bubbles:true}))',
        );
        await check(
            'document.querySelectorAll(".screen").length===5',
            'screen search filters results',
        );
        await js(
            'document.querySelector("#filter").value="";document.querySelector("#group").value="auth";document.querySelector("#group").dispatchEvent(new window.Event("change",{bubbles:true}))',
        );
        await check(
            'document.querySelectorAll(".screen").length===5',
            'category selector filters sign-in states',
        );
        await win.loadURL('http://127.0.0.1:5182/?theme=ember');
        await pause(700);
        await check(
            '!!window.__review && !!document.querySelector(".app-shell")',
            'Ember app mounts',
        );
        const layout = [];
        for (const width of [1440, 960]) {
            win.setContentSize(width, 960);
            await pause(100);
            for (const surface of ['chat', 'settings', 'auth']) {
                await js(
                    `{const r=window.__review;if('${surface}'==='settings'){r.setModal('settings');r.setSettingsTab('account')}else if('${surface}'==='auth'){r.resetModals();r.setToken('');r.setState(null)}else r.resetModals()}`,
                );
                await pause(150);
                const value = await js(
                    `({width:innerWidth,scroll:document.documentElement.scrollWidth,body:document.body.scrollWidth})`,
                );
                if (value.scroll > width || value.body > width)
                    throw Error('Horizontal overflow ' + width + ' ' + surface);
                layout.push({ width, surface, ...value });
            }
            if (width === 1440) {
                await win.loadURL('http://127.0.0.1:5182/?theme=ember');
                await pause(600);
            }
        }
        fs.writeFileSync(
            'Docs/campfire-review/verification.json',
            JSON.stringify({ gallery: 'passed', layout }, null, 2),
        );
        console.log('PASS desktop and minimum-width layouts');
        win.destroy();
        app.quit();
    })
    .catch((e) => {
        console.error(e);
        app.exit(1);
    });
