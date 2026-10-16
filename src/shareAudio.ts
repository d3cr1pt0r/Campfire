// Mix locally into the existing Opus sender so receivers keep one audio track.
// Input streams remain owned by the call; only the generated track is ours.
export function createShareAudio(microphone: MediaStream, context = new AudioContext()) {
    const destination = context.createMediaStreamDestination();
    // Match the existing microphone sender's mono format for replaceTrack.
    destination.channelCount = 1;
    const mic = context.createMediaStreamSource(microphone);
    mic.connect(destination);
    let screen: MediaStreamAudioSourceNode | null = null;
    let closed = false;
    return {
        track: destination.stream.getAudioTracks()[0],
        async resume() {
            await context.resume();
            if (closed || context.state !== 'running') throw new Error('System audio mixer is paused. Stop sharing and try again.');
        },
        setScreen(stream: MediaStream | null) {
            screen?.disconnect();
            screen = null;
            if (!closed && stream?.getAudioTracks().some(track => track.readyState === 'live')) {
                screen = context.createMediaStreamSource(stream);
                screen.connect(destination);
            }
        },
        close() {
            if (closed) return;
            closed = true;
            screen?.disconnect();
            mic.disconnect();
            destination.stream.getTracks().forEach(track => track.stop());
            void context.close().catch(() => {});
        },
    };
}
