import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    createPeerMedia,
    outgoingTracks,
    acceptsWatch,
    validMediaState,
} from '../src/peerMedia.ts';
const track = (kind, id) => ({ kind, id, readyState: 'live', enabled: true });
const stream = (...tracks) => ({ getTracks: () => tracks });
function peer(offered = []) {
    const pc = {
        transceivers: [],
        getTransceivers() {
            return this.transceivers;
        },
        addTransceiver(kind) {
            const t = {
                mid: String(this.transceivers.length),
                direction: 'sendrecv',
                receiver: { track: track(kind, `remote-${this.transceivers.length}`) },
                sender: {
                    track: null,
                    calls: [],
                    async replaceTrack(value) {
                        this.calls.push(value);
                        this.track = value;
                    },
                },
            };
            this.transceivers.push(t);
            return t;
        },
    };
    offered.forEach((kind) => pc.addTransceiver(kind));
    return pc;
}
const sources = () => ({
    mic: track('audio', 'mic'),
    camera: track('video', 'camera'),
    video: track('video', 'screen'),
    audio: track('audio', 'system'),
});
test('a non-subscriber gets microphone only while someone is sharing', async () => {
    const s = sources(),
        pc = peer(),
        routing = createPeerMedia(pc, () =>
            outgoingTracks(stream(s.mic), stream(s.camera), stream(s.video, s.audio), false),
        );
    await routing.prepare();
    assert.equal(pc.transceivers.length, 3);
    assert.deepEqual(
        pc.transceivers.map((t) => t.sender.track),
        [s.mic, null, null],
    );
    assert.ok(pc.transceivers.slice(1).every((t) => t.sender.calls.length === 0));
});
test('one subscriber receives the stream while another peer receives no stream tracks', async () => {
    const s = sources(),
        a = peer(),
        b = peer();
    let watchingA = true,
        watchingB = false;
    const routingA = createPeerMedia(a, () =>
        outgoingTracks(stream(s.mic), null, stream(s.video, s.audio), watchingA),
    );
    const routingB = createPeerMedia(b, () =>
        outgoingTracks(stream(s.mic), null, stream(s.video, s.audio), watchingB),
    );
    await Promise.all([routingA.prepare(), routingB.prepare()]);
    assert.deepEqual(
        a.transceivers.map((t) => t.sender.track),
        [s.mic, s.video, s.audio],
    );
    assert.deepEqual(
        b.transceivers.map((t) => t.sender.track),
        [s.mic, null, null],
    );
    watchingA = false;
    watchingB = true;
    await Promise.all([routingA.sync(), routingB.sync()]);
    assert.deepEqual(
        a.transceivers.map((t) => t.sender.track),
        [s.mic, null, null],
    );
    assert.deepEqual(
        b.transceivers.map((t) => t.sender.track),
        [s.mic, s.video, s.audio],
    );
    assert.equal(a.transceivers[0].sender.calls.length, 1);
});
test('responders reuse offered audio slots and classify voice and program tracks separately', async () => {
    const s = sources(),
        pc = peer(['audio', 'video', 'audio']);
    const routing = createPeerMedia(pc, () => outgoingTracks(stream(s.mic), null, null, false));
    await routing.prepare();
    assert.equal(pc.transceivers.length, 3);
    assert.deepEqual(
        pc.transceivers.map((t) => routing.role(t)),
        ['voice', 'video', 'streamAudio'],
    );
    assert.equal(routing.roleForMid('2'), 'streamAudio');
});
test('rapid start/stop waits for track replacement then detaches both stream senders', async () => {
    const s = sources(),
        pc = peer();
    let watching = false,
        release;
    const routing = createPeerMedia(pc, () =>
        outgoingTracks(stream(s.mic), null, stream(s.video, s.audio), watching),
    );
    await routing.prepare();
    const sender = pc.transceivers[1].sender,
        replace = sender.replaceTrack.bind(sender);
    sender.replaceTrack = async (value) => {
        if (value === s.video) await new Promise((resolve) => (release = resolve));
        await replace(value);
    };
    watching = true;
    const start = routing.sync();
    await Promise.resolve();
    await Promise.resolve();
    assert.ok(release);
    watching = false;
    const stop = routing.sync();
    release();
    await Promise.all([start, stop]);
    assert.deepEqual(
        pc.transceivers.map((t) => t.sender.track),
        [s.mic, null, null],
    );
    assert.equal(sender.calls.at(-1), null);
});
test('late watch messages from a previous share or older request cannot attach stream tracks', () => {
    assert.equal(acceptsWatch({ shareId: 'old', enabled: true, revision: 3 }, 'new', 0), false);
    assert.equal(acceptsWatch({ shareId: 'new', enabled: true, revision: 2 }, 'new', 3), false);
    assert.equal(acceptsWatch({ shareId: 'new', enabled: false, revision: 4 }, 'new', 3), true);
    assert.equal(acceptsWatch({ shareId: 'new', enabled: true, revision: 4 }, null, 0), false);
    assert.equal(acceptsWatch({ shareId: 'new', enabled: 'yes', revision: 4 }, 'new', 0), false);
});
test('stopping the source removes system audio and restores the camera without changing voice', async () => {
    const s = sources(),
        pc = peer();
    let screen = stream(s.video, s.audio);
    const routing = createPeerMedia(pc, () =>
        outgoingTracks(stream(s.mic), stream(s.camera), screen, true),
    );
    await routing.prepare();
    screen = null;
    await routing.sync();
    assert.deepEqual(
        pc.transceivers.map((t) => t.sender.track),
        [s.mic, s.camera, null],
    );
    assert.equal(pc.transceivers[0].sender.calls.length, 1);
});
test('voice mute never changes system audio and ended capture tracks are excluded', () => {
    const s = sources();
    s.mic.enabled = false;
    assert.equal(
        outgoingTracks(stream(s.mic), null, stream(s.video, s.audio), true).streamAudio,
        s.audio,
    );
    assert.equal(s.audio.enabled, true);
    s.audio.readyState = 'ended';
    assert.equal(
        outgoingTracks(stream(s.mic), null, stream(s.video, s.audio), true).streamAudio,
        null,
    );
});
test('closing routing prevents a queued subscription from attaching a track later', async () => {
    const s = sources(),
        pc = peer(),
        routing = createPeerMedia(pc, () =>
            outgoingTracks(stream(s.mic), null, stream(s.video, s.audio), true),
        );
    const preparing = routing.prepare();
    routing.close();
    await preparing;
    await routing.sync();
    assert.equal(pc.transceivers.length, 0);
});
test('stream availability metadata requires a generation ID and real boolean flags', () => {
    assert.equal(validMediaState({ sharing: true, camera: false, shareId: 'screen-1' }), true);
    assert.equal(validMediaState({ sharing: false, camera: true, shareId: null }), true);
    for (const bad of [
        null,
        {},
        { sharing: true, camera: false, shareId: null },
        { sharing: 'true', camera: false, shareId: 'x' },
    ])
        assert.equal(validMediaState(bad), false);
});
