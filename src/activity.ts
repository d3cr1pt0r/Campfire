import type { ActivitySnapshot, Message, NotificationHighlights } from './types';
import type { ApiClient } from './api';

const empty: ActivitySnapshot = { version: -1, unread: {}, latest: {} };

// Versioned snapshots keep a delayed HTTP response from undoing a newer socket update.
export function createActivityClient(api: ApiClient, fail: (error: Error) => void) {
    let snapshot = empty,
        received = empty,
        generation = 0;
    const listeners = new Set<() => void>();
    const acknowledged = new Map<string, number>();
    const pending = new Map<string, number>();
    const running = new Set<string>();
    const quietRooms = new Map<string, number>();
    const publish = () => {
        const unread = { ...received.unread };
        // Live messages in the focused conversation are already being read. Keep
        // its badge stable until persistence catches up, without delaying other rooms.
        for (const room of quietRooms.keys()) {
            if (snapshot.unread[room]) unread[room] = snapshot.unread[room];
            else delete unread[room];
        }
        snapshot = { ...received, unread };
        listeners.forEach((listener) => listener());
    };
    const receive = (value: ActivitySnapshot) => {
        if (value.version < received.version) return;
        received = value;
        publish();
    };
    const read = (
        room: string,
        through: number,
        thread: string | null = null,
        all = false,
        reactionsThrough = 0,
    ) => {
        const key = JSON.stringify([room, thread, all, reactionsThrough]);
        if (!through || through <= (acknowledged.get(key) ?? 0)) return;
        pending.set(key, Math.max(through, pending.get(key) ?? 0));
        if (running.has(key)) return;
        running.add(key);
        const current = generation;
        void (async () => {
            try {
                while (pending.has(key) && current === generation) {
                    const position = pending.get(key)!;
                    pending.delete(key);
                    if (position <= (acknowledged.get(key) ?? 0)) continue;
                    const value = await api<ActivitySnapshot>('/activity/read', 'POST', {
                        room,
                        through: position,
                        thread,
                        all,
                        ...(reactionsThrough ? { reactionsThrough } : {}),
                    });
                    if (current !== generation) return;
                    acknowledged.set(key, position);
                    receive(value);
                }
            } catch (error) {
                // The message or access can disappear between display and acknowledgment.
                if (
                    current === generation &&
                    ![403, 404].includes((error as { status?: number }).status ?? 0)
                )
                    fail(error as Error);
            } finally {
                if (current === generation) running.delete(key);
            }
        })();
    };
    return {
        receive,
        read,
        acknowledge: async (
            message: Pick<Message, 'id' | 'room'>,
            reactionsThrough = 0,
            quiet = false,
        ) => {
            const current = generation;
            if (quiet) quietRooms.set(message.room, (quietRooms.get(message.room) ?? 0) + 1);
            try {
                const value = await api<ActivitySnapshot>('/activity/acknowledge', 'POST', {
                    room: message.room,
                    message: message.id,
                    ...(reactionsThrough ? { reactionsThrough } : {}),
                });
                if (current === generation) receive(value);
            } finally {
                if (quiet && current === generation) {
                    const remaining = quietRooms.get(message.room)! - 1;
                    if (remaining) quietRooms.set(message.room, remaining);
                    else quietRooms.delete(message.room);
                    // Also restore authoritative unread state if the request failed.
                    publish();
                }
            }
        },
        acknowledgeVisible: async (room: string, messages: string[], signal?: AbortSignal) => {
            const empty: NotificationHighlights = { messages: [], reactions: [] };
            if (!messages.length) return empty;
            const current = generation;
            const value = await api<ActivitySnapshot & NotificationHighlights>(
                '/activity/acknowledge-visible',
                'POST',
                {
                    room,
                    messages,
                    ...(snapshot.latestReactions?.[room]
                        ? { reactionsThrough: snapshot.latestReactions[room] }
                        : {}),
                },
                signal,
            );
            if (current !== generation) return empty;
            receive(value);
            return { messages: value.messages, reactions: value.reactions ?? [] };
        },
        dismiss: (
            room: string,
            through = snapshot.latest[room],
            reactionsThrough = snapshot.latestReactions?.[room] ?? 0,
        ) => read(room, through, null, true, reactionsThrough),
        getSnapshot: () => snapshot,
        subscribe(listener: () => void) {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
        cancel() {
            generation++;
            pending.clear();
            running.clear();
            acknowledged.clear();
            quietRooms.clear();
            publish();
        },
    };
}

export const isReadingConversation = (
    message: { room: string; thread?: string | null },
    room: string,
    thread: string | null,
    visible: boolean,
    focused: boolean,
) => visible && focused && message.room === room && (!message.thread || message.thread === thread);
