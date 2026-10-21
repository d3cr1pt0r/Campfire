import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import {
    audioLevel,
    participantLevels,
    participantVolumeKey,
    voiceThreshold,
} from '../src/audioPreferences.ts';
import { microphoneConstraints, openMicrophone } from '../src/media.ts';

test('legacy audio processing migrates without coupling newly saved options', async () => {
    assert.deepEqual(microphoneConstraints({ noise: false }), {
        noiseSuppression: false,
        echoCancellation: false,
        autoGainControl: false,
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
test('audio levels reject invalid persisted numbers and bound boost and threshold', () => {
    for (const value of [undefined, null, NaN, Infinity, '0.5']) assert.equal(audioLevel(value), 1);
    assert.equal(audioLevel(-3), 0);
    assert.equal(audioLevel(8), 1);
    assert.equal(audioLevel(1.5, 1, 2), 1.5);
    assert.equal(voiceThreshold(NaN), -45);
    assert.equal(voiceThreshold(-100), -60);
    assert.equal(voiceThreshold(0), -15);
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
    const process = (amplitude, milliseconds) => {
        let last;
        for (let block = 0; block < Math.ceil((milliseconds * 48) / 128); block++) {
            const input = new Float32Array(128).fill(amplitude),
                output = new Float32Array(128);
            processor.process([[input]], [[output]]);
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
