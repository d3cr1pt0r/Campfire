import { openMicrophone, microphoneConstraints } from './media';
import voiceGateUrl from './voiceGate.worklet.js?url&no-inline';
import { audioLevel, voiceGateSettings } from './audioPreferences';
import type { Preferences } from './types';
import type { createRnnoise } from './rnnoise';

export async function openProcessedMicrophone(preferences: Preferences) {
    // Resume during the initiating gesture, before requesting capture.
    const context = new AudioContext({ sampleRate: 48000 });
    const resumed = context.resume();
    const openDenoiser = async () => (await import('./rnnoise')).createRnnoise(context);
    let raw: MediaStream | undefined;
    let source: MediaStreamAudioSourceNode | undefined;
    let gain: GainNode | undefined;
    let gate: AudioWorkletNode | undefined;
    let denoiser: Awaited<ReturnType<typeof createRnnoise>> | undefined;
    let destination: MediaStreamAudioDestinationNode | undefined;
    let monitor: MediaStreamAudioDestinationNode | undefined;
    let stopped = false;
    const resume = () => {
        void context.resume().catch(() => {});
    };
    const stop = () => {
        if (stopped) return;
        stopped = true;
        window.removeEventListener('pointerdown', resume);
        raw?.getTracks().forEach((track) => track.stop());
        destination?.stream.getTracks().forEach((track) => track.stop());
        monitor?.stream.getTracks().forEach((track) => track.stop());
        source?.disconnect();
        denoiser?.destroy();
        denoiser?.disconnect();
        gain?.disconnect();
        gate?.disconnect();
        if (gate) gate.port.close();
        void context.close().catch(() => {});
    };
    const usesRnnoise = (prefs: Preferences) =>
        prefs.noise && prefs.noiseSuppressionEngine !== 'chromium';
    const signatureFor = (prefs: Preferences) =>
        JSON.stringify([microphoneConstraints(prefs), usesRnnoise(prefs)]);
    let constraints = signatureFor(preferences);
    const connectSource = () => {
        if (denoiser) {
            source!.connect(denoiser).connect(gain!);
            denoiser.connect(gate!, 1, 1);
        } else source!.connect(gain!);
    };
    let queue = Promise.resolve();
    const update = (next: Preferences) => {
        if (stopped) return Promise.resolve();
        gain!.gain.setTargetAtTime(
            audioLevel(next.microphoneVolume, 1, 2),
            context.currentTime,
            0.01,
        );
        gate!.port.postMessage(voiceGateSettings(next));
        const signature = signatureFor(next);
        if (signature === constraints) return queue;
        constraints = signature;
        queue = queue
            .catch(() => {})
            .then(async () => {
                if (stopped) return;
                const nextDenoiser = usesRnnoise(next) ? await openDenoiser() : undefined;
                if (stopped) {
                    nextDenoiser?.destroy();
                    nextDenoiser?.disconnect();
                    return;
                }
                denoiser?.destroy();
                denoiser?.disconnect();
                denoiser = nextDenoiser;
                if (denoiser) denoiser.onprocessorerror = stop;
                // Chromium can reuse a running capture source with its old processing.
                // Release it before reopening; the destination track stays attached to peers.
                raw!.getAudioTracks()[0].removeEventListener('ended', stop);
                raw!.getTracks().forEach((track) => track.stop());
                source!.disconnect();
                const replacement = await openMicrophone({
                    ...next,
                    input: preferences.input,
                    inputLabel: preferences.inputLabel,
                });
                if (stopped) {
                    replacement.stream.getTracks().forEach((track) => track.stop());
                    return;
                }
                raw = replacement.stream;
                source = context.createMediaStreamSource(raw);
                connectSource();
                raw.getAudioTracks()[0].addEventListener('ended', stop, { once: true });
            })
            .catch((error) => {
                constraints = '';
                // End the output too, so unmuting can reacquire a failed input.
                stop();
                throw error;
            });
        return queue;
    };
    try {
        // Attach rejection handling immediately while permission is pending.
        const ready = Promise.all([resumed, context.audioWorklet.addModule(voiceGateUrl)]);
        void ready.catch(() => {});
        const result = await openMicrophone(preferences);
        raw = result.stream;
        await ready;
        source = context.createMediaStreamSource(raw);
        if (usesRnnoise(preferences)) {
            denoiser = await openDenoiser();
            denoiser.onprocessorerror = stop;
        }
        gain = context.createGain();
        gain.gain.value = audioLevel(preferences.microphoneVolume, 1, 2);
        gate = new AudioWorkletNode(context, 'campfire-voice-gate', { numberOfInputs: 2 });
        destination = context.createMediaStreamDestination();
        connectSource();
        gain.connect(gate).connect(destination);
        monitor = context.createMediaStreamDestination();
        gain.connect(monitor);
        raw.getAudioTracks()[0].addEventListener('ended', stop, { once: true });
        window.addEventListener('pointerdown', resume);
        await update(preferences);
        return {
            stream: destination.stream,
            monitorStream: monitor.stream,
            usedDefault: result.usedDefault,
            stop,
            update,
        };
    } catch (error) {
        stop();
        throw error;
    }
}
