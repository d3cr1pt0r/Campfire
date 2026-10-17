import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPeerSignaling } from '../src/signaling.ts';
import { selectAudioOutput, playbackError, syncPlaybackTracks } from '../src/playback.ts';

function peer() {
    return {
        signalingState: 'stable',
        remoteDescription: null,
        localDescription: null,
        candidates: [],
        events: [],
        async setLocalDescription() {
            const type = this.signalingState === 'have-remote-offer' ? 'answer' : 'offer';
            this.localDescription = { type, sdp: type };
            this.signalingState = type === 'answer' ? 'stable' : 'have-local-offer';
            this.events.push('local:' + type);
        },
        async setRemoteDescription(description) {
            this.events.push('remote:' + description.type);
            this.remoteDescription = description;
            this.signalingState = description.type === 'offer' ? 'have-remote-offer' : 'stable';
        },
        async addIceCandidate(candidate) {
            assert.ok(this.remoteDescription);
            this.candidates.push(candidate);
        },
    };
}
test('responder attaches local media before answering and does not create an initial competing offer', async () => {
    const pc = peer(),
        sent = [];
    const signal = createPeerSignaling(
        pc,
        true,
        (data) => sent.push(data),
        async () => pc.events.push('attach:local-media'),
        false,
    );
    await signal.negotiate();
    assert.equal(sent.length, 0);
    await signal.receive({ description: { type: 'offer', sdp: 'offer' } });
    assert.deepEqual(pc.events, ['remote:offer', 'attach:local-media', 'local:answer']);
    assert.equal(sent[0].description.type, 'answer');
});
test('joining peer sends its offer and accepts the remote answer', async () => {
    const pc = peer(),
        sent = [];
    const signal = createPeerSignaling(
        pc,
        false,
        (data) => sent.push(data),
        async () => {},
        true,
    );
    await signal.negotiate();
    assert.equal(sent[0].description.type, 'offer');
    await signal.receive({ description: { type: 'answer', sdp: 'answer' } });
    assert.equal(pc.signalingState, 'stable');
});
test('candidates arriving before a remote description are queued and then applied', async () => {
    const pc = peer();
    const signal = createPeerSignaling(
        pc,
        true,
        () => {},
        async () => {},
        false,
    );
    const candidate = { candidate: 'test-candidate' };
    await signal.receive({ candidate });
    assert.equal(pc.candidates.length, 0);
    await signal.receive({ description: { type: 'offer', sdp: 'offer' } });
    assert.deepEqual(pc.candidates, [candidate]);
});
test('impolite peer ignores colliding offers and their candidates, then accepts the answer', async () => {
    const pc = peer();
    const signal = createPeerSignaling(
        pc,
        false,
        () => {},
        async () => {},
        true,
    );
    await signal.negotiate();
    await signal.receive({ description: { type: 'offer', sdp: 'collision' } });
    await signal.receive({ candidate: { candidate: 'ignored' } });
    assert.equal(pc.remoteDescription, null);
    assert.equal(pc.candidates.length, 0);
    await signal.receive({ description: { type: 'answer', sdp: 'answer' } });
    await signal.receive({ candidate: { candidate: 'accepted' } });
    assert.equal(pc.candidates[0].candidate, 'accepted');
});
test('polite peer accepts a colliding offer and prepares its answer', async () => {
    const pc = peer(),
        sent = [];
    const signal = createPeerSignaling(
        pc,
        true,
        (data) => sent.push(data),
        async () => {},
        true,
    );
    await signal.negotiate();
    await signal.receive({ description: { type: 'offer', sdp: 'collision' } });
    assert.equal(pc.signalingState, 'stable');
    assert.deepEqual(
        sent.map((data) => data.description.type),
        ['offer', 'answer'],
    );
});
test('an offer arriving while a remote answer is pending is processed after the answer', async () => {
    const pc = peer();
    let release;
    const gate = new Promise((resolve) => (release = resolve));
    const apply = pc.setRemoteDescription.bind(pc);
    pc.setRemoteDescription = async (description) => {
        if (description.type === 'answer') await gate;
        await apply(description);
    };
    const signal = createPeerSignaling(
        pc,
        false,
        () => {},
        async () => {},
        true,
    );
    await signal.negotiate();
    const answer = signal.receive({ description: { type: 'answer', sdp: 'answer' } });
    const offer = signal.receive({ description: { type: 'offer', sdp: 'next-offer' } });
    release();
    await Promise.all([answer, offer]);
    assert.deepEqual(pc.events, ['local:offer', 'remote:answer', 'remote:offer', 'local:answer']);
});
test('closing a peer cancels a pending answer and prevents later signals', async () => {
    const pc = peer(),
        sent = [];
    let release;
    const gate = new Promise((resolve) => (release = resolve));
    const signal = createPeerSignaling(
        pc,
        true,
        (data) => sent.push(data),
        () => gate,
        false,
    );
    const pending = signal.receive({ description: { type: 'offer', sdp: 'offer' } });
    await Promise.resolve();
    await Promise.resolve();
    signal.close();
    release();
    await pending;
    await signal.negotiate();
    await signal.receive({ candidate: { candidate: 'late' } });
    assert.equal(sent.length, 0);
    assert.equal(pc.candidates.length, 0);
});
test('a rejected signal does not prevent later valid messages from being handled', async () => {
    const pc = peer();
    let first = true;
    const apply = pc.setRemoteDescription.bind(pc);
    pc.setRemoteDescription = async (description) => {
        if (first) {
            first = false;
            throw new Error('bad SDP');
        }
        await apply(description);
    };
    const signal = createPeerSignaling(
        pc,
        true,
        () => {},
        async () => {},
        false,
    );
    await assert.rejects(signal.receive({ description: { type: 'offer', sdp: 'bad' } }), /bad SDP/);
    await signal.receive({ description: { type: 'offer', sdp: 'valid' } });
    assert.equal(pc.signalingState, 'stable');
});
test('expired output device falls back to system default while denied output remains denied', async () => {
    const calls = [];
    assert.equal(
        await selectAudioOutput(
            {
                setSinkId: async (id) => {
                    calls.push(id);
                    if (id) throw new DOMException('', 'NotFoundError');
                },
            },
            'expired-speaker',
        ),
        true,
    );
    assert.deepEqual(calls, ['expired-speaker', '']);
    let attempts = 0;
    await assert.rejects(
        selectAudioOutput(
            {
                setSinkId: async () => {
                    attempts++;
                    throw new DOMException('', 'NotAllowedError');
                },
            },
            'speaker',
        ),
        { name: 'NotAllowedError' },
    );
    assert.equal(attempts, 1);
    assert.match(playbackError(new DOMException('', 'NotAllowedError')), /Play audio/);
});
class Stream {
    tracks = [];
    getTracks() {
        return [...this.tracks];
    }
    addTrack(track) {
        this.tracks.push(track);
    }
    removeTrack(track) {
        this.tracks = this.tracks.filter((t) => t !== track);
    }
}
test('camera/screen changes preserve the audible track and preview never plays local audio', () => {
    const audio = new Stream(),
        video = new Stream();
    const mic = { kind: 'audio', readyState: 'live' },
        camera = { kind: 'video', readyState: 'live' },
        screen = { kind: 'video', readyState: 'live' };
    syncPlaybackTracks(audio, video, [mic, camera]);
    assert.deepEqual(audio.getTracks(), [mic]);
    assert.deepEqual(video.getTracks(), [camera]);
    syncPlaybackTracks(audio, video, [mic, screen]);
    assert.deepEqual(audio.getTracks(), [mic]);
    assert.deepEqual(video.getTracks(), [screen]);
    syncPlaybackTracks(audio, video, [mic]);
    assert.deepEqual(audio.getTracks(), [mic]);
    assert.equal(video.getTracks().length, 0);
    syncPlaybackTracks(audio, video, [mic, camera], true);
    assert.equal(audio.getTracks().length, 0);
    camera.readyState = 'ended';
    syncPlaybackTracks(audio, video, [mic, camera]);
    assert.deepEqual(audio.getTracks(), [mic]);
    assert.equal(video.getTracks().length, 0);
});

test('default and already-selected outputs do not trigger redundant device switches', async () => {
    let attempts = 0;
    const element = {
        sinkId: '',
        setSinkId: async () => {
            attempts++;
            throw new DOMException('Backend failed', 'AbortError');
        },
    };
    assert.equal(await selectAudioOutput(element, ''), false);
    assert.equal(await selectAudioOutput(element, 'default'), false);
    assert.equal(attempts, 0);
    element.sinkId = 'headset';
    assert.equal(await selectAudioOutput(element, 'headset'), false);
    assert.equal(attempts, 0);
});

test('failed device switches use default output without retrying a default that is already active', async () => {
    const calls = [];
    assert.equal(
        await selectAudioOutput(
            {
                sinkId: '',
                setSinkId: async (id) => {
                    calls.push(id);
                    throw new DOMException('', 'AbortError');
                },
            },
            'broken',
        ),
        true,
    );
    assert.deepEqual(calls, ['broken']);
    calls.length = 0;
    assert.equal(
        await selectAudioOutput(
            {
                sinkId: 'old',
                setSinkId: async (id) => {
                    calls.push(id);
                    if (id) throw new DOMException('', 'AbortError');
                },
            },
            'broken',
        ),
        true,
    );
    assert.deepEqual(calls, ['broken', '']);
    await assert.rejects(
        selectAudioOutput(
            {
                sinkId: 'old',
                setSinkId: async () => {
                    throw new DOMException('', 'AbortError');
                },
            },
            '',
        ),
        { name: 'AbortError' },
    );
});
