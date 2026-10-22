import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    attributeLimits,
    captureConstraints,
    captureSize,
    contentHint,
    describeVideo,
    formatBitrate,
    limitMessage,
    maxBitrate,
    observedLimit,
    settleLimit,
    summarizeVideo,
    validQualityNotice,
    videoEncoding,
    videoSettings,
} from '../src/videoQuality.ts';

const display = { width: 2560, height: 1440, pixelRatio: 1 };
const track = (width, height) => ({ getSettings: () => ({ width, height }) });

test('defaults keep cameras balanced at 720p and screens sharp at their own resolution', () => {
    assert.deepEqual(videoSettings({ quality: '720' }, 'camera'), {
        height: 720,
        frameRate: 30,
        bitrateScale: 1,
        adaptation: 'balanced',
    });
    assert.deepEqual(videoSettings({ quality: '720' }, 'screen'), {
        height: null,
        frameRate: 30,
        bitrateScale: 1,
        adaptation: 'sharp',
    });
    const saved = {
        quality: '1080',
        cameraFrameRate: 15,
        screenResolution: '1440',
        screenFrameRate: 60,
        screenBitrate: 2,
        screenAdaptation: 'smooth',
    };
    assert.equal(videoSettings(saved, 'camera').height, 1080);
    assert.equal(videoSettings(saved, 'camera').frameRate, 15);
    assert.deepEqual(videoSettings(saved, 'screen'), {
        height: 1440,
        frameRate: 60,
        bitrateScale: 2,
        adaptation: 'smooth',
    });
});
test('unknown or tampered saved values fall back to the defaults', () => {
    const tampered = {
        quality: '4320',
        cameraFrameRate: 240,
        cameraBitrate: 50,
        screenResolution: '999',
        screenFrameRate: '30',
        screenAdaptation: 'fast',
    };
    assert.deepEqual(videoSettings(tampered, 'camera'), {
        height: 720,
        frameRate: 30,
        bitrateScale: 1,
        adaptation: 'balanced',
    });
    assert.deepEqual(videoSettings(tampered, 'screen'), {
        height: null,
        frameRate: 30,
        bitrateScale: 1,
        adaptation: 'sharp',
    });
});
test('screens are only scaled down, never up, and source keeps their own size', () => {
    const screen = (prefs) => captureConstraints(videoSettings(prefs, 'screen'), 'screen');
    assert.deepEqual(screen({ screenResolution: 'source', screenFrameRate: 5 }), {
        frameRate: { ideal: 5, max: 5 },
    });
    assert.deepEqual(screen({ screenResolution: '1080' }), {
        height: { max: 1080 },
        frameRate: { ideal: 30, max: 30 },
    });
    assert.deepEqual(
        captureConstraints(
            videoSettings({ quality: '360', cameraFrameRate: 15 }, 'camera'),
            'camera',
        ),
        { height: { ideal: 360 }, frameRate: { ideal: 15 } },
    );
});
test('screen content hints follow what the sharer wants to keep', () => {
    const hint = (screenAdaptation) =>
        contentHint(videoSettings({ screenAdaptation }, 'screen'), 'screen');
    assert.equal(hint('sharp'), 'detail');
    assert.equal(hint('smooth'), 'motion');
    assert.equal(hint('balanced'), '');
    assert.equal(contentHint(videoSettings({}, 'camera'), 'camera'), '');
});
test('bitrate ceilings follow resolution, frame rate and the chosen scale', () => {
    const screen = (width, height, prefs = {}) =>
        maxBitrate('screen', width, height, videoSettings(prefs, 'screen'));
    const camera = (width, height, prefs = {}) =>
        maxBitrate('camera', width, height, videoSettings(prefs, 'camera'));
    assert.equal(screen(1920, 1080), 5_000_000);
    assert.equal(screen(2560, 1440), 8_000_000);
    assert.equal(screen(2560, 1440, { screenFrameRate: 5 }), 4_000_000);
    assert.equal(screen(2560, 1440, { screenFrameRate: 60 }), 12_000_000);
    assert.equal(screen(3840, 2160), 14_000_000);
    assert.equal(screen(1920, 1080, { screenBitrate: 2 }), 10_000_000);
    assert.equal(screen(1920, 1080, { screenBitrate: 0.5 }), 2_500_000);
    assert.equal(camera(1280, 720), 2_500_000);
    assert.equal(camera(640, 360, { cameraFrameRate: 15 }), 750_000);
    // An ultrawide screen has more pixels than 1440p and gets more bits.
    assert.ok(screen(3440, 1440) > 8_000_000);
    assert.equal(camera(160, 90, { cameraFrameRate: 15, cameraBitrate: 0.5 }), 300_000);
});
test('the ceiling uses the captured size, else the request, else the display', () => {
    const settings = (prefs) => videoSettings(prefs, 'screen');
    assert.deepEqual(captureSize(track(1728, 1080), settings({}), display), {
        width: 1728,
        height: 1080,
    });
    assert.deepEqual(captureSize(null, settings({ screenResolution: '1080' }), display), {
        width: 1920,
        height: 1080,
    });
    assert.deepEqual(
        captureSize(null, settings({}), { width: 1920, height: 1080, pixelRatio: 1.5 }),
        {
            width: 2880,
            height: 1620,
        },
    );
});
test('encodings carry the ceiling, frame rate and what to give up first', () => {
    assert.deepEqual(videoEncoding(track(2560, 1440), {}, 'screen'), {
        maxBitrate: 8_000_000,
        maxFramerate: 30,
        degradationPreference: 'maintain-resolution',
    });
    assert.deepEqual(
        videoEncoding(
            track(1280, 720),
            { cameraAdaptation: 'smooth', cameraFrameRate: 15 },
            'camera',
        ),
        { maxBitrate: 1_900_000, maxFramerate: 15, degradationPreference: 'maintain-framerate' },
    );
    assert.equal(
        videoEncoding(track(1280, 720), { screenAdaptation: 'balanced' }, 'screen')
            .degradationPreference,
        'balanced',
    );
});

const stats = ({ time, sent, fps = 30, received, lost, packets, reason = 'none', fraction }) =>
    [
        { type: 'transport', id: 'T', timestamp: time, selectedCandidatePairId: 'P' },
        {
            type: 'candidate-pair',
            id: 'P',
            timestamp: time,
            bytesSent: (sent ?? 0) + 5000,
            bytesReceived: (received ?? 0) + 4000,
            currentRoundTripTime: 0.024,
            availableOutgoingBitrate: 9_000_000,
        },
        { type: 'codec', id: 'C', timestamp: time, mimeType: 'video/H264' },
        sent !== undefined && {
            type: 'outbound-rtp',
            id: 'O',
            timestamp: time,
            mid: '1',
            kind: 'video',
            bytesSent: sent,
            frameWidth: 2560,
            frameHeight: 1440,
            framesPerSecond: fps,
            codecId: 'C',
            encoderImplementation: 'MediaFoundationVideoEncodeAccelerator',
            powerEfficientEncoder: true,
            qualityLimitationReason: reason,
        },
        fraction !== undefined && {
            type: 'remote-inbound-rtp',
            id: 'R',
            timestamp: time,
            localId: 'O',
            fractionLost: fraction,
        },
        received !== undefined && {
            type: 'inbound-rtp',
            id: 'I',
            timestamp: time,
            mid: '1',
            kind: 'video',
            bytesReceived: received,
            packetsLost: lost,
            packetsReceived: packets,
            frameWidth: 1280,
            frameHeight: 720,
            framesPerSecond: 30,
            codecId: 'C',
            decoderImplementation: 'D3D11VideoDecoder',
            powerEfficientDecoder: false,
        },
        { type: 'outbound-rtp', id: 'A', timestamp: time, mid: '0', kind: 'audio', bytesSent: 999 },
    ].filter(Boolean);
const options = (previous, ceiling = null, sending = true, receiving = true) => ({
    isVideo: (mid) => mid === '1',
    previous,
    ceiling,
    sending,
    receiving,
});

test('video stats report bitrates from the change since the previous sample', () => {
    const first = summarizeVideo(
        stats({ time: 1000, sent: 0, received: 0, lost: 0, packets: 0 }),
        options(null, 8_000_000),
    );
    assert.equal(first.summary.sending.bitrate, null);
    assert.equal(first.summary.sending.codec, 'H264');
    assert.equal(first.summary.sending.gpu, true);
    assert.equal(first.summary.receiving.gpu, false);
    const second = summarizeVideo(
        stats({ time: 3000, sent: 1_000_000, received: 500_000, lost: 10, packets: 990 }),
        options(first.sample, 8_000_000),
    );
    assert.equal(second.summary.sending.bitrate, 4_000_000);
    assert.equal(second.summary.sending.ceiling, 8_000_000);
    assert.equal(second.summary.receiving.bitrate, 2_000_000);
    assert.equal(second.summary.receiving.loss, 0.01);
    assert.equal(second.summary.upload, 4_000_000);
    assert.equal(second.summary.download, 2_000_000);
    assert.equal(second.summary.roundTrip, 0.024);
    assert.equal(second.summary.availableUpload, 9_000_000);
});
test('video counts as flowing by the call state, not by bytes, so still screens stay listed', () => {
    const before = summarizeVideo(
        stats({ time: 1000, sent: 50_000, received: 9, fps: 0 }),
        options(null),
    );
    const still = summarizeVideo(
        stats({ time: 2000, sent: 50_000, received: 9, fps: 0 }),
        options(before.sample),
    );
    assert.equal(still.summary.sending.bitrate, 0);
    assert.equal(still.summary.receiving.bitrate, 0);
    // A sender detached from this viewer keeps its old totals but no longer counts.
    const detached = summarizeVideo(
        stats({ time: 2000, sent: 50_000, received: 9 }),
        options(before.sample, null, false, false),
    );
    assert.equal(detached.summary.sending, null);
    assert.equal(detached.summary.receiving, null);
});
test('bandwidth limits come from Chromium lowering quality or from lost packets', () => {
    const sending = (limitation, loss = null) => ({ limitation, loss });
    assert.equal(observedLimit(null), null);
    assert.equal(observedLimit(sending('none', 0.01)), null);
    assert.equal(observedLimit(sending('bandwidth')), 'bandwidth');
    assert.equal(observedLimit(sending('none', 0.08)), 'bandwidth');
    assert.equal(observedLimit(sending('cpu', 0.08)), 'cpu');
    const summary = summarizeVideo(
        stats({ time: 1000, sent: 10, reason: 'bandwidth', fraction: 0.02 }),
        options(null),
    ).summary;
    assert.equal(observedLimit(summary.sending), 'bandwidth');
});
test('a limit must hold for five samples to be shown and five more to clear', () => {
    let state;
    for (let sample = 1; sample <= 4; sample++) {
        state = settleLimit(state, 'bandwidth');
        assert.equal(state.limit, null, `sample ${sample}`);
    }
    state = settleLimit(state, 'bandwidth');
    assert.equal(state.limit, 'bandwidth');
    // A brief recovery does not clear it, and the count restarts after it.
    state = settleLimit(state, null);
    state = settleLimit(state, null);
    state = settleLimit(state, 'bandwidth');
    for (let sample = 1; sample <= 4; sample++) state = settleLimit(state, null);
    assert.equal(state.limit, 'bandwidth');
    state = settleLimit(state, null);
    assert.equal(state.limit, null);
});
test('limits are attributed to the viewer, the sender or the connection between them', () => {
    const attribute = (entries) => Object.fromEntries(attributeLimits(new Map(entries)));
    assert.deepEqual(attribute([['a', 'bandwidth']]), { a: 'connection' });
    assert.deepEqual(
        attribute([
            ['a', 'bandwidth'],
            ['b', 'bandwidth'],
        ]),
        { a: 'sender', b: 'sender' },
    );
    assert.deepEqual(
        attribute([
            ['a', 'bandwidth'],
            ['b', null],
            ['c', null],
        ]),
        { a: 'viewer' },
    );
    assert.deepEqual(
        attribute([
            ['a', 'cpu'],
            ['b', null],
        ]),
        { a: 'cpu' },
    );
    assert.deepEqual(attribute([]), {});
});
test('quality notices from peers are validated before use', () => {
    for (const limit of ['viewer', 'sender', 'connection', 'cpu', null])
        assert.equal(validQualityNotice({ limit }), true);
    for (const bad of [undefined, null, {}, { limit: 'everyone' }, { limit: 1 }])
        assert.equal(validQualityNotice(bad), false);
});
test('limit messages name who is reducing the video from each side', () => {
    assert.match(limitMessage('viewer', 'Ana', 'sender'), /Ana's connection/);
    assert.match(limitMessage('sender', 'Ana', 'sender'), /Your upload/);
    assert.match(limitMessage('viewer', 'Ana', 'viewer'), /Your connection/);
    assert.match(limitMessage('sender', 'Ana', 'viewer'), /Ana's upload/);
    assert.match(limitMessage('connection', 'Ana', 'viewer'), /between you and Ana/);
});
test('bitrates and video lines are readable', () => {
    assert.equal(formatBitrate(4_200_000), '4.2 Mbps');
    assert.equal(formatBitrate(12_400_000), '12 Mbps');
    assert.equal(formatBitrate(850_000), '850 kbps');
    assert.equal(formatBitrate(null), '—');
    assert.equal(
        describeVideo({
            width: 2560,
            height: 1440,
            frameRate: 29.7,
            bitrate: 4_200_000,
            ceiling: 8_000_000,
            codec: 'H264',
            gpu: true,
            loss: 0.012,
        }),
        '2560×1440 · 30 fps · 4.2 Mbps of 8.0 Mbps · H264 on GPU · 1.2% lost',
    );
});
