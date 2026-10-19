import { useEffect, useRef, useState } from 'react';
import type { AppSocket } from './types';
import type { CallMember, Preferences } from './types';
import { openMicrophone, formatMicrophoneError } from './media';
import { createPeerSignaling } from './signaling';
import {
    createPeerMedia,
    outgoingTracks,
    validMediaState,
    acceptsWatch,
    type CallSignal,
    type MediaState,
} from './peerMedia';
type Peer = {
    pc: RTCPeerConnection;
    stream: MediaStream;
    user: string;
    signaling: ReturnType<typeof createPeerSignaling>;
    id: string;
    routing: ReturnType<typeof createPeerMedia>;
    streamAudio: MediaStream;
    media: MediaState;
    watching: boolean;
    wantsStream: boolean;
    watchPending: boolean;
    watchRevision: number;
    requestedRevision: number;
    watchTimer?: ReturnType<typeof setTimeout>;
};
export function useCall(
    socket: AppSocket | null,
    prefs: Preferences,
    iceServers: RTCIceServer[],
    report: (s: string) => void,
    onInputFallback: () => void,
    permission: (name: string, channel?: string | null) => boolean,
) {
    const permissionRef = useRef(permission);
    permissionRef.current = permission;
    const [channel, setChannel] = useState<string | null>(null);
    const canJoin = permission('calls.join', channel),
        canSpeak = permission('calls.speak', channel),
        canCamera = permission('calls.camera', channel),
        canShare = permission('calls.share', channel);
    const [muted, setMuted] = useState(false),
        [deafened, setDeafened] = useState(false),
        [camera, setCamera] = useState(false),
        [sharing, setSharing] = useState(false);
    const [local, setLocal] = useState<MediaStream | null>(null),
        [remote, setRemote] = useState<
            {
                id: string;
                user: string;
                stream: MediaStream;
                streamAudio: MediaStream;
                sharing: boolean;
                camera: boolean;
                watching: boolean;
                watchPending: boolean;
            }[]
        >([]);
    const [showDetails, setShowDetails] = useState(false);
    const [panelOpen, setPanelOpen] = useState(false);
    const pendingWatch = useRef<{ socket: string; shareId: string; channel: string } | null>(null);
    const pendingWatchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const [details, setDetails] = useState<
        {
            id: string;
            user: string;
            connection: string;
            ice: string;
            direction: string;
            sent: number | null;
            received: number | null;
            inputLevel: number | null;
            receivedLevel: number | null;
            mediaSent: number | null;
            mediaReceived: number | null;
        }[]
    >([]);
    const operation = useRef(0);
    const shareId = useRef<string | null>(null);
    const incompatible = useRef(new Set<string>());
    const captureBusy = useRef({ camera: false, share: false, microphone: false });
    const audioFlags = useRef({ muted, deafened });
    audioFlags.current = { muted, deafened };
    const peers = useRef(new Map<string, Peer>()),
        audio = useRef<MediaStream | null>(null),
        video = useRef<MediaStream | null>(null),
        screen = useRef<MediaStream | null>(null),
        callChannel = useRef<string | null>(null),
        pressed = useRef(false);
    const prefsRef = useRef(prefs);
    prefsRef.current = prefs;
    const iceRef = useRef(iceServers);
    iceRef.current = iceServers;
    const sound = () => {
        if (!prefsRef.current.sounds) return;
        try {
            const c = new AudioContext();
            const o = c.createOscillator(),
                g = c.createGain();
            o.connect(g);
            g.connect(c.destination);
            g.gain.setValueAtTime(0.06, c.currentTime);
            g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.18);
            o.frequency.value = 660;
            o.start();
            o.stop(c.currentTime + 0.2);
            o.onended = () => void c.close();
        } catch {
            /* optional sound */
        }
    };
    const updateRemote = () =>
        setRemote(
            [...peers.current].map(([id, p]) => ({
                id,
                user: p.user,
                stream: p.stream,
                streamAudio: p.streamAudio,
                sharing: p.media.sharing,
                camera: p.media.camera,
                watching: p.watching,
                watchPending: p.watchPending,
            })),
        );
    const disposePeer = (peer: Peer | undefined) => {
        if (!peer) return;
        clearTimeout(peer.watchTimer);
        peer.signaling.close();
        peer.routing.close();
        peer.pc.onconnectionstatechange = null;
        peer.pc.ontrack = null;
        peer.pc.onicecandidate = null;
        peer.pc.onnegotiationneeded = null;
        peer.pc.close();
        peers.current.delete(peer.id);
    };
    const leave = () => {
        const wasInCall = !!callChannel.current;
        operation.current++;
        pendingWatch.current = null;
        clearTimeout(pendingWatchTimer.current);
        setPanelOpen(false);
        setShowDetails(false);
        socket?.emit('call:leave');
        callChannel.current = null;
        setChannel(null);
        peers.current.forEach(disposePeer);
        peers.current.clear();
        shareId.current = null;
        incompatible.current.clear();
        [audio.current, video.current, screen.current].forEach((s) =>
            s?.getTracks().forEach((t) => t.stop()),
        );
        audio.current = null;
        video.current = null;
        screen.current = null;
        setLocal(null);
        setRemote([]);
        setCamera(false);
        setSharing(false);
        if (wasInCall) sound();
    };
    const currentVideo = () =>
        screen.current?.getVideoTracks()[0] || video.current?.getVideoTracks()[0] || null;
    const localMedia = (): MediaState => ({
        sharing: !!screen.current,
        camera: !!video.current,
        shareId: shareId.current,
    });
    const send = (id: string, data: Partial<CallSignal>) =>
        socket?.emit('signal', { to: id, data: { ...data, version: 2, media: localMedia() } });
    const receivedTrackGate = (p: Peer) => {
        p.stream
            .getVideoTracks()
            .forEach((track) => (track.enabled = p.media.sharing ? p.watching : p.media.camera));
        p.streamAudio
            .getAudioTracks()
            .forEach((track) => (track.enabled = p.media.sharing && p.watching));
    };
    useEffect(() => {
        if (channel) socket?.emit('call:status', { muted, deafened, camera });
    }, [socket, channel, muted, deafened, camera]);
    const syncMedia = async () => {
        socket?.emit('call:media', shareId.current);
        const track = currentVideo();
        setLocal(track ? new MediaStream([track]) : null);
        await Promise.all(
            [...peers.current.values()].map(async (p) => {
                await p.routing.sync();
                send(p.id, {});
            }),
        );
    };
    const stopShare = () => {
        const capture = screen.current;
        screen.current = null;
        shareId.current = null;
        peers.current.forEach((p) => {
            p.wantsStream = false;
            p.watchRevision = 0;
        });
        capture?.getTracks().forEach((track) => {
            track.onended = null;
            track.stop();
        });
        setSharing(false);
    };
    const makePeer = (id: string, user: string, initialOfferer = false) => {
        const existing = peers.current.get(id);
        if (existing) return existing;
        const pc = new RTCPeerConnection({ iceServers: iceRef.current });
        let p: Peer;
        let preparing = false;
        const routing = createPeerMedia(pc, () =>
            outgoingTracks(audio.current, video.current, screen.current, p.wantsStream),
        );
        const prepareTracks = async () => {
            preparing = true;
            try {
                await routing.prepare();
            } finally {
                preparing = false;
            }
        };
        const signaling = createPeerSignaling(
            pc,
            String(socket?.id) > id,
            (data) => send(id, data),
            prepareTracks,
            initialOfferer,
        );
        p = {
            id,
            pc,
            user,
            stream: new MediaStream(),
            streamAudio: new MediaStream(),
            signaling,
            routing,
            media: { sharing: false, camera: false, shareId: null },
            watching: false,
            wantsStream: false,
            watchPending: false,
            watchRevision: 0,
            requestedRevision: 0,
        };
        peers.current.set(id, p);
        pc.onicecandidate = (event) => {
            if (event.candidate) send(id, { candidate: event.candidate.toJSON() });
        };
        pc.ontrack = (event) => {
            const target =
                routing.role(event.transceiver) === 'streamAudio' ? p.streamAudio : p.stream;
            if (!target.getTracks().some((track) => track.id === event.track.id))
                target.addTrack(event.track);
            receivedTrackGate(p);
            updateRemote();
        };
        pc.onnegotiationneeded = () => {
            if (!preparing)
                void signaling.negotiate().catch((error) => {
                    if (pc.signalingState !== 'closed')
                        report(`Call negotiation: ${error.name || 'Error'} ${error.message || ''}`);
                });
        };
        pc.onconnectionstatechange = () => {
            if (pc.connectionState === 'failed')
                report(
                    'A peer connection failed. Check Call details; a TURN relay may be needed if direct connectivity is blocked.',
                );
        };
        if (initialOfferer)
            void prepareTracks()
                .then(() => signaling.negotiate())
                .catch((error) => {
                    if (pc.signalingState !== 'closed')
                        report(`Call setup: ${error.name || 'Error'} ${error.message || ''}`);
                });
        send(id, {});
        return p;
    };
    useEffect(() => {
        if (!socket) return;
        const signal = async ({
            from,
            user,
            data,
        }: {
            from: string;
            user: string;
            data: CallSignal;
        }) => {
            if (!callChannel.current || incompatible.current.has(from)) return;
            if (data?.version !== 2) {
                incompatible.current.add(from);
                disposePeer(peers.current.get(from));
                updateRemote();
                report(
                    'Call media versions differ. Update all clients to use stream subscriptions and separate audio.',
                );
                return;
            }
            const peer = makePeer(from, user);
            try {
                if (validMediaState(data.media)) {
                    if (data.media.shareId !== peer.media.shareId || !data.media.sharing) {
                        peer.watching = false;
                        peer.watchPending = false;
                        clearTimeout(peer.watchTimer);
                    }
                    peer.media = data.media;
                    receivedTrackGate(peer);
                    const target = pendingWatch.current;
                    if (target?.socket === from && target.channel === callChannel.current) {
                        pendingWatch.current = null;
                        clearTimeout(pendingWatchTimer.current);
                        if (target.shareId === peer.media.shareId && peer.media.sharing)
                            watch(from, true);
                        else report('That screen share has ended.');
                    }
                    updateRemote();
                }
                if (acceptsWatch(data.watch, shareId.current, peer.watchRevision)) {
                    const request = data.watch!;
                    peer.watchRevision = request.revision;
                    peer.wantsStream = request.enabled;
                    try {
                        await peer.routing.sync();
                    } catch (error) {
                        disposePeer(peer);
                        updateRemote();
                        throw error;
                    }
                    if (
                        request.revision === peer.watchRevision &&
                        request.shareId === shareId.current
                    )
                        send(from, { watchAck: request });
                }
                const ack = data.watchAck;
                if (
                    ack &&
                    ack.shareId === peer.media.shareId &&
                    ack.revision === peer.requestedRevision &&
                    ack.enabled === peer.watching
                ) {
                    clearTimeout(peer.watchTimer);
                    peer.watchPending = false;
                    updateRemote();
                }
                if (data.description || data.candidate) await peer.signaling.receive(data);
            } catch (error) {
                report(
                    `Media connection: ${(error as Error).name || 'Error'} ${(error as Error).message || 'Signaling failed'}`,
                );
            }
        };
        const calls = (members: CallMember[]) => {
            const target = pendingWatch.current;
            if (
                target &&
                !members.some(
                    (member) =>
                        member.socket === target.socket &&
                        member.channel === target.channel &&
                        member.shareId === target.shareId,
                )
            ) {
                pendingWatch.current = null;
                clearTimeout(pendingWatchTimer.current);
                report('That screen share has ended.');
            }
            const ids = new Set(
                members.filter((c) => c.channel === callChannel.current).map((c) => c.socket),
            );
            let changed = false;
            peers.current.forEach((p, id) => {
                if (!ids.has(id)) {
                    disposePeer(p);
                    changed = true;
                }
            });
            if (changed) {
                sound();
                updateRemote();
            }
        };
        const revoked = (reason?: string) => {
            leave();
            report(reason || 'Your role no longer has permission to join calls.');
        };
        const disconnect = () => leave();
        socket.on('call:revoked', revoked);
        socket.on('signal', signal);
        socket.on('calls', calls);
        socket.on('disconnect', disconnect);
        return () => {
            socket.off('call:revoked', revoked);
            socket.off('signal', signal);
            socket.off('calls', calls);
            socket.off('disconnect', disconnect);
            leave();
        };
        // Socket lifetime owns all media resources.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [socket]);
    useEffect(() => {
        const enable = () =>
            audio.current
                ?.getAudioTracks()
                .forEach(
                    (t) =>
                        (t.enabled = !muted && !deafened && (!prefs.pushToTalk || pressed.current)),
                );
        enable();
        const down = (e: KeyboardEvent) => {
            if (
                !prefs.pushToTalk ||
                !callChannel.current ||
                e.code !== 'Space' ||
                (e.target as HTMLElement)?.closest('input,textarea,select,[contenteditable]')
            )
                return;
            pressed.current = true;
            enable();
            e.preventDefault();
        };
        const up = (e: KeyboardEvent) => {
            if (e.code === 'Space') {
                pressed.current = false;
                enable();
            }
        };
        const blur = () => {
            pressed.current = false;
            enable();
        };
        window.addEventListener('keydown', down);
        window.addEventListener('keyup', up);
        window.addEventListener('blur', blur);
        return () => {
            window.removeEventListener('keydown', down);
            window.removeEventListener('keyup', up);
            window.removeEventListener('blur', blur);
        };
    }, [muted, deafened, prefs.pushToTalk, channel]);
    useEffect(() => {
        if (!channel || !showDetails) {
            setDetails([]);
            return;
        }
        let canceled = false,
            pending = false;
        const sample = async () => {
            if (pending) return;
            pending = true;
            try {
                const rows = await Promise.all(
                    [...peers.current].map(async ([id, peer]) => {
                        let sent: number | null = null,
                            received: number | null = null,
                            inputLevel: number | null = null,
                            receivedLevel: number | null = null,
                            mediaSent: number | null = null,
                            mediaReceived: number | null = null;
                        try {
                            const stats = await peer.pc.getStats();
                            stats.forEach((stat) => {
                                const role = peer.routing.roleForMid(stat.mid);
                                if (role === 'video' || role === 'streamAudio') {
                                    if (stat.type === 'outbound-rtp')
                                        mediaSent = (mediaSent || 0) + (stat.bytesSent || 0);
                                    if (stat.type === 'inbound-rtp')
                                        mediaReceived =
                                            (mediaReceived || 0) + (stat.bytesReceived || 0);
                                    return;
                                }
                                if ((stat.kind || stat.mediaType) !== 'audio') return;
                                if (stat.type === 'outbound-rtp')
                                    sent = (sent || 0) + (stat.packetsSent || 0);
                                if (stat.type === 'inbound-rtp') {
                                    received = (received || 0) + (stat.packetsReceived || 0);
                                    if (typeof stat.audioLevel === 'number')
                                        receivedLevel = stat.audioLevel;
                                }
                                if (
                                    stat.type === 'media-source' &&
                                    stat.trackIdentifier ===
                                        audio.current?.getAudioTracks()[0]?.id &&
                                    typeof stat.audioLevel === 'number'
                                )
                                    inputLevel = stat.audioLevel;
                            });
                        } catch {
                            /* Peer may close during a sample. */
                        }
                        return {
                            id,
                            user: peer.user,
                            connection: peer.pc.connectionState,
                            ice: peer.pc.iceConnectionState,
                            direction:
                                peer.pc
                                    .getTransceivers()
                                    .find((t) => t.receiver.track.kind === 'audio')
                                    ?.currentDirection || 'not negotiated',
                            sent,
                            received,
                            inputLevel,
                            receivedLevel,
                            mediaSent,
                            mediaReceived,
                        };
                    }),
                );
                if (!canceled) setDetails(rows);
            } finally {
                pending = false;
            }
        };
        void sample();
        const timer = setInterval(() => void sample(), 1000);
        return () => {
            canceled = true;
            clearInterval(timer);
        };
    }, [channel, showDetails]);
    const join = async (id: string, target?: { socket: string; shareId: string }) => {
        if (!permissionRef.current('calls.join', id)) {
            report('You do not have permission to join calls.');
            return;
        }
        if (!socket?.connected) {
            report('Connect to the server before joining a call.');
            return;
        }
        leave();
        if (target) queueWatch({ ...target, channel: id });
        const attempt = operation.current;
        try {
            const { stream, usedDefault } = permissionRef.current('calls.speak', id)
                ? await openMicrophone(prefs)
                : { stream: new MediaStream(), usedDefault: false };
            if (attempt !== operation.current || !permissionRef.current('calls.join', id)) {
                stream.getTracks().forEach((t) => t.stop());
                return;
            }
            if (usedDefault) {
                onInputFallback();
                report(
                    'The saved microphone is unavailable. Using System default for this call; your saved selection is kept for next time.',
                );
            }
            if (!permissionRef.current('calls.speak', id))
                stream.getTracks().forEach((t) => t.stop());
            audio.current = stream;
            if (!permissionRef.current('calls.speak', id)) setMuted(true);
            callChannel.current = id;
            socket
                .timeout(10000)
                .emit(
                    'call:join',
                    id,
                    (error: Error | null, result: import('./types').JoinResult) => {
                        if (attempt !== operation.current) return;
                        if (error || !result?.peers) {
                            leave();
                            report(result?.error || 'The server did not answer the call request');
                            return;
                        }
                        setChannel(id);
                        setPanelOpen(!!target);
                        audio.current
                            ?.getTracks()
                            .forEach(
                                (t) =>
                                    (t.enabled =
                                        !audioFlags.current.muted &&
                                        !audioFlags.current.deafened &&
                                        !prefsRef.current.pushToTalk),
                            );
                        result.peers.forEach((p) => makePeer(p.socket, p.user, true));
                        sound();
                    },
                );
        } catch (e) {
            if (attempt !== operation.current) return;
            leave();
            report(`Cannot open microphone: ${formatMicrophoneError(e)}`);
        }
    };
    const setMicrophoneMuted = async (value: boolean) => {
        if (value) {
            setMuted(true);
            return;
        }
        if (!permissionRef.current('calls.speak') || captureBusy.current.microphone) return;
        if (
            callChannel.current &&
            !audio.current?.getAudioTracks().some((track) => track.readyState === 'live')
        ) {
            captureBusy.current.microphone = true;
            const attempt = operation.current;
            let captured: MediaStream | null = null;
            try {
                const result = await openMicrophone(prefsRef.current);
                captured = result.stream;
                if (
                    attempt !== operation.current ||
                    !permissionRef.current('calls.speak') ||
                    !permissionRef.current('calls.join')
                ) {
                    captured.getTracks().forEach((track) => track.stop());
                    return;
                }
                captured.getAudioTracks().forEach((track) => {
                    track.enabled = false;
                });
                audio.current = captured;
                if (result.usedDefault) onInputFallback();
                await syncMedia();
            } catch (error) {
                captured?.getTracks().forEach((track) => track.stop());
                report(`Cannot open microphone: ${formatMicrophoneError(error)}`);
                return;
            } finally {
                captureBusy.current.microphone = false;
            }
        }
        setMuted(false);
    };
    const toggleCamera = async () => {
        if (
            !callChannel.current ||
            captureBusy.current.camera ||
            !permissionRef.current('calls.camera')
        )
            return;
        captureBusy.current.camera = true;
        const attempt = operation.current;
        try {
            if (video.current) {
                video.current.getTracks().forEach((t) => t.stop());
                video.current = null;
                setCamera(false);
            } else {
                const stream = await navigator.mediaDevices.getUserMedia({
                    video: { height: { ideal: Number(prefs.quality) }, frameRate: { ideal: 30 } },
                });
                if (attempt !== operation.current || !permissionRef.current('calls.camera')) {
                    stream.getTracks().forEach((t) => t.stop());
                    return;
                }
                video.current = stream;
                setCamera(true);
            }
            await syncMedia();
        } catch (e) {
            report(`Camera: ${(e as Error).message}`);
        } finally {
            captureBusy.current.camera = false;
        }
    };
    const toggleShare = async () => {
        if (
            !callChannel.current ||
            captureBusy.current.share ||
            !permissionRef.current('calls.share')
        )
            return;
        captureBusy.current.share = true;
        const attempt = operation.current;
        let captured: MediaStream | null = null;
        try {
            if (screen.current) {
                stopShare();
                await syncMedia();
                return;
            }
            const stream = (captured = await navigator.mediaDevices.getDisplayMedia({
                video: { height: { ideal: Number(prefs.quality) }, frameRate: { ideal: 30 } },
                audio: {
                    echoCancellation: false,
                    noiseSuppression: false,
                    autoGainControl: false,
                    // Chromium excludes this app's playback to avoid feeding calls back to peers.
                    restrictOwnAudio: true,
                } as MediaTrackConstraints,
            }));
            if (attempt !== operation.current || !permissionRef.current('calls.share')) {
                stream.getTracks().forEach((t) => t.stop());
                return;
            }
            const systemAudio = stream.getAudioTracks()[0];
            if (systemAudio) {
                systemAudio.onended = () => {
                    if (screen.current !== stream) return;
                    void syncMedia().catch((error) => report(`Screen audio: ${error.message}`));
                    report(
                        'Screen-share audio ended. Video sharing continues; restart sharing to capture sound again.',
                    );
                };
            } else {
                report(
                    'Sharing video without system audio. Enable Share system audio in the picker if available. Linux desktop capture does not currently provide system audio in this app.',
                );
            }
            if (!stream.getVideoTracks().some((track) => track.readyState === 'live'))
                throw new Error('Screen capture ended before sharing started.');
            screen.current = stream;
            shareId.current = crypto.randomUUID();
            peers.current.forEach((p) => {
                p.wantsStream = false;
                p.watchRevision = 0;
            });
            setSharing(true);
            stream.getVideoTracks()[0].onended = () => {
                if (screen.current !== stream) return;
                stopShare();
                void syncMedia().catch((error) => report(`Screen sharing: ${error.message}`));
            };
            await syncMedia();
        } catch (e) {
            captured?.getTracks().forEach((t) => t.stop());
            if (attempt === operation.current) {
                stopShare();
                void syncMedia().catch(() => {});
                report(
                    `Screen sharing: ${(e as Error).name || 'Error'} ${(e as Error).message || 'Capture failed'}`,
                );
            }
        } finally {
            captureBusy.current.share = false;
        }
    };
    const watch = (id: string, enabled: boolean) => {
        const peer = peers.current.get(id);
        if (!peer?.media.sharing || !peer.media.shareId) return;
        peer.watching = enabled;
        peer.watchPending = true;
        peer.requestedRevision++;
        receivedTrackGate(peer);
        updateRemote();
        const revision = peer.requestedRevision;
        clearTimeout(peer.watchTimer);
        peer.watchTimer = setTimeout(() => {
            if (!peer.watchPending || peer.requestedRevision !== revision) return;
            disposePeer(peer);
            updateRemote();
            report(
                'The peer did not confirm the stream subscription. Disconnected that media connection; update both clients and rejoin the call.',
            );
        }, 10000);
        send(id, { watch: { shareId: peer.media.shareId, enabled, revision } });
    };
    const queueWatch = (target: { socket: string; shareId: string; channel: string }) => {
        clearTimeout(pendingWatchTimer.current);
        pendingWatch.current = target;
        pendingWatchTimer.current = setTimeout(() => {
            if (!pendingWatch.current) return;
            pendingWatch.current = null;
            report(
                'Could not start watching the screen share. Open the call details to try again.',
            );
        }, 20000);
    };
    const watchStream = (channel: string, id: string, expectedShare: string) => {
        if (callChannel.current !== channel) {
            void join(channel, { socket: id, shareId: expectedShare });
            return;
        }
        setPanelOpen(true);
        const peer = peers.current.get(id);
        if (peer?.media.sharing && peer.media.shareId === expectedShare) {
            if (!peer.watching) watch(id, true);
        } else queueWatch({ socket: id, shareId: expectedShare, channel });
    };
    useEffect(() => {
        if (!channel) return;
        if (!canJoin) {
            leave();
            return;
        }
        let changed = false;
        if (!canSpeak && audio.current?.getAudioTracks().length) {
            audio.current.getTracks().forEach((track) => track.stop());
            audio.current = null;
            setMuted(true);
            changed = true;
        }
        if (!canCamera && video.current) {
            video.current.getTracks().forEach((track) => track.stop());
            video.current = null;
            setCamera(false);
            changed = true;
        }
        if (!canShare && screen.current) {
            stopShare();
            changed = true;
        }
        if (changed) void syncMedia().catch((error) => report(error.message));
    }, [canJoin, canSpeak, canCamera, canShare, channel]);
    return {
        canSpeak,
        canCamera,
        canShare,
        panelOpen,
        setPanelOpen,
        watchStream,
        watch,
        microphone: audio.current,
        showDetails,
        setShowDetails,
        details,
        channel,
        join,
        leave,
        muted,
        setMuted: setMicrophoneMuted,
        deafened,
        setDeafened,
        camera,
        sharing,
        toggleCamera,
        toggleShare,
        local,
        remote,
    };
}
