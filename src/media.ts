import { rememberedDevice } from './devices.ts';
import type { Preferences } from './types';

type CapturePreferences = Pick<Preferences, 'input' | 'inputLabel' | 'noise'>;
type MicrophoneResult = { stream: MediaStream; usedDefault: boolean };

function errorDetails(error: unknown): { name: string; message: string; constraint: string } {
    const value = error && typeof error === 'object' ? error as Record<string, unknown> : {};
    return {
        name: typeof value.name === 'string' ? value.name : '',
        message: typeof value.message === 'string' ? value.message.trim() : typeof error === 'string' ? error.trim() : '',
        constraint: typeof value.constraint === 'string' ? value.constraint : '',
    };
}

export function formatMicrophoneError(error: unknown): string {
    const { name, message, constraint } = errorDetails(error);
    let explanation: string;
    switch (name) {
        case 'NotAllowedError':
        case 'PermissionDeniedError':
            explanation = 'Microphone access was denied. Allow microphone access in your browser or system privacy settings, then retry.';
            break;
        case 'NotFoundError':
        case 'DevicesNotFoundError':
            explanation = 'No microphone is available. Check your system input device, then select System default in Settings → Voice & video.';
            break;
        case 'NotReadableError':
        case 'TrackStartError':
            explanation = 'The microphone could not be opened. Check your system audio service (PipeWire/PulseAudio on Linux), device access, and other recording apps.';
            break;
        case 'OverconstrainedError':
        case 'ConstraintNotSatisfiedError':
            explanation = `The microphone cannot satisfy the requested settings${constraint ? ` (${constraint})` : ''}. Select System default in Settings → Voice & video and retry.`;
            break;
        case 'SecurityError':
            explanation = 'Microphone capture is disabled for this page or application. Check browser or system permissions.';
            break;
        case 'AbortError':
            explanation = 'Opening the microphone was interrupted. Check the input device and retry.';
            break;
        case 'MediaDevicesUnavailable':
            explanation = 'Microphone capture is unavailable here. Use the Electron desktop client, or open the browser client over HTTPS or localhost.';
            break;
        default:
            explanation = message || 'The audio system did not provide an error description. Check your microphone and its permissions in Settings → Voice & video.';
    }
    const detail = name && name !== 'Error' ? ` [${name}]` : '';
    const nativeMessage = message && !explanation.includes(message) ? ` Details: ${message}` : '';
    return `${explanation}${detail}${nativeMessage}`;
}

export async function openMicrophone(
    preferences: CapturePreferences,
    devices: Pick<MediaDevices, 'getUserMedia'> & Partial<Pick<MediaDevices, 'enumerateDevices'>> | undefined = globalThis.navigator?.mediaDevices,
): Promise<MicrophoneResult> {
    if (!devices?.getUserMedia) {
        throw Object.assign(new Error(''), { name: 'MediaDevicesUnavailable' });
    }
    const processing = {
        noiseSuppression: preferences.noise,
        echoCancellation: preferences.noise,
        autoGainControl: preferences.noise,
    };
    const selected = preferences.input && preferences.input !== 'default';
    try {
        const stream = await devices.getUserMedia({ audio: {
            ...processing,
            ...(selected ? { deviceId: { exact: preferences.input } } : {}),
        } });
        return { stream, usedDefault: false };
    } catch (error) {
        const { name, constraint } = errorDetails(error);
        const missingDevice = ['NotFoundError', 'DevicesNotFoundError'].includes(name);
        const unavailableId = ['OverconstrainedError', 'ConstraintNotSatisfiedError'].includes(name)
            && (!constraint || constraint === 'deviceId');
        // Saved IDs can expire after unplugging a device or a renderer-origin change.
        // Retry only a missing selection; permission/busy-device errors must surface.
        if (!selected || (!missingDevice && !unavailableId)) throw error;
        const stream = await devices.getUserMedia({ audio: processing });
        if (preferences.inputLabel && devices.enumerateDevices) {
            try {
                const resolved = rememberedDevice(await devices.enumerateDevices(), 'audioinput', preferences.input, preferences.inputLabel);
                if (resolved !== preferences.input) {
                    const recovered = await devices.getUserMedia({ audio: { ...processing, deviceId: { exact: resolved } } });
                    stream.getTracks().forEach(track => track.stop());
                    return { stream: recovered, usedDefault: false };
                }
            } catch { /* The available default still permits the call. */ }
        }
        return { stream, usedDefault: true };
    }
}
