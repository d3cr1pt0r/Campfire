import { useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import type { CallMember, Preferences } from './types';
import { openMicrophone, formatMicrophoneError } from './media';
import { createPeerSignaling, type PeerSignal } from './signaling';
import { createShareAudio } from './shareAudio';
type Peer = {
    pc: RTCPeerConnection;
    stream: MediaStream;
    user: string;
    signaling: ReturnType<typeof createPeerSignaling>;
    videoSender?: RTCRtpSender;
};
export function useCall(socket: Socket | null, prefs: Preferences, iceServers: RTCIceServer[], report: (s: string) => void, onInputFallback: () => void) {
    const [channel, setChannel] = useState<string | null>(null);
    const [muted, setMuted] = useState(false), [deafened, setDeafened] = useState(false), [camera, setCamera] = useState(false), [sharing, setSharing] = useState(false);
    const [local, setLocal] = useState<MediaStream | null>(null), [remote, setRemote] = useState<{
        id: string;
        user: string;
        stream: MediaStream;
    }[]>([]);
    const [showDetails, setShowDetails] = useState(false);
    const [details, setDetails] = useState<{id: string; user: string; connection: string; ice: string; direction: string; sent: number | null; received: number | null; inputLevel: number | null; receivedLevel: number | null}[]>([]);
    const operation = useRef(0);
    const shareAudio = useRef<ReturnType<typeof createShareAudio> | null>(null);
    const captureBusy = useRef({ camera: false, share: false });
    const audioFlags = useRef({ muted, deafened });
    audioFlags.current = { muted, deafened };
    const peers = useRef(new Map<string, Peer>()), audio = useRef<MediaStream | null>(null), video = useRef<MediaStream | null>(null), screen = useRef<MediaStream | null>(null), callChannel = useRef<string | null>(null), pressed = useRef(false);
    const prefsRef = useRef(prefs);
    prefsRef.current = prefs;
    const iceRef = useRef(iceServers);
    iceRef.current = iceServers;
    const sound = () => {
        if (!prefsRef.current.sounds)
            return;
        try {
            const c = new AudioContext();
            const o = c.createOscillator(), g = c.createGain();
            o.connect(g);
            g.connect(c.destination);
            g.gain.setValueAtTime(.06, c.currentTime);
            g.gain.exponentialRampToValueAtTime(.001, c.currentTime + .18);
            o.frequency.value = 660;
            o.start();
            o.stop(c.currentTime + .2);
            o.onended = () => void c.close();
        }
        catch { /* optional sound */ }
    };
    const updateRemote = () => setRemote([...peers.current].map(([id, p]) => ({ id, user: p.user, stream: p.stream })));
    const leave = () => { const wasInCall = !!callChannel.current; operation.current++; socket?.emit('call:leave'); callChannel.current = null; setChannel(null); peers.current.forEach(p => { p.signaling.close(); p.pc.onconnectionstatechange = null; p.pc.close(); }); peers.current.clear(); shareAudio.current?.close(); shareAudio.current = null; [audio.current, video.current, screen.current].forEach(s => s?.getTracks().forEach(t => t.stop())); audio.current = null; video.current = null; screen.current = null; setLocal(null); setRemote([]); setCamera(false); setSharing(false); if (wasInCall)
        sound(); };
    const currentVideo = () => screen.current?.getVideoTracks()[0] || video.current?.getVideoTracks()[0] || null;
    const currentAudio = () => shareAudio.current?.track || audio.current?.getAudioTracks()[0] || null;
    const syncAudio = () => Promise.all([...peers.current.values()].map(p =>
        p.pc.getTransceivers().find(t => t.receiver.track.kind === 'audio')?.sender.replaceTrack(currentAudio())));
    const stopShare = () => {
        const capture = screen.current;
        screen.current = null;
        shareAudio.current?.setScreen(null);
        capture?.getTracks().forEach(track => { track.onended = null; track.stop(); });
        setSharing(false);
    };
    const syncVideo = async () => { const track = currentVideo(); setLocal(track ? new MediaStream([track]) : null); await Promise.all([...peers.current.values()].map(async (p) => { const sender = p.videoSender; await sender?.replaceTrack(track); })); };
    const makePeer = (id: string, user: string, initialOfferer = false) => {
        const existing = peers.current.get(id);
        if (existing) return existing;
        const pc = new RTCPeerConnection({ iceServers: iceRef.current });
        let p: Peer;
        let preparing = false;
        const prepareTracks = async () => {
            preparing = true;
            try {
                for (const kind of ['audio', 'video'] as const) {
                    const transceiver = pc.getTransceivers().find(t => t.receiver.track.kind === kind)
                        || pc.addTransceiver(kind, { direction: 'sendrecv' });
                    transceiver.direction = 'sendrecv';
                    const track = kind === 'audio' ? currentAudio() : currentVideo();
                    await transceiver.sender.replaceTrack(track);
                    if (kind === 'video') p.videoSender = transceiver.sender;
                }
            } finally { preparing = false; }
        };
        const signaling = createPeerSignaling(pc, String(socket?.id) > id,
            data => socket?.emit('signal', { to: id, data }), prepareTracks, initialOfferer);
        p = { pc, user, stream: new MediaStream(), signaling };
        peers.current.set(id, p);
        pc.onicecandidate = event => {
            if (event.candidate) socket?.emit('signal', { to: id, data: { candidate: event.candidate.toJSON() } });
        };
        pc.ontrack = event => {
            if (!p.stream.getTracks().some(track => track.id === event.track.id)) p.stream.addTrack(event.track);
            updateRemote();
        };
        pc.onnegotiationneeded = () => {
            if (!preparing) void signaling.negotiate().catch(error => {
                if (pc.signalingState !== 'closed') report(`Call negotiation: ${error.name || 'Error'} ${error.message || ''}`);
            });
        };
        pc.onconnectionstatechange = () => {
            if (pc.connectionState === 'failed') report('A peer connection failed. Check Call details; a TURN relay may be needed if direct connectivity is blocked.');
        };
        if (initialOfferer) void prepareTracks().then(() => signaling.negotiate()).catch(error => {
            if (pc.signalingState !== 'closed') report(`Call setup: ${error.name || 'Error'} ${error.message || ''}`);
        });
        return p;
    };
    useEffect(() => {
        if (!socket)
            return;
        const signal = async ({ from, user, data }: { from: string; user: string; data: PeerSignal }) => {
            if (!callChannel.current) return;
            const peer = makePeer(from, user);
            try { await peer.signaling.receive(data); }
            catch (error) {
                if (peer.pc.signalingState !== 'closed') report(`Media connection: ${(error as Error).name || 'Error'} ${(error as Error).message || 'Signaling failed'}`);
            }
        };
        const calls = (members: CallMember[]) => {
            const ids = new Set(members.filter(c => c.channel === callChannel.current).map(c => c.socket));
            let changed = false;
            peers.current.forEach((p, id) => {
                if (!ids.has(id)) {
                    p.signaling.close();
                    p.pc.close();
                    peers.current.delete(id);
                    changed = true;
                }
            });
            if (changed) {
                sound();
                updateRemote();
            }
        };
        const revoked = () => { leave(); report('Your role no longer has permission to join calls.'); };
        const disconnect = () => leave();
        socket.on('call:revoked', revoked);
        socket.on('signal', signal);
        socket.on('calls', calls);
        socket.on('disconnect', disconnect);
        return () => { socket.off('call:revoked', revoked); socket.off('signal', signal); socket.off('calls', calls); socket.off('disconnect', disconnect); leave(); };
        // Socket lifetime owns all media resources.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [socket]);
    useEffect(() => {
        const enable = () => audio.current?.getAudioTracks().forEach(t => t.enabled = !muted && !deafened && (!prefs.pushToTalk || pressed.current));
        enable();
        const down = (e: KeyboardEvent) => {
            if (!prefs.pushToTalk || !callChannel.current || e.code !== 'Space' || (e.target as HTMLElement)?.closest('input,textarea,select,[contenteditable]'))
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
        const blur = () => { pressed.current = false; enable(); };
        window.addEventListener('keydown', down);
        window.addEventListener('keyup', up);
        window.addEventListener('blur', blur);
        return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', blur); };
    }, [muted, deafened, prefs.pushToTalk, channel]);
    useEffect(() => {
        if (!channel || !showDetails) { setDetails([]); return; }
        let canceled = false, pending = false;
        const sample = async () => {
            if (pending) return;
            pending = true;
            try {
                const rows = await Promise.all([...peers.current].map(async ([id, peer]) => {
                    let sent: number | null = null, received: number | null = null, inputLevel: number | null = null, receivedLevel: number | null = null;
                    try {
                        const stats = await peer.pc.getStats();
                        stats.forEach(stat => {
                            if ((stat.kind || stat.mediaType) !== 'audio') return;
                            if (stat.type === 'outbound-rtp') sent = (sent || 0) + (stat.packetsSent || 0);
                            if (stat.type === 'inbound-rtp') { received = (received || 0) + (stat.packetsReceived || 0); if (typeof stat.audioLevel === 'number') receivedLevel = stat.audioLevel; }
                            if (stat.type === 'media-source' && typeof stat.audioLevel === 'number') inputLevel = stat.audioLevel;
                        });
                    } catch { /* Peer may close during a sample. */ }
                    return { id, user: peer.user, connection: peer.pc.connectionState, ice: peer.pc.iceConnectionState,
                        direction: peer.pc.getTransceivers().find(t => t.receiver.track.kind === 'audio')?.currentDirection || 'not negotiated', sent, received, inputLevel, receivedLevel };
                }));
                if (!canceled) setDetails(rows);
            } finally { pending = false; }
        };
        void sample();
        const timer = setInterval(() => void sample(), 1000);
        return () => { canceled = true; clearInterval(timer); };
    }, [channel, showDetails]);
    const join = async (id: string) => {
        if (!socket?.connected) {
            report('Connect to the server before joining a call.');
            return;
        }
        leave();
        const attempt = operation.current;
        try {
            const { stream, usedDefault } = await openMicrophone(prefs);
            if (attempt !== operation.current) {
                stream.getTracks().forEach(t => t.stop());
                return;
            }
            if (usedDefault) {
                onInputFallback();
                report('The saved microphone is unavailable. Switched to System default; you can choose another input in Settings → Voice & video.');
            }
            audio.current = stream;
            callChannel.current = id;
            socket.timeout(10000).emit('call:join', id, (error: Error | null, result: {
                error?: string;
                peers: CallMember[];
            }) => {
                if (attempt !== operation.current)
                    return;
                if (error || result?.error) {
                    leave();
                    report(result?.error || 'The server did not answer the call request');
                    return;
                }
                setChannel(id);
                audio.current?.getTracks().forEach(t => t.enabled = !audioFlags.current.muted && !audioFlags.current.deafened && !prefsRef.current.pushToTalk);
                result.peers.forEach(p => makePeer(p.socket, p.user, true));
                sound();
            });
        }
        catch (e) {
            if (attempt !== operation.current)
                return;
            leave();
            report(`Cannot open microphone: ${formatMicrophoneError(e)}`);
        }
    };
    const toggleCamera = async () => {
        if (!callChannel.current || captureBusy.current.camera)
            return;
        captureBusy.current.camera = true;
        const attempt = operation.current;
        try {
            if (video.current) {
                video.current.getTracks().forEach(t => t.stop());
                video.current = null;
                setCamera(false);
            }
            else {
                const stream = await navigator.mediaDevices.getUserMedia({ video: { height: { ideal: Number(prefs.quality) }, frameRate: { ideal: 30 } } });
                if (attempt !== operation.current) {
                    stream.getTracks().forEach(t => t.stop());
                    return;
                }
                video.current = stream;
                setCamera(true);
            }
            await syncVideo();
        }
        catch (e) {
            report(`Camera: ${(e as Error).message}`);
        }
        finally {
            captureBusy.current.camera = false;
        }
    };
    const toggleShare = async () => {
        if (!callChannel.current || captureBusy.current.share)
            return;
        captureBusy.current.share = true;
        const attempt = operation.current;
        let captured: MediaStream | null = null;
        try {
            if (screen.current) {
                stopShare();
                await syncVideo();
                return;
            }
            const stream = captured = await navigator.mediaDevices.getDisplayMedia({
                video: { height: { ideal: Number(prefs.quality) }, frameRate: { ideal: 30 } },
                audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false,
                    // Chromium excludes this app's playback to avoid feeding calls back to peers.
                    restrictOwnAudio: true } as MediaTrackConstraints,
            });
            if (attempt !== operation.current) {
                stream.getTracks().forEach(t => t.stop());
                return;
            }
            const systemAudio = stream.getAudioTracks()[0];
            if (systemAudio) {
                const mixer = shareAudio.current || createShareAudio(audio.current!);
                try { await mixer.resume(); }
                catch (error) { if (shareAudio.current !== mixer) mixer.close(); throw error; }
                if (attempt !== operation.current) { mixer.close(); stream.getTracks().forEach(t => t.stop()); return; }
                shareAudio.current = mixer;
                await syncAudio();
                if (attempt !== operation.current) { stream.getTracks().forEach(t => t.stop()); return; }
                mixer.setScreen(stream);
                systemAudio.onended = () => {
                    if (screen.current !== stream) return;
                    mixer.setScreen(null);
                    report('Screen-share audio ended. Video sharing continues; restart sharing to capture sound again.');
                };
            } else {
                report('Sharing video without system audio. Enable Share system audio in the picker if available. Linux desktop capture does not currently provide system audio in this app.');
            }
            if (!stream.getVideoTracks().some(track => track.readyState === 'live')) throw new Error('Screen capture ended before sharing started.');
            screen.current = stream;
            setSharing(true);
            stream.getVideoTracks()[0].onended = () => {
                if (screen.current !== stream) return;
                stopShare();
                void syncVideo().catch(error => report(`Screen sharing: ${error.message}`));
            };
            await syncVideo();
        }
        catch (e) {
            captured?.getTracks().forEach(t => t.stop());
            if (attempt === operation.current) {
                stopShare();
                void syncVideo().catch(() => {});
                report(`Screen sharing: ${(e as Error).name || 'Error'} ${(e as Error).message || 'Capture failed'}`);
            }
        }
        finally {
            captureBusy.current.share = false;
        }
    };
    return { microphone: audio.current, showDetails, setShowDetails, details, channel, join, leave, muted, setMuted, deafened, setDeafened, camera, sharing, toggleCamera, toggleShare, local, remote };
}
