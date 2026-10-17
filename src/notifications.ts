import type { Message, Preferences, User } from './types';
import { mentionSegments } from './mentions.ts';
import { messageParts } from './messageText.ts';

export function notificationKey(server: string, user: string, room: string) {
    return JSON.stringify([server.replace(/\/$/, ''), user, room]);
}

export function shouldNotify(
    message: Message,
    me: User,
    prefs: Preferences,
    server: string,
    users: User[] = [me],
) {
    if (message.author === me.id || me.status === 'dnd') return false;
    if (prefs.serverNotifications?.[notificationKey(server, me.id, '*')] === false) return false;
    if (prefs.channelNotifications?.[notificationKey(server, me.id, message.room)] === false)
        return false;
    if (message.room.startsWith('dm:')) return prefs.dmNotifications !== false;
    return (
        prefs.mentionNotifications !== false &&
        messageParts(message.body).some(
            (part) =>
                !part.link &&
                mentionSegments(part.text, users).some((segment) => segment.user?.id === me.id),
        )
    );
}

// A single quiet chime context is unlocked by a user gesture and reused for incoming messages.
export function createNotificationSound() {
    let context: AudioContext | null = null;
    let lastPlayed = -Infinity;
    const unlock = () => {
        try {
            context ??= new AudioContext();
            if (context.state === 'suspended') void context.resume().catch(() => {});
        } catch {
            /* Notifications still work when Web Audio is unavailable. */
        }
    };
    document.addEventListener('pointerdown', unlock);
    document.addEventListener('keydown', unlock);
    return {
        play() {
            if (!context || context.state !== 'running' || Date.now() - lastPlayed < 700) return;
            lastPlayed = Date.now();
            const now = context.currentTime;
            for (const [frequency, offset] of [
                [660, 0],
                [880, 0.12],
            ]) {
                const tone = context.createOscillator();
                const gain = context.createGain();
                tone.type = 'sine';
                tone.frequency.value = frequency;
                gain.gain.setValueAtTime(0, now + offset);
                gain.gain.linearRampToValueAtTime(0.035, now + offset + 0.015);
                gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.22);
                tone.connect(gain);
                gain.connect(context.destination);
                tone.start(now + offset);
                tone.stop(now + offset + 0.24);
                tone.onended = () => {
                    tone.disconnect();
                    gain.disconnect();
                };
            }
        },
        close() {
            document.removeEventListener('pointerdown', unlock);
            document.removeEventListener('keydown', unlock);
            if (context) void context.close().catch(() => {});
            context = null;
        },
    };
}
