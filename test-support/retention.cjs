const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
app.setPath('userData', process.env.RETENTION_PROFILE);
app.commandLine.appendSwitch('disable-gpu');
app.on('window-all-closed', () => {});
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const errors = [];
const deadline = setTimeout(() => {
    console.error('Retention verification timed out', errors);
    app.exit(1);
}, 90000);
const origin = process.env.RETENTION_ORIGIN;
const account = JSON.parse(process.env.RETENTION_ACCOUNT);
const api = async (endpoint, method, body) => {
    const response = await fetch(`${origin}/api${endpoint}`, {
        method,
        headers: { Authorization: `Bearer ${account.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    assert.equal(response.status, 200, await response.clone().text());
    return response.json();
};
// The first message article whose text includes this.
const article = (text) =>
    `[...document.querySelectorAll('article.message')].find(node=>node.querySelector('.message-text')?.textContent.includes(${JSON.stringify(text)}))`;
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
        const wait = async (code, label, tries = 150) => {
            for (let i = 0; i < tries; i++) {
                if (await js(code)) {
                    console.log('PASS', label);
                    return;
                }
                await pause(100);
            }
            const toast = await js("document.querySelector('.toast span')?.textContent||''");
            const last = await js(
                "[...document.querySelectorAll('article.message')].slice(-2).map(node=>node.textContent).join(' | ')",
            );
            throw Error(`Timed out: ${label}\n${toast}\n${last}\n${errors.join('\n')}`);
        };
        const click = (label) =>
            js(
                `(()=>{const node=[...document.querySelectorAll('button')].find(node=>node.getAttribute('aria-label')===${JSON.stringify(label)}||node.getAttribute('title')===${JSON.stringify(label)}||node.textContent.trim()===${JSON.stringify(label)});if(!node)throw Error('Missing button '+${JSON.stringify(label)});node.click()})()`,
            );
        const shot = async (name) => {
            for (const theme of ['ember', 'canvas']) {
                await js(`document.documentElement.dataset.theme='${theme}'`);
                await pause(150);
                await fs.writeFile(
                    path.join(process.env.RETENTION_OUTPUT, `${theme}-${name}.png`),
                    (await win.webContents.capturePage()).toPNG(),
                );
            }
            await js("document.documentElement.dataset.theme='ember'");
        };
        await win.loadURL(process.env.RETENTION_RENDERER);
        await js(
            `localStorage.setItem('connection',JSON.stringify(${JSON.stringify({ url: origin, token: account.token })}));localStorage.setItem('preferences',JSON.stringify({sounds:false,messageSounds:false,theme:'dark'}))`,
        );
        await win.reload();
        await wait(
            "document.querySelector('.server-heading small')?.textContent.includes('Connected')",
            'connected',
        );
        await wait(`!!${article('Forty days old')}`, 'history loads');
        assert.equal(await js("!!document.querySelector('.retention-chip')"), false);
        assert.equal(await js(`${article('Almost due')}.querySelector('time').title`), '');
        console.log('PASS nothing about retention shows while messages are kept forever');

        // Uploads from the composer, a file and an image.
        await js(
            `(async()=>{const canvas=document.createElement('canvas');canvas.width=40;canvas.height=30;const context=canvas.getContext('2d');context.fillStyle='#d97a3a';context.fillRect(0,0,40,30);const image=await new Promise(done=>canvas.toBlob(done,'image/png'));const input=document.querySelector('.composer input[type=file]');const transfer=new DataTransfer();transfer.items.add(new File(['Plain notes'],'notes.txt',{type:'text/plain'}));transfer.items.add(new File([image],'dot.png',{type:'image/png'}));input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}))})()`,
        );
        await js("document.querySelector('.composer [contenteditable=true]').focus()");
        await win.webContents.insertText('Two files');
        await wait("!document.querySelector('.send-button').disabled", 'composer holds two files');
        await click('Send message');
        await wait(
            `!!${article('Two files')}?.querySelector('.attachment-image')`,
            'message with files arrives',
        );
        // Images load once near the viewport; bring this one into view.
        await js("document.querySelector('.attachment-image').scrollIntoView()");
        await wait(
            `${article('Two files')}.textContent.includes('notes.txt') && !!${article('Two files')}.querySelector('img')`,
            'uploaded file and image preview appear',
            // The first thumbnail also starts the image library, which can take a while.
            400,
        );

        // A shorter server default is announced before it applies.
        await api('/retention/server', 'PATCH', { retention: 30 });
        await wait(
            "document.querySelector('.retention-chip')?.textContent.includes('1 month from')",
            'header chip announces the coming period',
        );
        await wait(
            "document.querySelector('.retention-banner')?.textContent.includes('older than 1 month will be deleted')",
            'notice banner explains the change',
        );
        await shot('notice');
        await click('Dismiss retention notice');
        await wait("!document.querySelector('.retention-banner')", 'banner can be dismissed');
        await win.reload();
        await wait(`!!${article('Almost due')}`, 'history loads again');
        assert.equal(await js("!!document.querySelector('.retention-banner')"), false);
        console.log('PASS the dismissed banner stays dismissed');

        // Applying it now removes old messages from the open app.
        await api('/retention/server', 'PATCH', { retention: 30, applyNow: true });
        await wait(`!${article('Forty days old')}`, 'expired message disappears live');
        await wait(
            "document.querySelector('.retention-chip span')?.textContent==='1 month'",
            'chip shows the period in force',
        );
        const due = await js(`${article('Almost due')}.querySelector('time').title`);
        assert.match(due, /^Posted .+ · deleted .+ unless pinned$/);
        assert.equal(
            await js(`!!${article('Almost due')}.querySelector('time .retention-ending')`),
            true,
        );
        assert.equal(
            await js(`!!${article('Fresh message')}.querySelector('time .retention-ending')`),
            false,
        );
        console.log('PASS hover date, and the hourglass only on messages near deletion');
        assert.equal(
            await js(
                `!!${article('Fresh message')}.querySelector('button[title="Pin — keeps it permanently"]')`,
            ),
            true,
        );
        await js(
            `${article('Almost due')}.querySelector('button[title="Pin — keeps it permanently"]').click()`,
        );
        await wait(
            `${article('Almost due')}.querySelector('time').title==='Pinned · kept permanently'`,
            'pinned message shows it is kept',
        );
        await js(`${article('Almost due')}.querySelector('button[title="Unpin"]').click()`);
        await wait(
            "/^Unpinned\\. It will be deleted on .+\\.$/.test(document.querySelector('.toast span')?.textContent||'')",
            'unpinning tells when the message will now be deleted',
        );
        await wait(
            `!${article('Almost due')}.querySelector('time .retention-ending')`,
            'unpinning restarts the clock',
        );
        await shot('cues');
        await click('Dismiss notification');

        // An open thread that expires closes with a notice.
        await js(`${article('Thread start')}.querySelector('.thread-replies').click()`);
        await wait("!!document.querySelector('.thread-panel')", 'thread opens');
        await fetch(`${process.env.RETENTION_CONTROL}/expire-thread`, { method: 'POST' });
        await wait(
            "!document.querySelector('.thread-panel') && (document.querySelector('.toast span')?.textContent||'').includes('retention period')",
            'expired thread closes with a notice',
        );
        await wait(`!${article('Thread start')}`, 'expired thread leaves the channel');
        await click('Dismiss notification');

        // With text kept, an expired file leaves a placeholder and the words stay.
        await api('/retention/keep-text', 'PATCH', { keepText: true });
        await wait(
            "document.querySelector('.retention-chip span')?.textContent==='Files · 1 month'",
            'chip says only files are removed',
        );
        assert.equal(await js(`${article('Fresh message')}.querySelector('time').title`), '');
        console.log('PASS text-only messages show no retention cues while text is kept');
        await fetch(`${process.env.RETENTION_CONTROL}/expire-file`, { method: 'POST' });
        await wait(
            `(${article('Words that stay')}?.querySelector('.attachment-removed')?.textContent||'').includes('sketch.png')`,
            'expired file becomes a placeholder live',
        );
        assert.match(
            await js(
                `${article('Words that stay')}.querySelector('.attachment-removed').textContent`,
            ),
            /Removed after the retention period/,
        );
        await js(`${article('Words that stay')}.scrollIntoView({block:'center'})`);
        await shot('placeholder');

        // The owner's Storage tab.
        await click('Settings');
        await click('Storage');
        await wait(
            "(document.querySelector('.storage-overview')?.textContent||'').includes('used by attachments')",
            'storage overview loads',
        );
        assert.equal(
            await js(
                "[...document.querySelectorAll('.retention-field select')].map(select=>select.selectedOptions[0].textContent).join()",
            ),
            '1 month,Forever',
        );
        assert.equal(
            await js(
                `document.querySelector('[role=switch][aria-label="Keep messages permanently, only remove files"]').getAttribute('aria-checked')`,
            ),
            'true',
        );
        assert.match(
            await js("document.querySelector('.storage-table tbody').textContent"),
            /#general.*1 month.*Direct messages.*Forever/,
        );
        await shot('storage');
        // Choosing a shorter period asks for confirmation with what it deletes.
        await js(
            "(()=>{const select=document.querySelectorAll('.retention-field select')[1];select.value='14';select.dispatchEvent(new Event('change',{bubbles:true}))})()",
        );
        await click('Save');
        await wait(
            "(document.querySelector('.channel-delete-confirm')?.textContent||'').includes('files older than 2 weeks will be removed')",
            'shortening shows a confirmation with its effect',
        );
        await shot('confirm');
        await click('Cancel');
        assert.deepEqual(errors, []);
        console.log('PASS no renderer errors');
        clearTimeout(deadline);
        app.exit(0);
    })
    .catch((error) => {
        console.error(error);
        clearTimeout(deadline);
        app.exit(1);
    });
