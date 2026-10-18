// Only the showcase Vite server aliases these integrations. Production imports are untouched.
import { useMemo, useState } from 'react';
import { state } from './fixture.mjs';

const localMember = state.calls.find((member) => member.user === state.me.id);

const canvas = document.createElement('canvas');
canvas.width = 1280;
canvas.height = 720;
const screen = canvas.captureStream(0);
const frame = screen.getVideoTracks()[0];
window.__showcase = {
    mediaReady: fetch('/api/showcase/frame')
        .then((response) => response.blob())
        .then(createImageBitmap)
        .then((image) => {
            canvas.getContext('2d').drawImage(image, 0, 0);
            image.close();
            frame.requestFrame();
        }),
    requestFrame: () => frame.requestFrame(),
};

export function io() {
    const socket = {
        connected: true,
        id: localMember.socket,
        on(event, callback) {
            if (event === 'connect') queueMicrotask(callback);
            return socket;
        },
        off: () => socket,
        emit: () => socket,
        disconnect() {},
        removeAllListeners() {},
    };
    return socket;
}

export function useSpeaking() {
    return useMemo(
        () => new Set(state.calls.filter((member) => member.shareId).map((member) => member.user)),
        [],
    );
}

export function useCall() {
    const [channel, setChannel] = useState(localMember.channel);
    const [panelOpen, setPanelOpen] = useState(true);
    const [showDetails, setShowDetails] = useState(false);
    const [muted, setMuted] = useState(false);
    const [deafened, setDeafened] = useState(false);
    const [remote, setRemote] = useState(() =>
        state.calls
            .filter((member) => member.socket !== localMember.socket)
            .map((member) => ({
                id: member.socket,
                user: member.user,
                stream: member.shareId || member.camera ? screen : new MediaStream(),
                streamAudio: null,
                sharing: !!member.shareId,
                camera: !!member.camera,
                watching: !!member.shareId,
                watchPending: false,
            })),
    );
    const watch = (id, watching) =>
        setRemote((peers) => peers.map((peer) => (peer.id === id ? { ...peer, watching } : peer)));
    return {
        channel,
        panelOpen,
        setPanelOpen,
        showDetails,
        setShowDetails,
        muted,
        setMuted,
        deafened,
        setDeafened,
        camera: false,
        sharing: false,
        canSpeak: true,
        canCamera: false,
        canShare: false,
        microphone: null,
        local: null,
        remote,
        details: [],
        join: async (id) => setChannel(id),
        leave: () => setChannel(null),
        watch,
        watchStream: (_channel, id) => {
            setPanelOpen(true);
            watch(id, true);
        },
        toggleCamera: async () => {},
        toggleShare: async () => {},
    };
}
