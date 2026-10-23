const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
app.setPath('userData', process.env.AUDIO_PROFILE);
app.commandLine.appendSwitch('use-fake-device-for-media-stream');
app.commandLine.appendSwitch('use-fake-ui-for-media-stream');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.commandLine.appendSwitch('disable-gpu');
app.on('window-all-closed', () => {});
const accounts = JSON.parse(process.env.AUDIO_ACCOUNTS);
const origin = process.env.AUDIO_ORIGIN,
    renderer = process.env.AUDIO_RENDERER;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const failures = [];
const js = (win, source) => win.webContents.executeJavaScript(source, true);
const wait = async (win, source, label) => {
    for (let attempt = 0; attempt < 150; attempt++) {
        if (await js(win, source)) {
            console.log('PASS', label);
            return;
        }
        await pause(100);
    }
    console.log(
        'AUDIO DIAGNOSTICS',
        await js(
            win,
            `JSON.stringify({prefs:JSON.parse(localStorage.getItem('preferences')),gains:window.__audio.gains.map(g=>g.gain.value),raw:window.__audio.raw.map(s=>s.getAudioTracks().map(t=>({state:t.readyState,settings:t.getSettings()}))),contexts:window.__audio.contexts.map(c=>c.state)})`,
        ),
    );
    throw Error(`Timed out: ${label}\n${failures.join('\n')}`);
};
const click = async (win, label) => {
    const found = await js(
        win,
        `(() => { const node=[...document.querySelectorAll('button')].find(n=>n.textContent.trim()===${JSON.stringify(label)} || n.getAttribute('aria-label')===${JSON.stringify(label)} || n.getAttribute('title')===${JSON.stringify(label)}); node?.click(); return !!node; })()`,
    );
    assert.ok(found, `Button exists: ${label}`);
};
const slider = (win, label, value) =>
    js(
        win,
        `(() => {const node=document.querySelector('input[aria-label=${JSON.stringify(label)}]'); if(!node) throw Error('Missing slider'); const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; setter.call(node,${value}); node.dispatchEvent(new Event('input',{bubbles:true})); node.dispatchEvent(new Event('change',{bubbles:true}));})()`,
    );
const prefs = (win) => js(win, `JSON.parse(localStorage.getItem('preferences'))`);
const openSettings = async (win) => {
    await click(win, 'Settings');
    await click(win, 'Audio & Video');
    await wait(
        win,
        process.env.AUDIO_BASELINE
            ? "!!document.querySelector('.microphone-test')"
            : "!!document.querySelector('.audio-video-settings')",
        'audio settings open',
    );
};
const closeSettings = async (win) => {
    await js(win, `document.querySelector('.settings-modal [aria-label="Close dialog"]')?.click()`);
    if (await js(win, "!!document.querySelector('.settings-modal')"))
        await js(
            win,
            `document.querySelector('.settings-modal').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`,
        );
    await wait(win, "!document.querySelector('.settings-modal')", 'settings close');
};
async function client(account, name) {
    const win = new BrowserWindow({
        width: 1280,
        height: 960,
        show: true,
        webPreferences: {
            partition: `audio-${name}`,
            contextIsolation: true,
            sandbox: true,
            backgroundThrottling: false,
        },
    });
    win.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) =>
        callback(true),
    );
    win.webContents.on('console-message', (event) => {
        if (event.level === 'error') failures.push(event.message);
    });
    await win.loadURL('about:blank');
    win.webContents.debugger.attach('1.3');
    await win.webContents.debugger.sendCommand('Page.enable');
    await win.webContents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', {
        source: `
        window.__audio={contexts:[],gains:[],gates:[],peers:[],raw:[],captures:[]};
        const Context=window.AudioContext;
        window.AudioContext=class extends Context {
            constructor(...args){super(...args);window.__audio.contexts.push(this);}
            createGain(){const gain=super.createGain();window.__audio.gains.push(gain);return gain;}
        };
        const Gate=window.AudioWorkletNode;
        window.AudioWorkletNode=class extends Gate {
            constructor(...args){
                super(...args);this.processorName=args[1];this.messages=[];
                const post=this.port.postMessage.bind(this.port);
                this.port.postMessage=(data,...rest)=>{this.messages.push(data);return post(data,...rest)};
                window.__audio.gates.push(this);
            }
        };
        const Peer=window.RTCPeerConnection;
        window.RTCPeerConnection=class extends Peer {
            constructor(...args){super(...args);window.__audio.peers.push(this);}
        };
        const capture=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
        navigator.mediaDevices.getUserMedia=async constraints=>{
            window.__audio.captures.push(constraints);
            const stream=await capture(constraints);window.__audio.raw.push(stream);return stream;
        };
    `,
    });
    await win.loadURL(renderer);
    await js(
        win,
        `localStorage.setItem('connection',JSON.stringify(${JSON.stringify({ url: origin, token: account.token })}));localStorage.setItem('preferences',JSON.stringify({theme:'ember',noise:false,noiseSuppressionEngine:'chromium',echoCancellation:false,autoGainControl:false,sounds:false,messageSounds:false,autoIdle:false}));`,
    );
    await win.reload();
    await wait(
        win,
        `document.querySelector('.server-heading small')?.textContent.includes('Connected')`,
        'connected ' + name,
    );
    return win;
}
const deadline = setTimeout(() => {
    console.error('Audio verification timed out');
    app.exit(1);
}, 90000);
app.whenReady()
    .then(async () => {
        const alice = await client(accounts[0], 'alice'),
            bob = await client(accounts[1], 'bob');
        await openSettings(alice);
        if (process.env.AUDIO_RNNOISE_ONLY) {
            await require('./rnnoise-check.cjs')({
                alice,
                bob,
                js,
                click,
                wait,
                prefs,
                openSettings,
                closeSettings,
                pause,
                slider,
            });
            assert.deepEqual(failures, []);
            clearTimeout(deadline);
            app.exit(0);
            return;
        }
        if (process.env.AUDIO_BASELINE) {
            for (const theme of ['ember', 'canvas']) {
                await js(
                    alice,
                    `document.documentElement.dataset.theme=${JSON.stringify(theme)};document.querySelector('.settings-content').scrollTop=0`,
                );
                await pause(200);
                await fs.writeFile(
                    `${process.env.AUDIO_OUTPUT}/${theme}-before.png`,
                    (await alice.webContents.capturePage()).toPNG(),
                );
            }
            clearTimeout(deadline);
            app.exit(0);
            return;
        }
        const measured = await js(
            alice,
            `(async () => {
            const context = new AudioContext();
            await context.resume();
            try {
                await context.audioWorklet.addModule(${JSON.stringify(process.env.AUDIO_WORKLET)});
                const gate = new AudioWorkletNode(context, 'campfire-voice-gate');
                const oscillator = context.createOscillator(), input = context.createGain();
                const analyser = context.createAnalyser(), silent = context.createGain();
                silent.gain.value = 0;
                input.gain.value = 0.001;
                oscillator.connect(input).connect(gate).connect(analyser).connect(silent).connect(context.destination);
                gate.port.postMessage({enabled:true,threshold:-40});
                oscillator.start();
                const read = async delay => {
                    await new Promise(resolve=>setTimeout(resolve,delay));
                    const samples = new Float32Array(analyser.fftSize);
                    analyser.getFloatTimeDomainData(samples);
                    return Math.sqrt(samples.reduce((sum,value)=>sum+value*value,0)/samples.length);
                };
                const quiet = await read(1000);
                input.gain.value = 0.1;
                const speech = await read(150);
                input.gain.value = 0.001;
                const held = await read(100), released = await read(1000);
                gate.port.postMessage({enabled:false,threshold:-40});
                const bypassed = await read(150);
                oscillator.stop(); gate.port.close();
                return {quiet,speech,held,released,bypassed};
            } finally { await context.close(); }
        })()`,
        );
        assert.ok(measured.quiet < 0.000001, JSON.stringify(measured));
        assert.ok(measured.speech > 0.05, JSON.stringify(measured));
        assert.ok(measured.held > 0.0005, JSON.stringify(measured));
        assert.ok(measured.released < 0.000001, JSON.stringify(measured));
        assert.ok(measured.bypassed > 0.0005, JSON.stringify(measured));
        await js(alice, 'window.__audio.gates=[]');
        console.log(
            'PASS real AudioWorklet suppresses quiet audio, passes speech, holds release and bypasses',
        );
        for (const label of [
            'Noise suppression',
            'Echo cancellation',
            'Automatic microphone gain',
            'Voice activation',
            'Push-to-talk',
        ])
            assert.equal(
                await js(
                    alice,
                    `document.querySelector('[role=switch][aria-label=${JSON.stringify(label)}]')?.getAttribute('aria-checked')`,
                ),
                'false',
            );
        await click(alice, 'Noise suppression');
        let saved = await prefs(alice);
        assert.equal(saved.noise, true);
        assert.equal(saved.echoCancellation, false);
        assert.equal(saved.autoGainControl, false);
        console.log('PASS processing switches save independently');
        await slider(alice, 'Microphone volume', 1.5);
        await slider(alice, 'Output volume', 0.6);
        await slider(alice, 'Sound-effects volume', 0.25);
        await click(alice, 'Echo cancellation');
        await click(alice, 'Automatic microphone gain');
        await click(alice, 'Voice activation');
        await slider(alice, 'Activation threshold', -35);
        await click(alice, 'Push-to-talk');
        assert.equal(
            await js(
                alice,
                'document.querySelector(\'input[aria-label="Activation threshold"]\').disabled',
            ),
            true,
        );
        await click(alice, 'Push-to-talk');
        assert.equal(
            await js(alice, "document.querySelector('.settings-header h2').textContent"),
            'Audio & Video',
        );
        await click(alice, 'Start microphone test');
        await wait(
            alice,
            "document.querySelector('.activation-threshold').classList.contains('is-measuring') && document.querySelector('.threshold-live-value').textContent.includes('dBFS')",
            'live microphone reading is shown on the activation slider',
        );
        await slider(alice, 'Microphone volume', 0);
        await wait(
            alice,
            "document.querySelector('.threshold-live-value').textContent.includes('Silent') && document.querySelector('.threshold-live-track b').style.left==='0%' && document.querySelector('.threshold-comparison').textContent==='Below threshold'",
            'silence moves the live marker below the cutoff',
        );
        await slider(alice, 'Microphone volume', 1.5);
        await slider(alice, 'Activation threshold', -60);
        await wait(
            alice,
            "document.querySelector('.threshold-comparison').textContent==='Above threshold' && parseFloat(document.querySelector('.threshold-live-track b').style.left)>0",
            'live microphone marker rises above a lower cutoff',
        );
        await slider(alice, 'Activation threshold', -35);
        await click(alice, 'Test speakers');
        await wait(
            alice,
            "window.__audio.contexts.some(c=>c.state==='running') && !document.querySelector('.audio-settings-error')",
            'speaker test runs on the production renderer',
        );
        for (const theme of ['ember', 'canvas']) {
            await js(
                alice,
                `document.documentElement.dataset.theme=${JSON.stringify(theme)};document.querySelector('.settings-content').scrollTop=0;`,
            );
            await pause(200);
            await fs.writeFile(
                `${process.env.AUDIO_OUTPUT}/${theme}-settings-top.png`,
                (await alice.webContents.capturePage()).toPNG(),
            );
            await js(alice, "document.querySelector('.settings-content').scrollTop=700");
            await pause(150);
            await fs.writeFile(
                `${process.env.AUDIO_OUTPUT}/${theme}-settings-playback.png`,
                (await alice.webContents.capturePage()).toPNG(),
            );
            await js(
                alice,
                "document.querySelector('.activation-threshold').scrollIntoView({block:'center'})",
            );
            await pause(150);
            await fs.writeFile(
                `${process.env.AUDIO_OUTPUT}/${theme}-activation-live.png`,
                (await alice.webContents.capturePage()).toPNG(),
            );
        }
        await js(
            alice,
            "document.querySelector('.settings-content').scrollTop=document.querySelector('.settings-content').scrollHeight",
        );
        await pause(200);
        await fs.writeFile(
            `${process.env.AUDIO_OUTPUT}/settings-video.png`,
            (await alice.webContents.capturePage()).toPNG(),
        );
        alice.setContentSize(760, 780);
        await js(alice, "document.querySelector('.settings-content').scrollTop=0");
        await pause(150);
        assert.equal(
            await js(
                alice,
                "document.querySelector('.settings-content').scrollWidth > document.querySelector('.settings-content').clientWidth",
            ),
            false,
        );
        await fs.writeFile(
            `${process.env.AUDIO_OUTPUT}/compact-settings.png`,
            (await alice.webContents.capturePage()).toPNG(),
        );
        alice.setContentSize(1280, 960);
        await click(alice, 'Stop microphone test');
        await wait(
            alice,
            "!document.querySelector('.threshold-live-track b') && document.querySelector('.threshold-live-value').textContent.includes('Start microphone test')",
            'stopping the test clears the live marker',
        );
        await closeSettings(alice);
        // Join a real two-client WebRTC call using the production composer and media pipeline.
        await js(
            alice,
            "[...document.querySelectorAll('.channel')].find(n=>n.querySelector('svg.lucide-volume2,svg.lucide-volume-2'))?.click()",
        );
        await js(
            bob,
            "[...document.querySelectorAll('.channel')].find(n=>n.querySelector('svg.lucide-volume2,svg.lucide-volume-2'))?.click()",
        );
        await wait(
            alice,
            "window.__audio.gates.length===1 && window.__audio.peers.some(p=>p.connectionState==='connected')",
            'processed microphone and real peer connection under desktop CSP',
        );
        await wait(
            bob,
            "[...document.querySelectorAll('audio')].some(a=>a.srcObject?.getAudioTracks().length)",
            'remote voice playback exists',
        );
        assert.ok(
            await js(alice, 'window.__audio.gains.some(g=>Math.abs(g.gain.value-1.5)<0.001)'),
        );
        await openSettings(alice);
        const gateCount = await js(alice, 'window.__audio.gates.length');
        const captureCount = await js(alice, 'window.__audio.raw.length');
        await click(alice, 'Start microphone test');
        await pause(200);
        assert.equal(await js(alice, 'window.__audio.raw.length'), captureCount);
        console.log('PASS in-call meter reuses microphone without opening conflicting capture');
        await slider(alice, 'Microphone volume', 0.4);
        await click(alice, 'Noise suppression');
        await wait(
            alice,
            'window.__audio.gains.some(g=>Math.abs(g.gain.value-0.4)<0.001) && window.__audio.raw.some(s=>s.getAudioTracks().some(t=>t.readyState==="live" && t.getSettings().noiseSuppression===false))',
            'microphone volume and Chromium processing change live',
        );
        assert.equal(await js(alice, 'window.__audio.gates.length'), gateCount);
        await slider(alice, 'Output volume', 0.5);
        await closeSettings(alice);
        await js(
            alice,
            "document.querySelector('.voice-member.has-audio-controls').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:220,clientY:450}))",
        );
        await wait(
            alice,
            "!!document.querySelector('.participant-audio-popup')",
            'sidebar context audio controls',
        );
        await slider(alice, 'Voice volume for Bob', 0.4);
        await slider(alice, 'Stream volume for Bob', 0.7);
        await wait(
            alice,
            "[...document.querySelectorAll('audio')].some(a=>a.srcObject?.getAudioTracks().length && Math.abs(a.volume-0.2)<0.001)",
            'master output multiplies saved participant voice level',
        );
        await pause(250);
        await fs.writeFile(
            `${process.env.AUDIO_OUTPUT}/participant-popup.png`,
            (await alice.webContents.capturePage()).toPNG(),
        );
        saved = await prefs(alice);
        assert.ok(
            Object.values(saved.participantVolumes).some(
                (v) => v.voice === 0.4 && v.stream === 0.7,
            ),
        );
        await js(
            alice,
            "document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))",
        );
        await wait(
            alice,
            "!document.querySelector('.participant-audio-popup') && document.activeElement.classList.contains('voice-member')",
            'Escape returns focus to sidebar participant',
        );
        await js(
            alice,
            "document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'F10',shiftKey:true,bubbles:true}))",
        );
        await wait(
            alice,
            "!!document.querySelector('.participant-audio-popup')",
            'keyboard opens participant controls',
        );
        await js(
            alice,
            "document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))",
        );
        await click(alice, 'Leave call');
        await wait(
            alice,
            "window.__audio.raw.every(s=>s.getTracks().every(t=>t.readyState==='ended')) && window.__audio.contexts.filter(c=>c.audioWorklet).every(c=>c.state==='closed'||c!==window.__audio.gates[0].context)",
            'leaving call releases processed and raw microphone resources',
        );
        await alice.reload();
        await wait(
            alice,
            "document.querySelector('.server-heading small')?.textContent.includes('Connected')",
            'reconnected after reload',
        );
        saved = await prefs(alice);
        assert.equal(saved.microphoneVolume, 0.4);
        assert.equal(saved.outputVolume, 0.5);
        assert.equal(saved.soundEffectsVolume, 0.25);
        assert.ok(
            Object.values(saved.participantVolumes).some(
                (v) => v.voice === 0.4 && v.stream === 0.7,
            ),
        );
        console.log('PASS global and participant audio preferences survive reload');
        await js(
            alice,
            "[...document.querySelectorAll('.channel')].find(n=>n.querySelector('svg.lucide-volume2,svg.lucide-volume-2'))?.click()",
        );
        await wait(
            alice,
            "[...document.querySelectorAll('audio')].some(a=>a.srcObject?.getAudioTracks().length && Math.abs(a.volume-0.2)<0.001)",
            'saved participant volume is restored to new playback after rejoining',
        );

        assert.deepEqual(failures, []);
        console.log('PASS no renderer or CSP errors');
        clearTimeout(deadline);
        app.exit(0);
    })
    .catch((error) => {
        console.error(error);
        console.error(failures);
        clearTimeout(deadline);
        app.exit(1);
    });
