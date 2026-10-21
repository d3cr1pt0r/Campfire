import type { Preferences } from './types';

export function audioLevel(value: number | undefined, fallback = 1, maximum = 1) {
    return typeof value === 'number' && Number.isFinite(value)
        ? Math.max(0, Math.min(maximum, value))
        : fallback;
}
export function voiceThreshold(value: number | undefined) {
    return typeof value === 'number' && Number.isFinite(value)
        ? Math.max(-60, Math.min(-15, value))
        : -45;
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
