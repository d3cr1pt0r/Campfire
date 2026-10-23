import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import {
    audioLevel,
    participantLevels,
    participantVolumeKey,
    voiceThreshold,
    voiceThresholdPercent,
    voiceGateSettings,
    voiceReleaseDelay,
} from '../src/audioPreferences.ts';
import { microphoneConstraints, openMicrophone } from '../src/media.ts';

test('each audio processing option is independent, and unsaved ones default to on', async () => {
    assert.deepEqual(microphoneConstraints({ noise: false }), {
        noiseSuppression: false,
        echoCancellation: true,
        autoGainControl: true,
    });
    const prefs = { noise: false, echoCancellation: true, autoGainControl: false, input: '' };
    let actual;
    await openMicrophone(prefs, {
        getUserMedia: async (constraints) => {
            actual = constraints.audio;
            return {};
        },
    });
    assert.deepEqual(actual, {
        noiseSuppression: false,
        echoCancellation: true,
        autoGainControl: false,
    });
});
test('RNNoise disables Chromium denoising without changing echo cancellation or gain', () => {
    const prefs = {
        noise: true,
        noiseSuppressionEngine: 'rnnoise',
        echoCancellation: true,
        autoGainControl: false,
    };
    assert.deepEqual(microphoneConstraints(prefs), {
        noiseSuppression: false,
        echoCancellation: true,
        autoGainControl: false,
    });
    assert.equal(
        microphoneConstraints({ ...prefs, noiseSuppressionEngine: 'chromium' }).noiseSuppression,
        true,
    );
    assert.equal(microphoneConstraints({ noise: true }).noiseSuppression, false);
    assert.equal(microphoneConstraints({ ...prefs, noise: false }).noiseSuppression, false);
});
test('audio levels reject invalid persisted numbers and bound boost and threshold', () => {
    for (const value of [undefined, null, NaN, Infinity, '0.5']) assert.equal(audioLevel(value), 1);
    assert.equal(audioLevel(-3), 0);
    assert.equal(audioLevel(8), 1);
    assert.equal(audioLevel(1.5, 1, 2), 1.5);
    assert.equal(voiceThreshold(NaN), -45);
    assert.equal(voiceThreshold(-100), -60);
    assert.equal(voiceThreshold(0), 0);
    assert.equal(voiceThreshold(-5), -5);
    assert.equal(voiceThreshold(10), 0);
});
test('live threshold marker uses the slider scale and clamps silence and out-of-range levels', () => {
    assert.equal(voiceThresholdPercent(-60), 0);
    assert.equal(voiceThresholdPercent(-30), 50);
    assert.equal(voiceThresholdPercent(0), 100);
    assert.equal(voiceThresholdPercent(-80), 0);
    assert.equal(voiceThresholdPercent(5), 100);
    for (const value of [null, undefined, NaN, Infinity])
        assert.equal(voiceThresholdPercent(value), 0);
});
test('participant volumes are isolated by server and account and survive transport upgrades', () => {
    const key = participantVolumeKey('https://chat.example', 'alice', 'bob');
    assert.equal(key, participantVolumeKey('http://chat.example', 'alice', 'bob'));
    assert.notEqual(key, participantVolumeKey('https://chat.example', 'casey', 'bob'));
    assert.notEqual(key, participantVolumeKey('https://other.example', 'alice', 'bob'));
    const prefs = { participantVolumes: { [key]: { voice: 0.4, stream: 0.7 } } };
    assert.deepEqual(participantLevels(JSON.parse(JSON.stringify(prefs)), key), {
        voice: 0.4,
        stream: 0.7,
    });
    assert.deepEqual(participantLevels(prefs, 'other'), { voice: 1, stream: 1 });
});
function worklet() {
    let Processor;
    vm.runInNewContext(
        readFileSync(new URL('../src/voiceGate.worklet.js', import.meta.url), 'utf8'),
        {
            AudioWorkletProcessor: class {
                port = {};
            },
            sampleRate: 48000,
            registerProcessor: (_name, value) => {
                Processor = value;
            },
        },
    );
    const processor = new Processor();
    const process = (amplitude, milliseconds, probability) => {
        let last;
        for (let block = 0; block < Math.ceil((milliseconds * 48) / 128); block++) {
            const input = new Float32Array(128).fill(amplitude),
                output = new Float32Array(128);
            processor.process(
                [
                    [input],
                    probability === undefined ? [] : [new Float32Array(128).fill(probability)],
                ],
                [[output]],
            );
            last = output[127];
        }
        return last;
    };
    return { processor, process };
}
test('voice gate suppresses quiet input, preserves loud speech and holds word endings', () => {
    const { processor, process } = worklet();
    processor.port.onmessage({ data: { enabled: true, threshold: -40 } });
    assert.ok(process(0.001, 1000) < 0.000001);
    assert.ok(process(0.1, 50) > 0.099);
    assert.ok(process(0.001, 100) > 0.00099);
    assert.ok(process(0.001, 1000) < 0.000001);
    processor.port.onmessage({ data: { enabled: false, threshold: -40 } });
    assert.ok(process(0.001, 100) > 0.00099);
});
test('gate hysteresis avoids chatter near the activation threshold and supports stereo', () => {
    const { processor, process } = worklet();
    processor.port.onmessage({ data: { enabled: true, threshold: -40 } });
    process(0.02, 100);
    assert.ok(process(0.008, 1000) > 0.0079);
    const left = new Float32Array(128).fill(0.1),
        right = new Float32Array(128).fill(-0.1);
    const output = [new Float32Array(128), new Float32Array(128)];
    processor.process([[left, right]], [output]);
    assert.ok(output[0][127] > 0.099);
    assert.ok(output[1][127] < -0.099);
});
test('speech activation uses speech probability instead of loudness and bypasses for push-to-talk', () => {
    const { processor, process } = worklet();
    processor.port.onmessage({
        data: { enabled: true, mode: 'speech', speechThreshold: 0.5, releaseMs: 200 },
    });
    assert.ok(process(0.8, 1000, 0.1) < 0.00001, 'loud non-speech stays gated');
    assert.ok(process(0.001, 100, 0.9) > 0.00099, 'quiet detected speech passes');
    assert.ok(process(0.001, 100, 0) > 0.00099, 'word endings survive release hold');
    assert.ok(process(0.001, 1000, 0) < 0.000001);
    processor.port.onmessage({ data: { enabled: false, mode: 'speech' } });
    assert.ok(process(0.1, 100, 0) > 0.099);
});
test('sensitivity and release changes apply live, and maximum sensitivity still closes on silence', () => {
    const { processor, process } = worklet();
    processor.port.onmessage({
        data: { enabled: true, mode: 'speech', speechThreshold: 0.9, releaseMs: 500 },
    });
    assert.ok(process(0.1, 1000, 0.6) < 0.000001);
    processor.port.onmessage({
        data: { enabled: true, mode: 'speech', speechThreshold: 0.05, releaseMs: 500 },
    });
    assert.ok(process(0.1, 50, 0.6) > 0.099);
    assert.ok(process(0.1, 300, 0) > 0.099);
    processor.port.onmessage({
        data: { enabled: true, mode: 'speech', speechThreshold: 0.05, releaseMs: 0 },
    });
    assert.ok(process(0.1, 1000, 0) < 0.000001);
});
test('speech activation falls back to volume without RNNoise and settings reject invalid persisted values', () => {
    const prefs = { noise: true, voiceActivation: true, voiceActivationMode: 'speech' };
    const settings = voiceGateSettings(prefs);
    assert.equal(settings.mode, 'speech');
    assert.equal(settings.releaseMs, 200);
    assert.ok(Math.abs(settings.speechThreshold - 0.5) < 0.00001);
    assert.equal(voiceGateSettings({ ...prefs, noise: false }).mode, 'level');
    assert.equal(voiceGateSettings({ ...prefs, noiseSuppressionEngine: 'chromium' }).mode, 'level');
    assert.equal(voiceGateSettings({ ...prefs, pushToTalk: true }).enabled, false);
    assert.equal(
        voiceGateSettings({ ...prefs, speechSensitivity: NaN }).speechThreshold,
        settings.speechThreshold,
    );
    assert.equal(voiceReleaseDelay(Infinity), 200);
    assert.equal(voiceReleaseDelay(-1), 0);
    assert.equal(voiceReleaseDelay(2000), 1000);
});
test('RNNoise WASM worklet produces denoised audio and aligned speech probabilities, and releases its state', () => {
    for (const name of ['rnnoise.wasm', 'rnnoise_simd.wasm']) {
        let Processor;
        vm.runInNewContext(
            readFileSync(new URL('../src/rnnoise.worklet.js', import.meta.url), 'utf8'),
            {
                WebAssembly,
                Float32Array,
                Uint8Array,
                AudioWorkletProcessor: class {
                    port = { close() {} };
                },
                registerProcessor: (_name, value) => {
                    Processor = value;
                },
            },
        );
        const wasmModule = new WebAssembly.Module(
            readFileSync(
                new URL(
                    `../node_modules/@sapphi-red/web-noise-suppressor/dist/${name}`,
                    import.meta.url,
                ),
            ),
        );
        const processor = new Processor({ processorOptions: { wasmModule } });
        let seed = 42,
            inputEnergy = 0,
            outputEnergy = 0,
            nonzeroProbability = false;
        for (let block = 0; block < 1200; block++) {
            const input = Float32Array.from({ length: 128 }, () => {
                seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
                return (seed / 2147483648) * 0.03;
            });
            const output = new Float32Array(128),
                speech = new Float32Array(128);
            assert.equal(processor.process([[input]], [[output], [speech]]), true);
            for (let i = 0; i < 128; i++) {
                assert.ok(Number.isFinite(output[i]));
                assert.ok(speech[i] >= 0 && speech[i] <= 1);
                nonzeroProbability ||= speech[i] > 0;
                if (block > 200) {
                    inputEnergy += input[i] ** 2;
                    outputEnergy += output[i] ** 2;
                }
            }
        }
        assert.ok(nonzeroProbability);
        assert.ok(outputEnergy < inputEnergy * 0.95);
        processor.port.onmessage({ data: 'destroy' });
        assert.equal(processor.process([], []), false);
    }
});
