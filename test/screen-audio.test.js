import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createRequire } from 'node:module';
import { attachScreenAudio } from '../src/screenAudio.ts';
const { createScreenAudio, installScreenAudio } = createRequire(import.meta.url)(
    '../electron/screen-audio.cjs',
);

function fixture() {
    const track = Object.assign(new EventTarget(), {
        readyState: 'live',
        stops: 0,
        onended: null,
        stop() {
            this.stops++;
            this.readyState = 'ended';
        },
    });
    const audio = { getTracks: () => [track], getAudioTracks: () => [track] };
    const attached = [],
        calls = [],
        listeners = new Set();
    const bridge = {
        info: async () => ({
            token: 'selection',
            selection: 'Game window',
            available: true,
            applications: [{ id: '17', name: 'Game' }],
            recommended: '17',
        }),
        start: async (...args) => {
            calls.push(['start', ...args]);
            return { token: 'selection', name: 'campfire-source-test' };
        },
        stop: async (token) => {
            calls.push(['stop', token]);
        },
        onEnded: (callback) => {
            listeners.add(callback);
            return () => listeners.delete(callback);
        },
    };
    const devices = {
        enumerateDevices: async () => [
            { kind: 'audioinput', deviceId: 'microphone', label: 'Real microphone' },
            { kind: 'audioinput', deviceId: 'screen-source', label: 'campfire-source-test' },
        ],
        getUserMedia: async (constraints) => {
            calls.push(['capture', constraints]);
            return audio;
        },
    };
    return {
        track,
        audio,
        attached,
        calls,
        bridge,
        devices,
        listeners,
        options: {
            stream: { addTrack: (value) => attached.push(value) },
            signal: new AbortController().signal,
            bridge,
            devices,
            choose: async () => '17',
        },
    };
}
test('screen audio uses only the selected temporary input and preserves the microphone path', async () => {
    const f = fixture();
    const close = await attachScreenAudio(f.options);
    assert.deepEqual(f.calls[0], ['start', 'selection', '17']);
    assert.deepEqual(f.calls[1][1], {
        audio: {
            deviceId: { exact: 'screen-source' },
            channelCount: 2,
            sampleRate: 48000,
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
        },
        video: false,
    });
    assert.deepEqual(f.attached, [f.track]);
    close();
    close();
    assert.equal(f.track.stops, 1);
    assert.deepEqual(f.calls.at(-1), ['stop', 'selection']);
    assert.equal(f.listeners.size, 0);
});
test('video-only and cancellation do not start audio capture', async () => {
    for (const choice of ['none', null]) {
        const f = fixture();
        f.options.choose = async () => choice;
        if (choice === null)
            await assert.rejects(attachScreenAudio(f.options), { name: 'AbortError' });
        else await attachScreenAudio(f.options);
        assert.deepEqual(f.calls, [['stop', 'selection']]);
        assert.deepEqual(f.attached, []);
    }
});
test('cancelling a late browser capture stops its track and never attaches it', async () => {
    const f = fixture(),
        controller = new AbortController();
    let resolveCapture;
    const entered = new Promise((resolve) => {
        f.devices.getUserMedia = () => {
            resolve();
            return new Promise((done) => {
                resolveCapture = done;
            });
        };
    });
    const result = attachScreenAudio({ ...f.options, signal: controller.signal });
    await entered;
    controller.abort();
    resolveCapture(f.audio);
    await assert.rejects(result, { name: 'AbortError' });
    assert.equal(f.track.stops, 1);
    assert.deepEqual(f.attached, []);
    assert.ok(f.calls.some(([action]) => action === 'stop'));
});
test('missing source never falls back to another audio input', async () => {
    const f = fixture(),
        controller = new AbortController();
    f.devices.enumerateDevices = async () => {
        controller.abort();
        return [{ kind: 'audioinput', deviceId: 'microphone', label: 'Real microphone' }];
    };
    await assert.rejects(attachScreenAudio({ ...f.options, signal: controller.signal }), {
        name: 'AbortError',
    });
    assert.equal(
        f.calls.some(([action]) => action === 'capture'),
        false,
    );
});
test('native helper failure ends only the screen audio track and releases its source', async () => {
    const f = fixture();
    const close = await attachScreenAudio(f.options);
    let ended = false;
    f.track.addEventListener('ended', () => {
        ended = true;
    });
    for (const listener of f.listeners) listener('selection');
    assert.equal(ended, true);
    assert.equal(f.track.readyState, 'ended');
    assert.equal(f.listeners.size, 0);
    close();
});

function nativeFixture() {
    const children = [];
    const spawn = (_file, args) => {
        const child = Object.assign(new EventEmitter(), {
            stdin: new PassThrough(),
            stdout: new PassThrough(),
            stderr: new PassThrough(),
            exitCode: null,
            kill() {
                queueMicrotask(() => {
                    if (this.exitCode === null) {
                        this.exitCode = 0;
                        this.emit('exit', 0);
                    }
                });
            },
        });
        children.push({ child, args });
        queueMicrotask(() => {
            if (args.includes('--list')) {
                child.stdout.write(
                    JSON.stringify({
                        windowPid: 44,
                        applications: [
                            { id: '10', pid: '44', name: 'Game' },
                            { id: '11', pid: '44', name: 'Game second stream' },
                            { id: '12', pid: '45', name: 'Browser' },
                        ],
                    }),
                );
                child.exitCode = 0;
                child.emit('exit', 0);
            } else
                child.stdout.write(
                    JSON.stringify({ event: 'ready', name: args[args.indexOf('--name') + 1] }) +
                        '\n',
                );
        });
        return child;
    };
    const bridge = createScreenAudio({ helperPath: '/fake/helper', spawn });
    const owner = Object.assign(new EventEmitter(), { id: 1, isDestroyed: () => false, send() {} });
    return { children, bridge, owner };
}
test('native controller requires a screen selection, validates choices and recommends only a matching PID', async (t) => {
    const f = nativeFixture();
    t.after(() => f.bridge.close());
    await assert.rejects(f.bridge.start(f.owner, 'unknown', 'system'), /current screen share/);
    assert.equal(f.children.length, 0);
    f.bridge.selected(f.owner, { name: 'Game window', windowId: 123 });
    const info = await f.bridge.info(f.owner);
    assert.equal(info.recommended, '10');
    assert.equal(info.applications.length, 2);
    await assert.rejects(f.bridge.start(f.owner, info.token, '999'), /available audio source/);
    const source = await f.bridge.start(f.owner, info.token, '10');
    const child = f.children.at(-1).child;
    await f.bridge.stop(f.owner, 'another-session');
    assert.equal(child.exitCode, null);
    await f.bridge.stop(f.owner, source.token);
    assert.equal(child.exitCode, 0);
    await assert.rejects(f.bridge.start(f.owner, info.token, '10'), /current screen share/);
});
test('navigation and renderer destruction stop the owned helper', async (t) => {
    const f = nativeFixture();
    t.after(() => f.bridge.close());
    for (const event of ['did-start-navigation', 'destroyed']) {
        const owner = Object.assign(new EventEmitter(), {
            id: event,
            isDestroyed: () => false,
            send() {},
        });
        f.bridge.selected(owner, { name: 'Window' });
        const info = await f.bridge.info(owner);
        await f.bridge.start(owner, info.token, 'system');
        const child = f.children.at(-1).child;
        owner.emit(event, {}, 'https://other.example', false, true);
        await new Promise((resolve) => queueMicrotask(resolve));
        assert.equal(child.exitCode, 0);
    }
});
test('cancelling while a previous capture shuts down cannot start a new helper later', async (t) => {
    const f = nativeFixture();
    t.after(() => f.bridge.close());
    f.bridge.selected(f.owner, { name: 'First window' });
    const first = await f.bridge.info(f.owner);
    await f.bridge.start(f.owner, first.token, '10');
    f.bridge.selected(f.owner, { name: 'Second window' });
    const second = await f.bridge.info(f.owner);
    const count = f.children.length;
    const pending = f.bridge.start(f.owner, second.token, 'system');
    await f.bridge.stop(f.owner, second.token);
    await assert.rejects(pending, /cancelled/);
    assert.equal(f.children.length, count);
});
test('audio IPC rejects untrusted origins and subframes', async () => {
    const handlers = new Map();
    const capture = installScreenAudio({
        app: new EventEmitter(),
        ipcMain: { handle: (name, callback) => handlers.set(name, callback) },
        trusted: (url) => url === 'https://campfire.test',
        helperPath: '/fake/helper',
    });
    const owner = { mainFrame: { url: 'https://campfire.test' } };
    for (const senderFrame of [{ url: 'https://evil.test' }, { url: 'https://campfire.test' }]) {
        for (const callback of handlers.values())
            assert.throws(() => callback({ sender: owner, senderFrame }), /Untrusted/);
    }
    capture.close();
});
