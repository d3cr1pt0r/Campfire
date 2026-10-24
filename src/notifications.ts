import type {
    Channel,
    ChannelNotificationMode,
    Message,
    Preferences,
    ReactionNotification,
    State,
    User,
} from './types';
import { mentionSegments } from './mentions.ts';
import { messageParts } from './messageText.ts';
import { messageTexts } from './messageFormat.ts';
import { rememberedDevice } from './devices.ts';
import { audioLevel } from './audioPreferences.ts';
import { playSound, sounds, type SoundName } from './sounds.ts';

// Keyed by host, so a server keeps its choices whichever scheme reaches it.
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

// Anything unknown means mentions, the default.
export function channelNotificationMode(value: unknown): ChannelNotificationMode {
    return value === 'all' || value === 'muted' ? value : 'mentions';
}

export const explicitNotificationMode = (value: unknown): ChannelNotificationMode | undefined =>
    value === 'all' || value === 'mentions' || value === 'muted' ? value : undefined;

export function serverNotificationMode(
    prefs: Preferences,
    server: string,
    user: string,
): ChannelNotificationMode {
    return (
        explicitNotificationMode(
            prefs.serverNotificationModes?.[notificationKey(server, user, '*')],
        ) ?? (prefs.mentionNotifications === false ? 'muted' : 'mentions')
    );
}

// Notification inheritance follows category membership, independently of access-permission sync.
export function effectiveChannelNotificationMode(
    prefs: Preferences,
    server: string,
    user: string,
    channel: string,
    category?: string | null,
): ChannelNotificationMode {
    return (
        explicitNotificationMode(
            prefs.channelNotifications?.[notificationKey(server, user, channel)],
        ) ??
        (category
            ? explicitNotificationMode(
                  prefs.categoryNotifications?.[notificationKey(server, user, category)],
              )
            : undefined) ??
        serverNotificationMode(prefs, server, user)
    );
}

export function shouldNotify(
    message: Message,
    me: User,
    prefs: Preferences,
    server: string,
    users: User[] = [me],
    channels: Pick<Channel, 'id' | 'category'>[] = [],
) {
    if (message.author === me.id || me.status === 'dnd') return false;
    if (prefs.serverNotifications?.[notificationKey(server, me.id, '*')] === false) return false;
    if (message.room.startsWith('dm:')) {
        const override = explicitNotificationMode(
            prefs.channelNotifications?.[notificationKey(server, me.id, message.room)],
        );
        if (override === 'muted') return false;
        if (override === 'all') return true;
        return prefs.dmNotifications !== false;
    }
    const channel = channels.find((entry) => entry.id === message.room);
    const mode = effectiveChannelNotificationMode(
        prefs,
        server,
        me.id,
        message.room,
        channel?.category,
    );
    if (mode === 'muted') return false;
    if (mode === 'all') return true;
    return mentions(message, me, users);
}

export function shouldNotifyReaction(
    event: ReactionNotification,
    me: User,
    prefs: Preferences,
    server: string,
    channels: Pick<Channel, 'id' | 'category'>[] = [],
) {
    if (event.message.author !== me.id || event.user === me.id || me.status === 'dnd') return false;
    if (prefs.serverNotifications?.[notificationKey(server, me.id, '*')] === false) return false;
    const room = event.message.room;
    if (room.startsWith('dm:')) {
        const override = explicitNotificationMode(
            prefs.channelNotifications?.[notificationKey(server, me.id, room)],
        );
        if (override === 'muted') return false;
        return override === 'all' || prefs.dmNotifications !== false;
    }
    const channel = channels.find((entry) => entry.id === room);
    // A reaction to your message is directed at you, including in mentions-only channels.
    return (
        effectiveChannelNotificationMode(prefs, server, me.id, room, channel?.category) !== 'muted'
    );
}

// Mentions inside code are quoted text, not pings.
const mentions = (message: Message, me: User, users: User[]) =>
    messageTexts(message.body).some((text) =>
        messageParts(text).some(
            (part) =>
                !part.link &&
                mentionSegments(part.text, users).some((segment) => segment.user?.id === me.id),
        ),
    );

// Direct messages chime; a mention of you in a channel or thread has its own bell.
export const notificationSound = (message: Message, me: User, users: User[] = [me]): SoundName =>
    !message.room.startsWith('dm:') && mentions(message, me, users) ? 'mention' : 'message';

// Incoming calls ring unless you are in Do Not Disturb or have muted this server.
export const callsRing = (me: User, prefs: Preferences, server: string) =>
    me.status !== 'dnd' &&
    prefs.serverNotifications?.[notificationKey(server, me.id, '*')] !== false;

// Reuse one context, but initialize on playback too: saved sessions can receive DMs
// before the user has interacted with the document (including while hidden in the tray).
export function createNotificationSound(
    output: () => Pick<
        Preferences,
        'output' | 'outputLabel' | 'soundEffectsVolume' | 'outputVolume'
    > = () => ({ output: '' }),
) {
    let context:
        | (AudioContext & {
              readonly sinkId?: string | { type: string };
              setSinkId?: (id: string) => Promise<void>;
          })
        | null = null;
    // Each sound is bounded separately, so a burst of one never silences another.
    const lastPlayed = new Map<string, number>();
    const loops = new Map<SoundName, { gain: GainNode; timer?: ReturnType<typeof setTimeout> }>();
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
    const recent = (key: string, at: number) => at - (lastPlayed.get(key) ?? -Infinity) < 700;
    // Resumes the context and selects the output device; null when nothing should play.
    const prepare = async (key: string, volumeOf: 'soundEffectsVolume' | 'outputVolume') => {
        const requestedAt = Date.now();
        const current = ensureContext();
        if (!current || recent(key, requestedAt)) return null;
        if (current.state !== 'running') await current.resume();
        const selected = output();
        const volume = audioLevel(selected[volumeOf]);
        if (volume === 0) return null;
        if (typeof current.setSinkId === 'function') {
            let sink = selected.output === 'default' ? '' : selected.output;
            try {
                if (sink && selected.outputLabel && navigator.mediaDevices?.enumerateDevices) {
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
            recent(key, Date.now())
        )
            return null;
        lastPlayed.set(key, Date.now());
        return { current, volume };
    };
    const stopLoop = (name: SoundName) => {
        const loop = loops.get(name);
        if (!loop) return;
        loops.delete(name);
        clearTimeout(loop.timer);
        // A short fade avoids a click when ringing stops mid-note.
        try {
            const now = loop.gain.context.currentTime;
            loop.gain.gain.setValueAtTime(loop.gain.gain.value, now);
            loop.gain.gain.linearRampToValueAtTime(0, now + 0.05);
        } catch {
            /* The context may already be closed. */
        }
        setTimeout(() => loop.gain.disconnect(), 200);
    };
    return {
        // 'test' checks the output device at the output volume, using the message sound.
        async play(kind: SoundName | 'test' = 'message'): Promise<boolean> {
            try {
                const ready = await prepare(
                    kind,
                    kind === 'test' ? 'outputVolume' : 'soundEffectsVolume',
                );
                if (!ready) return false;
                playSound(
                    ready.current,
                    ready.current.destination,
                    kind === 'test' ? 'message' : kind,
                    ready.volume,
                );
                return true;
            } catch {
                return false;
            }
        },
        // Repeats a ringing sound until stopLoop. Starting one that already rings does nothing.
        async startLoop(name: SoundName): Promise<boolean> {
            const period = sounds[name].loop;
            if (!period || loops.has(name)) return false;
            try {
                const ready = await prepare(`loop:${name}`, 'soundEffectsVolume');
                if (!ready || loops.has(name)) return false;
                const gain = ready.current.createGain();
                gain.connect(ready.current.destination);
                const loop: { gain: GainNode; timer?: ReturnType<typeof setTimeout> } = { gain };
                loops.set(name, loop);
                const ring = () => {
                    if (loops.get(name) !== loop || closed) return;
                    playSound(ready.current, gain, name, audioLevel(output().soundEffectsVolume));
                    loop.timer = setTimeout(ring, period * 1000);
                };
                ring();
                return true;
            } catch {
                return false;
            }
        },
        stopLoop,
        close() {
            closed = true;
            [...loops.keys()].forEach(stopLoop);
            document.removeEventListener('pointerdown', unlock, true);
            document.removeEventListener('keydown', unlock, true);
            if (context) void context.close().catch(() => {});
            context = null;
        },
    };
}

type DirectCall = State['directCalls'][number];
// Invitations ringing for you (only while you are in no call), and the call you are in
// while waiting for someone you invited to answer.
export function callRinging(calls: DirectCall[], me: string, current: string | null) {
    const incoming = current
        ? []
        : calls
              .filter((call) => call.invited.includes(me) && !call.members.includes(me))
              .map((call) => call.id);
    const own = calls.find((call) => call.id === current);
    const outgoing =
        own && own.invited.length > 0 && own.members.every((id) => id === me) ? own.id : null;
    return { incoming, outgoing };
}

// Someone invited to your current call stopped being invited without joining it.
export function callDeclined(previous: DirectCall[], next: DirectCall[], current: string | null) {
    const before = previous.find((call) => call.id === current);
    const after = next.find((call) => call.id === current);
    return (
        !!before &&
        !!after &&
        before.invited.some((id) => !after.invited.includes(id) && !after.members.includes(id))
    );
}
