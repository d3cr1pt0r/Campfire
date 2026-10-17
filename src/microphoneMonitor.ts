import type { Preferences } from './types';
import { openMicrophone } from './media.ts';

type InputPreferences = Pick<Preferences, 'input' | 'inputLabel' | 'noise'>;
export type MicrophoneLevel = {
    percent: number;
    decibels: number | null;
    detected: boolean;
    clipping: boolean;
};
export type MicrophoneReading = MicrophoneLevel & {
    paused: boolean;
    muted: boolean;
    device: string;
};

export function microphoneLevel(samples: Float32Array): MicrophoneLevel {
    let energy = 0,
        peak = 0;
    for (const sample of samples) {
        const value = Number.isFinite(sample) ? sample : 0;
        energy += value * value;
        peak = Math.max(peak, Math.abs(value));
    }
    const rms = samples.length ? Math.sqrt(energy / samples.length) : 0;
    const decibels = rms > 0 ? 20 * Math.log10(rms) : null;
    return {
        percent: decibels === null ? 0 : Math.max(0, Math.min(100, ((decibels + 60) / 60) * 100)),
        decibels,
        detected: rms >= 0.003,
        clipping: peak >= 0.98,
    };
}

type MonitorOptions = {
    preferences: InputPreferences;
    activeStream?: MediaStream | null;
    onReading: (reading: MicrophoneReading) => void;
    onError: (error: unknown) => void;
    onFallback: () => void;
    createContext?: () => AudioContext;
    context?: AudioContext;
    openInput?: typeof openMicrophone;
    schedule?: typeof requestAnimationFrame;
    cancel?: typeof cancelAnimationFrame;
};

export function createMicrophoneMonitor({
    preferences,
    activeStream,
    onReading,
    onError,
    onFallback,
    createContext = () => new AudioContext(),
    openInput = openMicrophone,
    context: sharedContext,
    schedule = (callback) => globalThis.requestAnimationFrame(callback),
    cancel = (id) => globalThis.cancelAnimationFrame(id),
}: MonitorOptions) {
    const context = sharedContext || createContext();
    let stopped = false,
        frame: number | null = null;
    let input: MediaStream | null = activeStream || null;
    let source: MediaStreamAudioSourceNode | null = null,
        splitter: ChannelSplitterNode | null = null;
    const analysers: AnalyserNode[] = [];
    const owned = !activeStream;
    const stop = () => {
        if (stopped) return;
        stopped = true;
        if (frame !== null) cancel(frame);
        source?.disconnect();
        splitter?.disconnect();
        analysers.forEach((analyser) => analyser.disconnect());
        if (owned) input?.getTracks().forEach((track) => track.stop());
        if (!sharedContext) void context.close().catch(() => {});
    };
    const resume = async () => {
        if (stopped) return;
        await context.resume();
    };
    // A denied autoplay resume may remain pending. Still initialize the graph
    // and expose the paused state so the user can resume with a direct click.
    void resume().catch((error) => {
        if (!stopped) {
            stop();
            onError(error);
        }
    });
    const ready = (async () => {
        try {
            let usedDefault = false;
            if (!input) {
                const result = await openInput(preferences);
                input = result.stream;
                usedDefault = result.usedDefault;
            }
            if (stopped) {
                if (owned) input.getTracks().forEach((track) => track.stop());
                return;
            }
            const track = input.getAudioTracks()[0];
            if (!track || track.readyState === 'ended')
                throw Object.assign(new Error(''), { name: 'NotFoundError' });
            source = context.createMediaStreamSource(input);
            // AnalyserNode downmixes its input to mono. Opposite-polarity stereo
            // channels can cancel, so measure each channel before that downmix.
            const channels = Math.max(1, Math.min(8, track.getSettings?.().channelCount || 2));
            if (channels > 1) {
                splitter = context.createChannelSplitter(channels);
                source.connect(splitter);
            }
            for (let channel = 0; channel < channels; channel++) {
                const analyser = context.createAnalyser();
                analyser.fftSize = 2048;
                analysers.push(analyser);
                if (splitter) splitter.connect(analyser, channel);
                else source.connect(analyser);
            }
            // Analyser outputs may remain unconnected; never play mic audio.
            const samples = new Float32Array(2048);
            const silence = microphoneLevel(new Float32Array(0));
            let previous = -Infinity;
            const update = (time: number) => {
                if (stopped) return;
                if (track.readyState === 'ended') {
                    stop();
                    onError(
                        new Error(
                            'The microphone disconnected. Select an input and restart the test.',
                        ),
                    );
                    return;
                }
                if (time - previous >= 80) {
                    previous = time;
                    const paused = context.state !== 'running';
                    const muted = !track.enabled || track.muted;
                    let level = { ...silence };
                    let clipping = false;
                    if (!paused && !muted)
                        for (const analyser of analysers) {
                            analyser.getFloatTimeDomainData(samples);
                            const measured = microphoneLevel(samples);
                            if ((measured.decibels ?? -Infinity) > (level.decibels ?? -Infinity))
                                level = measured;
                            clipping ||= measured.clipping;
                        }
                    level.clipping = clipping;
                    onReading({ ...level, paused, muted, device: track.label || 'Microphone' });
                }
                frame = schedule(update);
            };
            frame = schedule(update);
            if (usedDefault) onFallback();
        } catch (error) {
            if (!stopped) {
                stop();
                onError(error);
            }
        }
    })();
    return { stop, resume, ready };
}
