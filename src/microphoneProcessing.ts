import { openMicrophone, microphoneConstraints } from './media';
import voiceGateUrl from './voiceGate.worklet.js?url&no-inline';
import { audioLevel, voiceThreshold } from './audioPreferences';
import type { Preferences } from './types';

export async function openProcessedMicrophone(preferences: Preferences) {
    // Resume during the initiating gesture, before requesting capture.
    const context = new AudioContext();
    const resumed = context.resume();
    let raw: MediaStream | undefined;
    let source: MediaStreamAudioSourceNode | undefined;
    let gain: GainNode | undefined;
    let gate: AudioWorkletNode | undefined;
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
        gain?.disconnect();
        gate?.disconnect();
        if (gate) gate.port.close();
        void context.close().catch(() => {});
    };
    let constraints = JSON.stringify(microphoneConstraints(preferences));
    let queue = Promise.resolve();
    const update = (next: Preferences) => {
        if (stopped) return Promise.resolve();
        gain!.gain.setTargetAtTime(
            audioLevel(next.microphoneVolume, 1, 2),
            context.currentTime,
            0.01,
        );
        gate!.port.postMessage({
            enabled: !!next.voiceActivation && !next.pushToTalk,
            threshold: voiceThreshold(next.voiceThreshold),
        });
        const requested = microphoneConstraints(next);
        const signature = JSON.stringify(requested);
        if (signature === constraints) return queue;
        constraints = signature;
        queue = queue
            .catch(() => {})
            .then(async () => {
                if (stopped) return;
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
                source.connect(gain!);
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
        gain = context.createGain();
        gain.gain.value = audioLevel(preferences.microphoneVolume, 1, 2);
        gate = new AudioWorkletNode(context, 'campfire-voice-gate');
        destination = context.createMediaStreamDestination();
        source.connect(gain).connect(gate).connect(destination);
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
