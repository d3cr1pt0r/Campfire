const assert = require('node:assert/strict');
const fs = require('node:fs/promises');

module.exports = async ({
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
}) => {
    const select = (value) =>
        js(
            alice,
            `(() => {
        const select = [...document.querySelectorAll('select')].find(s => [...s.options].some(o => o.value === 'rnnoise'));
        Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, ${JSON.stringify(value)});
        select.dispatchEvent(new Event('change', {bubbles:true}));
    })()`,
        );
    await click(alice, 'Noise suppression');
    await click(alice, 'Echo cancellation');
    await select('rnnoise');
    await click(alice, 'Voice activation');
    await wait(
        alice,
        `!!document.querySelector('.threshold-live-track b') && /dBFS|Silent/.test(document.querySelector('.threshold-live-value').textContent) && ![...document.querySelectorAll('button')].some(b=>b.textContent==='Start microphone test')`,
        'volume activation preview starts without microphone test',
    );
    await js(
        alice,
        `(() => {
        const select = [...document.querySelectorAll('select')].find(s => [...s.options].some(o => o.value === 'speech'));
        Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, 'speech');
        select.dispatchEvent(new Event('change', {bubbles:true}));
    })()`,
    );
    await slider(alice, 'Activation threshold', 23);
    await js(
        alice,
        `[...document.querySelectorAll('summary')].find(s=>s.textContent==='Advanced voice activation').click()`,
    );
    await slider(alice, 'Speech release delay', 450);
    assert.equal((await prefs(alice)).voiceActivationMode, 'speech');
    assert.ok(Math.abs((await prefs(alice)).speechSensitivity - 0.8) < 0.00001);
    assert.equal((await prefs(alice)).voiceReleaseDelay, 450);
    assert.equal((await prefs(alice)).noiseSuppressionEngine, 'rnnoise');
    await wait(
        alice,
        `!!document.querySelector('.threshold-live-track b') && document.querySelector('.threshold-live-value').textContent.includes('Live speech confidence:')`,
        'speech activation preview uses live RNNoise confidence without microphone test',
    );
    await wait(
        alice,
        `window.__audio.gates.some(n=>n.processorName.endsWith('/rnnoise')) && !!document.querySelector('.microphone-device')`,
        'standalone meter loads RNNoise',
    );
    assert.equal(await js(alice, 'window.__audio.captures.at(-1).audio.noiseSuppression'), false);
    assert.equal(await js(alice, 'window.__audio.captures.at(-1).audio.echoCancellation'), true);
    await js(
        alice,
        `document.querySelector('input[aria-label="Activation threshold"]').scrollIntoView({block:'center'})`,
    );
    await pause(250);
    await fs.writeFile(
        `${process.env.AUDIO_OUTPUT}/rnnoise-settings.png`,
        (await alice.webContents.capturePage()).toPNG(),
    );
    await closeSettings(alice);
    await wait(
        alice,
        `window.__audio.raw.every(s=>s.getTracks().every(t=>t.readyState==='ended'))`,
        'meter releases capture',
    );
    // Persistence and production call path, including a stable peer sender while switching.
    await alice.reload();
    await wait(
        alice,
        `document.querySelector('.server-heading small')?.textContent.includes('Connected')`,
        'reconnected',
    );
    await openSettings(alice);
    assert.equal(
        await js(alice, `document.querySelector('input[aria-label="Activation threshold"]').value`),
        '23',
    );
    assert.equal(
        await js(
            alice,
            `[...document.querySelectorAll('select')].find(s=>[...s.options].some(o=>o.value==='rnnoise')).value`,
        ),
        'rnnoise',
    );
    await closeSettings(alice);
    for (const win of [alice, bob])
        await js(
            win,
            `[...document.querySelectorAll('.channel')].find(n=>n.querySelector('svg.lucide-volume2,svg.lucide-volume-2'))?.click()`,
        );
    await wait(
        alice,
        `window.__audio.gates.some(n=>n.processorName.endsWith('/rnnoise')) && window.__audio.peers.some(p=>p.connectionState==='connected')`,
        'RNNoise call connects',
    );
    await js(
        alice,
        `window.__rnSender=window.__audio.peers.find(p=>p.connectionState==='connected').getSenders().find(s=>s.track?.kind==='audio');window.__rnTrack=window.__rnSender.track`,
    );
    await openSettings(alice);
    await wait(
        alice,
        `window.__audio.gates.find(n=>n.processorName==='campfire-voice-gate')?.messages.at(-1)?.mode==='speech'`,
        'speech activation reaches audio-thread gate',
    );
    await wait(
        alice,
        `!!document.querySelector('.threshold-live-track b') && document.querySelector('.threshold-live-value').textContent.includes('Live speech confidence:')`,
        'in-call speech preview reuses RNNoise processing',
    );
    const capturesBeforeSensitivity = await js(alice, 'window.__audio.captures.length');
    await slider(alice, 'Activation threshold', 41);
    await wait(
        alice,
        `Math.abs(window.__audio.gates.find(n=>n.processorName==='campfire-voice-gate').messages.at(-1).speechThreshold-0.41)<0.00001`,
        'sensitivity changes live',
    );
    assert.equal(await js(alice, 'window.__audio.captures.length'), capturesBeforeSensitivity);
    await click(alice, 'Push-to-talk');
    await wait(
        alice,
        `window.__audio.gates.find(n=>n.processorName==='campfire-voice-gate').messages.at(-1).enabled===false && document.querySelector('input[aria-label="Activation threshold"]').disabled`,
        'push-to-talk bypasses speech activation',
    );
    await click(alice, 'Push-to-talk');
    for (const engine of ['chromium', 'rnnoise']) {
        const count = await js(alice, 'window.__audio.captures.length');
        await select(engine);
        await wait(
            alice,
            `window.__audio.captures.length>${count} && window.__audio.raw.at(-1).getAudioTracks()[0].readyState==='live' && window.__audio.captures.at(-1).audio.noiseSuppression===${engine === 'chromium'}`,
            `switch to ${engine} during call`,
        );
        assert.equal(
            await js(
                alice,
                'window.__rnSender.track===window.__rnTrack && window.__rnTrack.readyState==="live"',
            ),
            true,
        );
        await wait(
            alice,
            `window.__audio.gates.find(n=>n.processorName==='campfire-voice-gate').messages.at(-1).mode===${JSON.stringify(engine === 'chromium' ? 'level' : 'speech')}`,
            `activation follows ${engine} availability`,
        );
        assert.equal(
            await js(alice, 'window.__audio.captures.at(-1).audio.echoCancellation'),
            true,
        );
    }
    await click(alice, 'Noise suppression');
    await wait(
        alice,
        `window.__audio.captures.at(-1).audio.noiseSuppression===false && window.__audio.raw.filter(s=>s.getAudioTracks().some(t=>t.readyState==='live')).length===1`,
        'suppression off keeps one live capture',
    );
    // Exercise the actual bundled WASM, rather than a mock of the denoising engine.
    const levels = await js(
        alice,
        `(async () => {
        const context = new AudioContext({sampleRate:48000});
        try {
            await context.resume();
            await context.audioWorklet.addModule(${JSON.stringify(process.env.RNNOISE_WORKLET)});
            const response=await fetch(${JSON.stringify(process.env.RNNOISE_WASM)});
            if(!response.ok) throw Error('Missing RNNoise WASM');
            const node=new AudioWorkletNode(context,'campfire/rnnoise',{processorOptions:{wasmBinary:await response.arrayBuffer()},numberOfOutputs:2,outputChannelCount:[1,1],channelCount:1,channelCountMode:'explicit'});
            await context.audioWorklet.addModule(${JSON.stringify(process.env.AUDIO_WORKLET)});
            const gate=new AudioWorkletNode(context,'campfire-voice-gate',{numberOfInputs:2});
            gate.port.postMessage({enabled:true,mode:'speech',speechThreshold:0.99,releaseMs:0});
            node.connect(gate,0,0);node.connect(gate,1,1);
            const gated=context.createAnalyser();gate.connect(gated);
            const buffer=context.createBuffer(1,48000,48000), data=buffer.getChannelData(0);
            let seed=42;
            for(let i=0;i<data.length;i++){seed=(Math.imul(seed,1664525)+1013904223)|0;data[i]=(seed/2147483648)*0.03;}
            const source=context.createBufferSource(); source.buffer=buffer;source.loop=true;
            const before=context.createAnalyser(), after=context.createAnalyser(), silent=context.createGain();silent.gain.value=0;
            source.connect(before);source.connect(node).connect(after).connect(silent).connect(context.destination);source.start();
            await new Promise(resolve=>setTimeout(resolve,1800));
            const rms=a=>{const s=new Float32Array(2048);a.getFloatTimeDomainData(s);return Math.sqrt(s.reduce((sum,x)=>sum+x*x,0)/s.length)};
            const result={before:rms(before),after:rms(after),gated:rms(gated)};
            gate.port.postMessage({enabled:false});
            await new Promise(resolve=>setTimeout(resolve,250));
            result.bypassed=rms(gated);gate.port.close();source.stop();node.port.postMessage('destroy');return result;
        } finally {await context.close();}
    })()`,
    );
    assert.ok(levels.before > 0.01 && levels.after < levels.before * 0.95, JSON.stringify(levels));
    assert.ok(
        levels.gated < levels.after * 0.1 && levels.bypassed > levels.after * 0.5,
        JSON.stringify(levels),
    );
    console.log(
        'PASS bundled RNNoise reduces synthetic noise and speech probability drives the gate',
        levels,
    );
    console.log(
        'PASS engine persistence, independent echo cancellation, standalone meter, live call switching and stable sender',
    );
};
