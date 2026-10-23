export type ScreenAudioInfo = {
    token: string;
    selection: string;
    available: boolean;
    applications: { id: string; name: string }[];
    recommended: string;
    reason?: string;
};
export type ScreenAudioBridge = {
    info(): Promise<ScreenAudioInfo>;
    start(token: string, choice: string): Promise<{ token: string; name: string }>;
    stop(token?: string): Promise<void>;
    onEnded(callback: (token: string) => void): () => void;
};

// The exact temporary source is required. Never fall back to the user's microphone.
export async function attachScreenAudio({
    stream,
    signal,
    bridge,
    choose,
    devices = navigator.mediaDevices,
}: {
    stream: MediaStream;
    signal: AbortSignal;
    bridge: ScreenAudioBridge;
    choose: (info: ScreenAudioInfo) => Promise<string | null>;
    devices?: Pick<MediaDevices, 'enumerateDevices' | 'getUserMedia'>;
}): Promise<() => void> {
    let token: string | undefined;
    let audio: MediaStream | undefined;
    let unsubscribe: (() => void) | undefined;
    let closed = false;
    const close = () => {
        if (closed) return;
        closed = true;
        signal.removeEventListener('abort', close);
        unsubscribe?.();
        audio?.getTracks().forEach((track) => {
            track.onended = null;
            track.stop();
        });
        if (token) void bridge.stop(token).catch(() => {});
    };
    signal.addEventListener('abort', close, { once: true });
    try {
        const info = await bridge.info();
        token = info.token;
        if (signal.aborted) {
            void bridge.stop(token).catch(() => {});
            signal.throwIfAborted();
        }
        const choice = await choose(info);
        signal.throwIfAborted();
        if (choice === null) throw new DOMException('Screen sharing cancelled.', 'AbortError');
        if (choice === 'none') {
            close();
            return close;
        }
        const source = await bridge.start(token, choice);
        if (signal.aborted) {
            void bridge.stop(token).catch(() => {});
            signal.throwIfAborted();
        }
        let device: MediaDeviceInfo | undefined;
        const deadline = Date.now() + 5000;
        while (!device && Date.now() < deadline) {
            signal.throwIfAborted();
            device = (await devices.enumerateDevices()).find(
                (entry) => entry.kind === 'audioinput' && entry.label.includes(source.name),
            );
            if (!device) await new Promise((resolve) => setTimeout(resolve, 100));
        }
        if (!device)
            throw Error(
                'The selected screen-share audio source is unavailable. Try again or share without audio.',
            );
        audio = await devices.getUserMedia({
            audio: {
                deviceId: { exact: device.deviceId },
                channelCount: 2,
                sampleRate: 48000,
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false,
            },
            video: false,
        });
        signal.throwIfAborted();
        const track = audio.getAudioTracks()[0];
        if (!track || track.readyState !== 'live')
            throw Error('The screen-share audio source ended.');
        stream.addTrack(track);
        unsubscribe = bridge.onEnded((endedToken) => {
            if (endedToken !== token || closed) return;
            track.stop();
            // stop() doesn't emit ended, but useCall needs to detach the failed audio track.
            track.dispatchEvent(new Event('ended'));
            close();
        });
        return close;
    } catch (error) {
        // A capture can complete after cancellation; stop its late-arriving track too.
        audio?.getTracks().forEach((track) => track.stop());
        close();
        throw error;
    }
}
