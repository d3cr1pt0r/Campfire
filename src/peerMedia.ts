import type { MediaRole, MediaState, CallSignal } from '../shared/contracts';
import type { VideoEncoding } from './videoQuality';
export type { MediaRole, MediaState, CallSignal } from '../shared/contracts';
export function validMediaState(value: unknown): value is MediaState {
    if (!value || typeof value !== 'object') return false;
    const state = value as MediaState;
    return (
        typeof state.sharing === 'boolean' &&
        typeof state.camera === 'boolean' &&
        (state.sharing
            ? typeof state.shareId === 'string' &&
              state.shareId.length > 0 &&
              state.shareId.length <= 80
            : state.shareId === null)
    );
}
export function acceptsWatch(
    request: CallSignal['watch'],
    shareId: string | null,
    previousRevision: number,
): boolean {
    return (
        !!request &&
        !!shareId &&
        request.shareId === shareId &&
        typeof request.enabled === 'boolean' &&
        Number.isSafeInteger(request.revision) &&
        request.revision > previousRevision
    );
}
export function outgoingTracks(
    microphone: MediaStream | null,
    camera: MediaStream | null,
    screen: MediaStream | null,
    subscribed: boolean,
): Record<MediaRole, MediaStreamTrack | null> {
    const track = (stream: MediaStream | null, kind: string) =>
        stream?.getTracks().find((t) => t.kind === kind && t.readyState !== 'ended') || null;
    return {
        voice: track(microphone, 'audio'),
        video: screen ? (subscribed ? track(screen, 'video') : null) : track(camera, 'video'),
        streamAudio: screen && subscribed ? track(screen, 'audio') : null,
    };
}
// Chromium hands H.264 to the GPU's encoder (Media Foundation on Windows), while its
// default VP8 always encodes on the CPU, once per receiving peer. Without a hardware
// encoder H.264 falls back to software; a peer without H.264 negotiates the rest.
export function preferHardwareVideoCodec(codecs: RTCRtpCodec[]): RTCRtpCodec[] {
    const h264 = codecs.filter((codec) => codec.mimeType.toLowerCase() === 'video/h264');
    return [...h264, ...codecs.filter((codec) => !h264.includes(codec))];
}
// Encoding limits survive renegotiation and track replacement, so they are only set when the
// wanted values differ. A sender not yet given an encoding gets them on a later sync.
async function limitVideo(sender: RTCRtpSender, wanted: VideoEncoding | null) {
    if (!wanted) return;
    const parameters = sender.getParameters();
    const encoding = parameters.encodings?.[0];
    if (
        !encoding ||
        (encoding.maxBitrate === wanted.maxBitrate &&
            encoding.maxFramerate === wanted.maxFramerate &&
            parameters.degradationPreference === wanted.degradationPreference)
    )
        return;
    encoding.maxBitrate = wanted.maxBitrate;
    encoding.maxFramerate = wanted.maxFramerate;
    parameters.degradationPreference = wanted.degradationPreference;
    try {
        await sender.setParameters(parameters);
    } catch {
        /* Chromium's default limits still carry the video. */
    }
}
// Reserve separate voice, video, and system-audio transceivers. No screen media
// is attached for a peer unless that peer has subscribed to the current share.
export function createPeerMedia(
    pc: RTCPeerConnection,
    tracks: () => Record<MediaRole, MediaStreamTrack | null>,
    {
        videoCodecs = globalThis.RTCRtpReceiver?.getCapabilities('video')?.codecs,
        videoEncoding,
    }: {
        videoCodecs?: RTCRtpCodec[];
        // Limits for the camera or screen track being sent; null keeps the current ones.
        videoEncoding?: (track: MediaStreamTrack) => VideoEncoding | null;
    } = {},
) {
    const slots: Partial<Record<MediaRole, RTCRtpTransceiver>> = {};
    let queue = Promise.resolve(),
        closed = false;
    const find = (role: MediaRole) => {
        const kind = role === 'video' ? 'video' : 'audio';
        return pc.getTransceivers().filter((t) => t.receiver.track.kind === kind)[
            role === 'streamAudio' ? 1 : 0
        ];
    };
    const attach = async () => {
        const current = tracks();
        for (const role of ['voice', 'video', 'streamAudio'] as const) {
            if (closed) return;
            const sender = slots[role]?.sender;
            if (sender && sender.track !== current[role]) await sender.replaceTrack(current[role]);
        }
        const video = slots.video?.sender;
        if (!closed && video?.track && videoEncoding)
            await limitVideo(video, videoEncoding(video.track));
    };
    const enqueue = (operation: () => Promise<void>) => {
        const next = queue.then(async () => {
            if (!closed) await operation();
        });
        queue = next.catch(() => {});
        return next;
    };
    return {
        prepare: () =>
            enqueue(async () => {
                for (const role of ['voice', 'video', 'streamAudio'] as const) {
                    let transceiver = slots[role];
                    if (!transceiver) {
                        transceiver = slots[role] =
                            find(role) ||
                            pc.addTransceiver(role === 'video' ? 'video' : 'audio', {
                                direction: 'sendrecv',
                            });
                        // Set before the first offer or answer, which both follow it.
                        if (role === 'video' && videoCodecs)
                            try {
                                transceiver.setCodecPreferences(
                                    preferHardwareVideoCodec(videoCodecs),
                                );
                            } catch {
                                /* The browser's default codec order still connects. */
                            }
                    }
                    transceiver.direction = 'sendrecv';
                }
                await attach();
            }),
        sync: () => enqueue(attach),
        role(transceiver: RTCRtpTransceiver): MediaRole {
            if (transceiver.receiver.track.kind === 'video') return 'video';
            return transceiver === (slots.voice || find('voice')) ? 'voice' : 'streamAudio';
        },
        sendingVideo(): boolean {
            return !!slots.video?.sender.track;
        },
        videoCeiling(): number | null {
            return slots.video?.sender.getParameters?.().encodings?.[0]?.maxBitrate ?? null;
        },
        roleForMid(mid: string): MediaRole | undefined {
            return (['voice', 'video', 'streamAudio'] as const).find(
                (role) => (slots[role] || find(role))?.mid === mid,
            );
        },
        close() {
            closed = true;
        },
    };
}
