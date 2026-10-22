import type { Preferences, VideoAdaptation, VideoLimit } from './types';

export type VideoSource = 'camera' | 'screen';
export type VideoSettings = {
    // Capture height in pixels; null keeps a shared screen at its own resolution.
    height: number | null;
    frameRate: number;
    bitrateScale: number;
    adaptation: VideoAdaptation;
};
export type VideoEncoding = {
    maxBitrate: number;
    maxFramerate: number;
    degradationPreference: RTCDegradationPreference;
};

export const cameraHeights = [360, 720, 1080];
export const cameraFrameRates = [15, 30];
export const screenHeights = [720, 1080, 1440];
export const screenFrameRates = [5, 15, 30, 60];
export const bitrateScales = [
    { value: 0.5, label: 'Data saver' },
    { value: 0.75, label: 'Lower' },
    { value: 1, label: 'Auto' },
    { value: 1.5, label: 'Higher' },
    { value: 2, label: 'High' },
    { value: 3, label: 'Maximum' },
];
export const adaptations: { value: VideoAdaptation; label: string }[] = [
    { value: 'sharp', label: 'Keep it sharp · lower the frame rate' },
    { value: 'smooth', label: 'Keep it smooth · lower the resolution' },
    { value: 'balanced', label: 'Balanced · lower both a little' },
];

function choose<T>(value: unknown, allowed: readonly T[], fallback: T): T {
    return allowed.includes(value as T) ? (value as T) : fallback;
}
export function videoSettings(prefs: Partial<Preferences>, source: VideoSource): VideoSettings {
    const scales = bitrateScales.map((scale) => scale.value);
    const modes = adaptations.map((mode) => mode.value);
    if (source === 'camera')
        return {
            height: choose(Number(prefs.quality), cameraHeights, 720),
            frameRate: choose(prefs.cameraFrameRate, cameraFrameRates, 30),
            bitrateScale: choose(prefs.cameraBitrate, scales, 1),
            adaptation: choose(prefs.cameraAdaptation, modes, 'balanced'),
        };
    return {
        height: choose<number | null>(Number(prefs.screenResolution), screenHeights, null),
        frameRate: choose(prefs.screenFrameRate, screenFrameRates, 30),
        bitrateScale: choose(prefs.screenBitrate, scales, 1),
        adaptation: choose(prefs.screenAdaptation, modes, 'sharp'),
    };
}

// Cameras snap to their nearest supported mode. Screens are only ever scaled down: scaling text
// blurs it, so the screen's own resolution is the sharpest choice.
export function captureConstraints(
    { height, frameRate }: VideoSettings,
    source: VideoSource,
): MediaTrackConstraints {
    if (source === 'camera')
        return { height: { ideal: height ?? 720 }, frameRate: { ideal: frameRate } };
    return {
        ...(height ? { height: { max: height } } : {}),
        frameRate: { ideal: frameRate, max: frameRate },
    };
}
// Chromium tunes its encoder by the hint: detail keeps text crisp, motion keeps movement smooth.
export function contentHint({ adaptation }: VideoSettings, source: VideoSource) {
    if (source === 'camera') return '';
    return adaptation === 'sharp' ? 'detail' : adaptation === 'smooth' ? 'motion' : '';
}

// Bitrate ceilings at 30 fps by pixel count. Shared screens carry text, which needs more bits
// than faces. Without a ceiling Chromium allows only about 2.5 Mbps at any size above 540p.
const ceilings: Record<VideoSource, [number, number][]> = {
    screen: [
        [1280 * 720, 3_000_000],
        [1920 * 1080, 5_000_000],
        [2560 * 1440, 8_000_000],
        [3840 * 2160, 14_000_000],
    ],
    camera: [
        [640 * 360, 1_000_000],
        [1280 * 720, 2_500_000],
        [1920 * 1080, 4_000_000],
    ],
};
// Fewer frames share the budget, but each frame then differs more from the last and costs more,
// so the ceiling falls more slowly than the frame rate.
const frameRateFactors: [number, number][] = [
    [5, 0.5],
    [15, 0.75],
    [30, 1],
    [60, 1.5],
];
function interpolate(points: [number, number][], x: number) {
    let index = 1;
    while (index < points.length - 1 && x > points[index][0]) index++;
    const [x0, y0] = points[index - 1],
        [x1, y1] = points[index];
    return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
}
export function maxBitrate(
    source: VideoSource,
    width: number,
    height: number,
    { frameRate, bitrateScale }: VideoSettings,
) {
    const rate =
        interpolate(ceilings[source], width * height) *
        interpolate(frameRateFactors, frameRate) *
        bitrateScale;
    return Math.max(300_000, Math.round(rate / 50_000) * 50_000);
}
// The size actually captured, which can differ from the request; before capture, the requested
// height at 16:9, or the display itself for a screen kept at its own resolution.
export function captureSize(
    track: Pick<MediaStreamTrack, 'getSettings'> | null,
    { height }: VideoSettings,
    display: { width: number; height: number; pixelRatio: number } = {
        width: globalThis.screen?.width || 1920,
        height: globalThis.screen?.height || 1080,
        pixelRatio: globalThis.devicePixelRatio || 1,
    },
) {
    const actual = track?.getSettings();
    if (actual?.width && actual.height) return { width: actual.width, height: actual.height };
    if (height) return { width: Math.round((height * 16) / 9), height };
    return {
        width: Math.round(display.width * display.pixelRatio),
        height: Math.round(display.height * display.pixelRatio),
    };
}
const degradation: Record<VideoAdaptation, RTCDegradationPreference> = {
    sharp: 'maintain-resolution',
    smooth: 'maintain-framerate',
    balanced: 'balanced',
};
export function videoEncoding(
    track: Pick<MediaStreamTrack, 'getSettings'> | null,
    prefs: Partial<Preferences>,
    source: VideoSource,
): VideoEncoding {
    const settings = videoSettings(prefs, source);
    const { width, height } = captureSize(track, settings);
    return {
        maxBitrate: maxBitrate(source, width, height, settings),
        maxFramerate: settings.frameRate,
        degradationPreference: degradation[settings.adaptation],
    };
}

export function formatBitrate(bits: number | null | undefined) {
    if (typeof bits !== 'number' || !Number.isFinite(bits)) return '—';
    if (bits >= 1_000_000) return `${(bits / 1_000_000).toFixed(bits >= 10_000_000 ? 0 : 1)} Mbps`;
    return `${Math.round(bits / 1000)} kbps`;
}

export type StatsEntry = { type: string; id: string; timestamp: number; [key: string]: unknown };
export type VideoSample = {
    time: number;
    sent: number | null;
    received: number | null;
    lost: number | null;
    packets: number | null;
    uploaded: number | null;
    downloaded: number | null;
};
export type SendingVideo = {
    bitrate: number | null;
    ceiling: number | null;
    width: number | null;
    height: number | null;
    frameRate: number | null;
    codec: string | null;
    encoder: string | null;
    gpu: boolean | null;
    // Chromium's reason for lowering resolution or frame rate: bandwidth, cpu, other or none.
    limitation: string | null;
    // Fraction of packets the viewer reports lost.
    loss: number | null;
};
export type ReceivingVideo = {
    bitrate: number | null;
    width: number | null;
    height: number | null;
    frameRate: number | null;
    codec: string | null;
    decoder: string | null;
    gpu: boolean | null;
    loss: number | null;
};
export type VideoSummary = {
    sending: SendingVideo | null;
    receiving: ReceivingVideo | null;
    roundTrip: number | null;
    availableUpload: number | null;
    // Everything sent to and received from this person, voice included.
    upload: number | null;
    download: number | null;
};
const number = (value: unknown) =>
    typeof value === 'number' && Number.isFinite(value) ? value : null;
const flag = (value: unknown) => (typeof value === 'boolean' ? value : null);
const text = (value: unknown) => (typeof value === 'string' && value ? value : null);

// Rates come from the change since the previous sample, so the first sample has none. Whether
// video flows each way comes from the call itself: a still screen can send nothing for seconds,
// and a sender detached from a viewer keeps reporting its old totals.
export function summarizeVideo(
    stats: StatsEntry[],
    {
        isVideo,
        previous,
        ceiling,
        sending,
        receiving,
    }: {
        isVideo: (mid: unknown) => boolean;
        previous: VideoSample | null;
        ceiling: number | null;
        sending: boolean;
        receiving: boolean;
    },
): { summary: VideoSummary; sample: VideoSample } {
    const byId = new Map(stats.map((stat) => [stat.id, stat]));
    const outbound = stats.find((stat) => stat.type === 'outbound-rtp' && isVideo(stat.mid));
    const inbound = stats.find((stat) => stat.type === 'inbound-rtp' && isVideo(stat.mid));
    const transport = stats.find((stat) => stat.type === 'transport');
    const pair =
        byId.get(String(transport?.selectedCandidatePairId)) ||
        stats.find(
            (stat) =>
                stat.type === 'candidate-pair' && stat.nominated && stat.state === 'succeeded',
        );
    const remote =
        outbound &&
        stats.find((stat) => stat.type === 'remote-inbound-rtp' && stat.localId === outbound.id);
    const time = Math.max(0, ...stats.map((stat) => stat.timestamp));
    const sample: VideoSample = {
        time,
        sent: number(outbound?.bytesSent),
        received: number(inbound?.bytesReceived),
        lost: number(inbound?.packetsLost),
        packets: number(inbound?.packetsReceived),
        uploaded: number(pair?.bytesSent),
        downloaded: number(pair?.bytesReceived),
    };
    const seconds = previous && time > previous.time ? (time - previous.time) / 1000 : null;
    const change = (key: keyof Omit<VideoSample, 'time'>) => {
        const now = sample[key],
            before = previous?.[key];
        return seconds && now !== null && typeof before === 'number' && now >= before
            ? now - before
            : null;
    };
    const rate = (key: keyof Omit<VideoSample, 'time'>) => {
        const bytes = change(key);
        return bytes === null || !seconds ? null : Math.round((bytes * 8) / seconds);
    };
    const codec = (stat: StatsEntry | undefined) =>
        text(byId.get(String(stat?.codecId))?.mimeType)?.replace(/^video\//i, '') ?? null;
    const sentRate = rate('sent'),
        receivedRate = rate('received');
    const lost = change('lost'),
        arrived = change('packets');
    return {
        sample,
        summary: {
            sending:
                sending && outbound
                    ? {
                          bitrate: sentRate,
                          ceiling,
                          width: number(outbound?.frameWidth),
                          height: number(outbound?.frameHeight),
                          frameRate: number(outbound?.framesPerSecond),
                          codec: codec(outbound),
                          encoder: text(outbound?.encoderImplementation),
                          gpu: flag(outbound?.powerEfficientEncoder),
                          limitation: text(outbound?.qualityLimitationReason),
                          loss: number(remote?.fractionLost),
                      }
                    : null,
            receiving:
                receiving && inbound
                    ? {
                          bitrate: receivedRate,
                          width: number(inbound?.frameWidth),
                          height: number(inbound?.frameHeight),
                          frameRate: number(inbound?.framesPerSecond),
                          codec: codec(inbound),
                          decoder: text(inbound?.decoderImplementation),
                          gpu: flag(inbound?.powerEfficientDecoder),
                          loss:
                              lost !== null && arrived !== null && lost + arrived > 0
                                  ? lost / (lost + arrived)
                                  : null,
                      }
                    : null,
            roundTrip: number(pair?.currentRoundTripTime),
            availableUpload: number(pair?.availableOutgoingBitrate),
            upload: rate('uploaded'),
            download: rate('downloaded'),
        },
    };
}

export function describeVideo(video: SendingVideo | ReceivingVideo) {
    const parts: string[] = [];
    if (video.width && video.height) parts.push(`${video.width}×${video.height}`);
    if (video.frameRate !== null) parts.push(`${Math.round(video.frameRate)} fps`);
    parts.push(
        'ceiling' in video && video.ceiling
            ? `${formatBitrate(video.bitrate)} of ${formatBitrate(video.ceiling)}`
            : formatBitrate(video.bitrate),
    );
    if (video.codec)
        parts.push(`${video.codec}${video.gpu === null ? '' : video.gpu ? ' on GPU' : ' on CPU'}`);
    if (video.loss !== null && video.loss >= 0.001)
        parts.push(`${(video.loss * 100).toFixed(1)}% lost`);
    return parts.join(' · ');
}

export type ObservedLimit = 'bandwidth' | 'cpu' | null;
// Bandwidth shows as Chromium lowering resolution or frame rate for lack of bits, or as the
// viewer losing more than 5% of packets. CPU limits come only from the encoder's own report.
export function observedLimit(sending: SendingVideo | null): ObservedLimit {
    if (!sending) return null;
    if (sending.limitation === 'cpu') return 'cpu';
    if (sending.limitation === 'bandwidth' || (sending.loss ?? 0) > 0.05) return 'bandwidth';
    return null;
}
export type LimitState = { limit: ObservedLimit; candidate: ObservedLimit; streak: number };
// A limit must hold for five samples before it is shown or cleared, so the first seconds of a
// stream, while its bitrate is still climbing, and brief dips do not raise warnings.
export function settleLimit(previous: LimitState | undefined, observed: ObservedLimit): LimitState {
    const state = previous ?? { limit: null, candidate: null, streak: 0 };
    if (observed === state.limit) return { limit: observed, candidate: observed, streak: 0 };
    const streak = observed === state.candidate ? state.streak + 1 : 1;
    return streak >= 5
        ? { limit: observed, candidate: observed, streak: 0 }
        : { limit: state.limit, candidate: observed, streak };
}
// Takes the settled limit for every viewer currently receiving video. All of several viewers
// limited at once points at the sender's upload; only some points at their own connections.
// With a single viewer the two sides cannot be told apart.
export function attributeLimits(limits: Map<string, ObservedLimit>): Map<string, VideoLimit> {
    const viewers = limits.size;
    const constrained = [...limits.values()].filter((limit) => limit === 'bandwidth').length;
    const result = new Map<string, VideoLimit>();
    for (const [id, limit] of limits) {
        if (limit === 'cpu') result.set(id, 'cpu');
        else if (limit === 'bandwidth')
            result.set(
                id,
                viewers === 1 ? 'connection' : constrained === viewers ? 'sender' : 'viewer',
            );
    }
    return result;
}
export function validQualityNotice(value: unknown): value is { limit: VideoLimit | null } {
    const limit = (value as { limit?: unknown } | null)?.limit;
    return limit === null || ['viewer', 'sender', 'connection', 'cpu'].includes(limit as string);
}
// Explains a limit from the sender's side (their video to `name`) or the viewer's (`name`'s
// video to them).
export function limitMessage(limit: VideoLimit, name: string, side: 'sender' | 'viewer') {
    if (side === 'sender')
        return {
            viewer: `${name}'s connection is reducing your video to them.`,
            sender: 'Your upload is reducing your video to everyone watching.',
            connection: `The connection between you and ${name} is reducing your video to them.`,
            cpu: 'Your computer cannot encode video fast enough; its quality is reduced.',
        }[limit];
    return {
        viewer: `Your connection is reducing ${name}'s video.`,
        sender: `${name}'s upload is reducing their video.`,
        connection: `The connection between you and ${name} is reducing their video.`,
        cpu: `${name}'s computer cannot encode video fast enough; its quality is reduced.`,
    }[limit];
}
