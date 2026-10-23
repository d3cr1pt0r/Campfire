import { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useScreenShareAudio } from '../src/ScreenShareAudio';
import '../src/style.css';
import '../src/campfire-theme.css';

const peers: RTCPeerConnection[] = [];
let outgoing: MediaStream | null = null;
let incoming: MediaStream | null = null;
let analyser: AnalyserNode | null = null;
let audioState: AudioContext | null = null;
const completeIce = (peer: RTCPeerConnection) =>
    new Promise<void>((resolve) => {
        if (peer.iceGatheringState === 'complete') return resolve();
        peer.addEventListener('icegatheringstatechange', () => {
            if (peer.iceGatheringState === 'complete') resolve();
        });
    });

Object.assign(window, {
    screenAudioTest: {
        peers,
        offer: async () => {
            const peer = new RTCPeerConnection();
            peers.push(peer);
            for (const track of outgoing!.getTracks()) peer.addTrack(track, outgoing!);
            await peer.setLocalDescription(await peer.createOffer());
            await completeIce(peer);
            return peer.localDescription!.toJSON();
        },
        answer: async (offer: RTCSessionDescriptionInit) => {
            const peer = new RTCPeerConnection();
            peers.push(peer);
            incoming = new MediaStream();
            peer.ontrack = ({ track }) => {
                incoming!.addTrack(track);
                if (track.kind === 'audio') {
                    const element = document.createElement('audio');
                    element.autoplay = true;
                    element.muted = true;
                    element.srcObject = incoming;
                    document.body.append(element);
                    void element.play();
                    const audio = new AudioContext();
                    audioState = audio;
                    void audio.resume();
                    analyser = audio.createAnalyser();
                    analyser.fftSize = 2048;
                    const silent = audio.createGain();
                    silent.gain.value = 0.0001;
                    audio
                        .createMediaStreamSource(incoming!)
                        .connect(analyser)
                        .connect(silent)
                        .connect(audio.destination);
                }
            };
            await peer.setRemoteDescription(offer);
            await peer.setLocalDescription(await peer.createAnswer());
            await completeIce(peer);
            return peer.localDescription!.toJSON();
        },
        connect: (answer: RTCSessionDescriptionInit) => peers[0].setRemoteDescription(answer),
        rms: () => {
            if (!analyser) return 0;
            const data = new Float32Array(analyser.fftSize);
            analyser.getFloatTimeDomainData(data);
            return Math.sqrt(data.reduce((total, value) => total + value * value, 0) / data.length);
        },
        diagnostic: async () => ({
            audioState: audioState?.state,
            tracks: incoming?.getTracks().map((track) => ({
                kind: track.kind,
                enabled: track.enabled,
                muted: track.muted,
                state: track.readyState,
            })),
            peers: peers.map((peer) => ({
                state: peer.connectionState,
                ice: peer.iceConnectionState,
            })),
            stats: [...(await peers.at(-1)!.getStats()).values()].filter(
                (entry) => entry.type === 'inbound-rtp' || entry.type === 'media-source',
            ),
        }),
        stats: async () =>
            [...(await peers.at(-1)!.getStats()).values()]
                .filter((entry) => entry.type === 'inbound-rtp')
                .map((entry) => ({ kind: entry.kind, bytes: entry.bytesReceived })),
        tracks: () =>
            outgoing?.getTracks().map((track) => ({
                kind: track.kind,
                state: track.readyState,
                label: track.label,
            })),
    },
});

function Fixture() {
    const audio = useScreenShareAudio();
    const [status, setStatus] = useState('Ready');
    const cleanup = useRef<(() => void) | null>(null);
    const controller = useRef<AbortController | null>(null);
    const start = async () => {
        controller.current = new AbortController();
        const canvas = document.createElement('canvas');
        canvas.width = 320;
        canvas.height = 180;
        const context = canvas.getContext('2d')!;
        context.fillStyle = '#efb66f';
        context.fillRect(0, 0, 320, 180);
        outgoing = canvas.captureStream(5);
        setStatus('Choosing audio');
        try {
            cleanup.current = await audio.attach(outgoing, controller.current.signal);
            setStatus('Sharing');
        } catch (error) {
            outgoing.getTracks().forEach((track) => track.stop());
            setStatus(
                (error as Error).name === 'AbortError' ? 'Cancelled' : (error as Error).message,
            );
        }
    };
    return (
        <main style={{ padding: 32 }}>
            <h1>Screen sharing</h1>
            <p role="status" id="capture-status">
                {status}
            </p>
            <button className="primary" onClick={() => void start()}>
                Choose audio
            </button>
            <button
                onClick={() => {
                    controller.current?.abort();
                    cleanup.current?.();
                    outgoing?.getTracks().forEach((track) => track.stop());
                    peers.forEach((peer) => peer.close());
                    setStatus('Stopped');
                }}
            >
                Stop
            </button>
            {audio.dialog}
        </main>
    );
}
createRoot(document.getElementById('root')!).render(<Fixture />);
