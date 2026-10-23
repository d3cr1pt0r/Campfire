import type { ActivitySnapshot, Message } from './types';
import type { ApiClient } from './api';

const empty: ActivitySnapshot = { version: -1, unread: {}, latest: {} };

// Versioned snapshots keep a delayed HTTP response from undoing a newer socket update.
export function createActivityClient(api: ApiClient, fail: (error: Error) => void) {
    let snapshot = empty,
        generation = 0;
    const listeners = new Set<() => void>();
    const acknowledged = new Map<string, number>();
    const pending = new Map<string, number>();
    const running = new Set<string>();
    const receive = (value: ActivitySnapshot) => {
        if (value.version < snapshot.version) return;
        snapshot = value;
        listeners.forEach((listener) => listener());
    };
    const read = (room: string, through: number, thread: string | null = null, all = false) => {
        const key = JSON.stringify([room, thread, all]);
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
        acknowledge: async (message: Pick<Message, 'id' | 'room'>) => {
            const current = generation;
            const value = await api<ActivitySnapshot>('/activity/acknowledge', 'POST', {
                room: message.room,
                message: message.id,
            });
            if (current === generation) receive(value);
        },
        acknowledgeVisible: async (room: string, messages: string[], signal?: AbortSignal) => {
            if (!messages.length) return [];
            const current = generation;
            const value = await api<ActivitySnapshot & { messages: string[] }>(
                '/activity/acknowledge-visible',
                'POST',
                { room, messages },
                signal,
            );
            if (current !== generation) return [];
            receive(value);
            return value.messages;
        },
        dismiss: (room: string, through = snapshot.latest[room]) => read(room, through, null, true),
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
