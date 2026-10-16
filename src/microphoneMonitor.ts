import type { Preferences } from './types';
import { openMicrophone } from './media.ts';

type InputPreferences = Pick<Preferences, 'input' | 'noise'>;
export type MicrophoneLevel = { percent: number; decibels: number | null; detected: boolean; clipping: boolean };
export type MicrophoneReading = MicrophoneLevel & { paused: boolean; muted: boolean; device: string };

export function microphoneLevel(samples: Float32Array): MicrophoneLevel {
    let energy = 0, peak = 0;
    for (const sample of samples) {
        const value = Number.isFinite(sample) ? sample : 0;
        energy += value * value;
        peak = Math.max(peak, Math.abs(value));
    }
    const rms = samples.length ? Math.sqrt(energy / samples.length) : 0;
    const decibels = rms > 0 ? 20 * Math.log10(rms) : null;
    return {
        percent: decibels === null ? 0 : Math.max(0, Math.min(100, (decibels + 60) / 60 * 100)),
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
    openInput?: typeof openMicrophone;
    schedule?: typeof requestAnimationFrame;
    cancel?: typeof cancelAnimationFrame;
};

export function createMicrophoneMonitor({
    preferences, activeStream, onReading, onError, onFallback,
    createContext = () => new AudioContext(), openInput = openMicrophone,
    schedule = callback => globalThis.requestAnimationFrame(callback), cancel = id => globalThis.cancelAnimationFrame(id),
}: MonitorOptions) {
    const context = createContext();
    let stopped = false, frame: number | null = null;
    let input: MediaStream | null = activeStream || null;
    let source: MediaStreamAudioSourceNode | null = null, analyser: AnalyserNode | null = null;
    const owned = !activeStream;
    const stop = () => {
        if (stopped) return;
        stopped = true;
        if (frame !== null) cancel(frame);
        source?.disconnect(); analyser?.disconnect();
        if (owned) input?.getTracks().forEach(track => track.stop());
        void context.close().catch(() => {});
    };
    const resume = async () => {
        if (stopped) return;
        await context.resume();
    };
    // A denied autoplay resume may remain pending. Still initialize the graph
    // and expose the paused state so the user can resume with a direct click.
    void resume().catch(error => { if (!stopped) { stop(); onError(error); } });
    const ready = (async () => {
        try {
            let usedDefault = false;
            if (!input) {
                const result = await openInput(preferences);
                input = result.stream;
                usedDefault = result.usedDefault;
            }
            if (stopped) {
                if (owned) input.getTracks().forEach(track => track.stop());
                return;
            }
            const track = input.getAudioTracks()[0];
            if (!track || track.readyState === 'ended') throw Object.assign(new Error(''), { name: 'NotFoundError' });
            source = context.createMediaStreamSource(input);
            analyser = context.createAnalyser();
            analyser.fftSize = 2048;
            source.connect(analyser); // Never connect to speakers: no monitoring feedback.
            const samples = new Float32Array(analyser.fftSize);
            let previous = -Infinity;
            const update = (time: number) => {
                if (stopped) return;
                if (track.readyState === 'ended') {
                    stop(); onError(new Error('The microphone disconnected. Select an input and restart the test.')); return;
                }
                if (time - previous >= 80) {
                    previous = time;
                    const paused = context.state !== 'running';
                    const muted = !track.enabled || track.muted;
                    if (paused || muted) samples.fill(0); else analyser!.getFloatTimeDomainData(samples);
                    onReading({ ...microphoneLevel(samples), paused, muted, device: track.label || 'Microphone' });
                }
                frame = schedule(update);
            };
            frame = schedule(update);
            if (usedDefault) onFallback();
        } catch (error) {
            if (!stopped) { stop(); onError(error); }
        }
    })();
    return { stop, resume, ready };
}
