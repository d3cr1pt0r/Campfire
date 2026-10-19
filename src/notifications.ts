import type { ChannelNotificationMode, Message, Preferences, User } from './types';
import { mentionSegments } from './mentions.ts';
import { messageParts } from './messageText.ts';
import { rememberedDevice } from './devices.ts';

// Keyed by host so notification choices survive the http:// to https:// upgrade.
const serverKey = (server: string) => {
    try {
        return new URL(server).host;
    } catch {
        return server.replace(/\/$/, '');
    }
};

export function notificationKey(server: string, user: string, room: string) {
    return JSON.stringify([serverKey(server), user, room]);
}

// Rewrites notification choices saved under full server URLs by earlier versions.
export function migrateNotificationKeys(prefs: Preferences): Preferences {
    const migrate = <T>(choices?: Record<string, T>) =>
        choices &&
        Object.fromEntries(
            Object.entries(choices).map(([key, value]) => {
                try {
                    const [server, user, room] = JSON.parse(key);
                    return [notificationKey(server, user, room), value];
                } catch {
                    return [key, value];
                }
            }),
        );
    return {
        ...prefs,
        ...(prefs.serverNotifications && {
            serverNotifications: migrate(prefs.serverNotifications),
        }),
        ...(prefs.channelNotifications && {
            channelNotifications: migrate(prefs.channelNotifications),
        }),
    };
}

// Keep old on/off preferences: on meant mentions, while off muted the conversation.
export function channelNotificationMode(value: unknown): ChannelNotificationMode {
    if (value === false || value === 'muted') return 'muted';
    return value === 'all' ? 'all' : 'mentions';
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
    const mode = channelNotificationMode(
        prefs.channelNotifications?.[notificationKey(server, me.id, message.room)],
    );
    if (mode === 'muted') return false;
    if (message.room.startsWith('dm:')) return prefs.dmNotifications !== false;
    if (mode === 'all') return true;
    return (
        prefs.mentionNotifications !== false &&
        messageParts(message.body).some(
            (part) =>
                !part.link &&
                mentionSegments(part.text, users).some((segment) => segment.user?.id === me.id),
        )
    );
}

// Reuse one context, but initialize on playback too: saved sessions can receive DMs
// before the user has interacted with the document (including while hidden in the tray).
export function createNotificationSound(
    output: () => Pick<Preferences, 'output' | 'outputLabel'> = () => ({ output: '' }),
) {
    let context:
        | (AudioContext & {
              readonly sinkId?: string | { type: string };
              setSinkId?: (id: string) => Promise<void>;
          })
        | null = null;
    let lastPlayed = -Infinity;
    let closed = false;
    const ensureContext = () => {
        if (closed) return null;
        if (!context || context.state === 'closed') context = new AudioContext();
        return context;
    };
    const unlock = () => {
        try {
            const current = ensureContext();
            if (current && current.state !== 'running') void current.resume().catch(() => {});
        } catch {
            /* A later playback or interaction can retry unavailable audio. */
        }
    };
    document.addEventListener('pointerdown', unlock, true);
    document.addEventListener('keydown', unlock, true);
    return {
        async play(): Promise<boolean> {
            const requestedAt = Date.now();
            try {
                const current = ensureContext();
                if (!current || requestedAt - lastPlayed < 700) return false;
                if (current.state !== 'running') await current.resume();
                const selected = output();
                if (typeof current.setSinkId === 'function') {
                    let sink = selected.output === 'default' ? '' : selected.output;
                    try {
                        if (
                            sink &&
                            selected.outputLabel &&
                            navigator.mediaDevices?.enumerateDevices
                        ) {
                            sink = rememberedDevice(
                                await navigator.mediaDevices.enumerateDevices(),
                                'audiooutput',
                                sink,
                                selected.outputLabel,
                            );
                        }
                        if ((current.sinkId ?? '') !== sink) await current.setSinkId(sink);
                    } catch {
                        // A disconnected or unavailable output must not silence notifications.
                        if ((current.sinkId ?? '') !== '') await current.setSinkId('');
                    }
                }
                // Browsers may leave resume pending until a later gesture. Do not replay
                // stale DMs after that gesture or after signing out.
                if (
                    closed ||
                    context !== current ||
                    current.state !== 'running' ||
                    Date.now() - requestedAt > 1500 ||
                    Date.now() - lastPlayed < 700
                )
                    return false;
                lastPlayed = Date.now();
                const now = current.currentTime;
                for (const [frequency, offset] of [
                    [660, 0],
                    [880, 0.12],
                ]) {
                    const tone = current.createOscillator();
                    const gain = current.createGain();
                    tone.type = 'sine';
                    tone.frequency.value = frequency;
                    gain.gain.setValueAtTime(0, now + offset);
                    gain.gain.linearRampToValueAtTime(0.035, now + offset + 0.015);
                    gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.22);
                    tone.connect(gain);
                    gain.connect(current.destination);
                    tone.start(now + offset);
                    tone.stop(now + offset + 0.24);
                    tone.onended = () => {
                        tone.disconnect();
                        gain.disconnect();
                    };
                }
                return true;
            } catch {
                return false;
            }
        },
        close() {
            closed = true;
            document.removeEventListener('pointerdown', unlock, true);
            document.removeEventListener('keydown', unlock, true);
            if (context) void context.close().catch(() => {});
            context = null;
        },
    };
}
