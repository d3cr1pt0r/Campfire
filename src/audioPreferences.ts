import type { Preferences } from './types';

export function audioLevel(value: number | undefined, fallback = 1, maximum = 1) {
    return typeof value === 'number' && Number.isFinite(value)
        ? Math.max(0, Math.min(maximum, value))
        : fallback;
}
export function voiceThreshold(value: number | undefined) {
    return typeof value === 'number' && Number.isFinite(value)
        ? Math.max(-60, Math.min(0, value))
        : -45;
}
export function voiceReleaseDelay(value: number | undefined) {
    return typeof value === 'number' && Number.isFinite(value)
        ? Math.max(0, Math.min(1000, value))
        : 200;
}
export function speechActivation(
    prefs: Pick<Preferences, 'noise' | 'noiseSuppressionEngine' | 'voiceActivationMode'>,
) {
    return (
        prefs.noise &&
        prefs.noiseSuppressionEngine !== 'chromium' &&
        prefs.voiceActivationMode === 'speech'
    );
}
export function voiceGateSettings(prefs: Preferences) {
    return {
        enabled: !!prefs.voiceActivation && !prefs.pushToTalk,
        mode: speechActivation(prefs) ? 'speech' : 'level',
        threshold: voiceThreshold(prefs.voiceThreshold),
        speechThreshold: 0.95 - 0.9 * audioLevel(prefs.speechSensitivity, 0.5),
        releaseMs: voiceReleaseDelay(prefs.voiceReleaseDelay),
    };
}
// The live marker and the activation slider share the same -60 to 0 dBFS scale.
export function voiceThresholdPercent(decibels: number | null | undefined) {
    return typeof decibels === 'number' && Number.isFinite(decibels)
        ? Math.max(0, Math.min(100, ((decibels + 60) / 60) * 100))
        : 0;
}
export function participantVolumeKey(server: string, account: string, participant: string) {
    let host = server;
    try {
        host = new URL(server).host;
    } catch {
        /* Unconnected fixture. */
    }
    return JSON.stringify([host, account, participant]);
}
export function participantLevels(prefs: Preferences, key: string) {
    const saved = prefs.participantVolumes?.[key];
    return { voice: audioLevel(saved?.voice), stream: audioLevel(saved?.stream) };
}
