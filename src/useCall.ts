import { useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import type { CallMember, Preferences } from './types';
import { openMicrophone, formatMicrophoneError } from './media';
type Peer = {
    pc: RTCPeerConnection;
    stream: MediaStream;
    user: string;
    makingOffer: boolean;
    ignoreOffer: boolean;
    candidates: RTCIceCandidateInit[];
};
export function useCall(socket: Socket | null, prefs: Preferences, iceServers: RTCIceServer[], report: (s: string) => void, onInputFallback: () => void) {
    const [channel, setChannel] = useState<string | null>(null);
    const [muted, setMuted] = useState(false), [deafened, setDeafened] = useState(false), [camera, setCamera] = useState(false), [sharing, setSharing] = useState(false);
    const [local, setLocal] = useState<MediaStream | null>(null), [remote, setRemote] = useState<{
        id: string;
        user: string;
        stream: MediaStream;
    }[]>([]);
    const operation = useRef(0);
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
    const leave = () => { const wasInCall = !!callChannel.current; operation.current++; socket?.emit('call:leave'); callChannel.current = null; setChannel(null); peers.current.forEach(p => { p.pc.onconnectionstatechange = null; p.pc.close(); }); peers.current.clear(); [audio.current, video.current, screen.current].forEach(s => s?.getTracks().forEach(t => t.stop())); audio.current = null; video.current = null; screen.current = null; setLocal(null); setRemote([]); setCamera(false); setSharing(false); if (wasInCall)
        sound(); };
    const currentVideo = () => screen.current?.getVideoTracks()[0] || video.current?.getVideoTracks()[0] || null;
    const syncVideo = async () => { const track = currentVideo(); setLocal(track ? new MediaStream([track]) : null); await Promise.all([...peers.current.values()].map(async (p) => { const sender = p.pc.getTransceivers().find(t => t.receiver.track.kind === 'video')?.sender; await sender?.replaceTrack(track); })); };
    const makePeer = (id: string, user: string) => {
        const existing = peers.current.get(id);
        if (existing)
            return existing;
        const pc = new RTCPeerConnection({ iceServers: iceRef.current });
        const p: Peer = { pc, user, stream: new MediaStream(), makingOffer: false, ignoreOffer: false, candidates: [] };
        peers.current.set(id, p);
        pc.onicecandidate = e => {
            if (e.candidate)
                socket?.emit('signal', { to: id, data: { candidate: e.candidate.toJSON() } });
        };
        pc.ontrack = e => {
            if (!p.stream.getTracks().some(t => t.id === e.track.id))
                p.stream.addTrack(e.track);
            updateRemote();
        };
        pc.onnegotiationneeded = async () => {
            try {
                p.makingOffer = true;
                await pc.setLocalDescription();
                socket?.emit('signal', { to: id, data: { description: pc.localDescription } });
            }
            catch (e) {
                report(`Call negotiation: ${(e as Error).message}`);
            }
            finally {
                p.makingOffer = false;
            }
        };
        pc.onconnectionstatechange = () => {
            if (pc.connectionState === 'failed')
                report('A peer connection failed. Configure a TURN server for networks that block direct calls.');
        };
        const track = audio.current?.getAudioTracks()[0];
        if (track)
            pc.addTrack(track, audio.current!);
        const transceiver = pc.addTransceiver('video', { direction: 'sendrecv' });
        void transceiver.sender.replaceTrack(currentVideo());
        return p;
    };
    useEffect(() => {
        if (!socket)
            return;
        const signal = async ({ from, user, data }: {
            from: string;
            user: string;
            data: {
                description?: RTCSessionDescriptionInit;
                candidate?: RTCIceCandidateInit;
            };
        }) => {
            if (!callChannel.current)
                return;
            const p = makePeer(from, user), pc = p.pc;
            try {
                if (data.description) {
                    const collision = data.description.type === 'offer' && (p.makingOffer || pc.signalingState !== 'stable');
                    p.ignoreOffer = String(socket.id) < from && collision;
                    if (p.ignoreOffer)
                        return;
                    await pc.setRemoteDescription(data.description);
                    for (const c of p.candidates)
                        await pc.addIceCandidate(c);
                    p.candidates = [];
                    if (data.description.type === 'offer') {
                        await pc.setLocalDescription();
                        socket.emit('signal', { to: from, data: { description: pc.localDescription } });
                    }
                }
                else if (data.candidate && !p.ignoreOffer) {
                    if (pc.remoteDescription)
                        await pc.addIceCandidate(data.candidate);
                    else
                        p.candidates.push(data.candidate);
                }
            }
            catch (e) {
                report(`Media connection: ${(e as Error).message}`);
            }
        };
        const calls = (members: CallMember[]) => {
            const ids = new Set(members.filter(c => c.channel === callChannel.current).map(c => c.socket));
            let changed = false;
            peers.current.forEach((p, id) => {
                if (!ids.has(id)) {
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
                result.peers.forEach(p => makePeer(p.socket, p.user));
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
        try {
            if (screen.current) {
                screen.current.getTracks().forEach(t => t.stop());
                screen.current = null;
                setSharing(false);
                await syncVideo();
                return;
            }
            const stream = await navigator.mediaDevices.getDisplayMedia({ video: { height: { ideal: Number(prefs.quality) }, frameRate: { ideal: 30 } }, audio: false });
            if (attempt !== operation.current) {
                stream.getTracks().forEach(t => t.stop());
                return;
            }
            screen.current = stream;
            setSharing(true);
            screen.current.getVideoTracks()[0].onended = () => { screen.current = null; setSharing(false); void syncVideo(); };
            await syncVideo();
        }
        catch (e) {
            report(`Screen sharing: ${(e as Error).message}`);
        }
        finally {
            captureBusy.current.share = false;
        }
    };
    return { channel, join, leave, muted, setMuted, deafened, setDeafened, camera, sharing, toggleCamera, toggleShare, local, remote };
}
