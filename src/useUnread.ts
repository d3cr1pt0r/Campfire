import { useEffect, useMemo, useSyncExternalStore } from 'react';
import type { ActivitySnapshot, AppSocket, Message } from './types';
import type { ApiClient } from './api';
import { createActivityClient } from './activity';

export function useUnread(
    api: ApiClient,
    socket: AppSocket | null,
    initial: ActivitySnapshot | undefined,
    fail: (error: Error) => void,
) {
    const client = useMemo(() => createActivityClient(api, fail), [api, fail]);
    const snapshot = useSyncExternalStore(client.subscribe, client.getSnapshot);
    useEffect(() => {
        if (initial) client.receive(initial);
    }, [client, initial]);
    useEffect(() => {
        socket?.on('activity', client.receive);
        return () => {
            socket?.off('activity', client.receive);
            client.cancel();
        };
    }, [client, socket]);
    return { unread: snapshot.unread, markRead: client.read, dismissUnread: client.dismiss };
}

// Only acknowledge messages from the loaded, unfiltered conversation. A background
// window, a search result, or an unopened thread must not advance its read position.
export function useConversationRead(
    room: string,
    messages: Message[],
    enabled: boolean,
    markRead: ReturnType<typeof createActivityClient>['read'],
    thread: string | null = null,
) {
    const through = messages.reduce(
        (position, message) => Math.max(position, message.sequence ?? 0),
        0,
    );
    useEffect(() => {
        if (!enabled || !through) return;
        const read = () => {
            if (document.visibilityState === 'visible' && document.hasFocus())
                markRead(room, through, thread);
        };
        read();
        window.addEventListener('focus', read);
        document.addEventListener('visibilitychange', read);
        return () => {
            window.removeEventListener('focus', read);
            document.removeEventListener('visibilitychange', read);
        };
    }, [room, through, enabled, markRead, thread]);
}

// Short threads showing their replies under their message are read with the
// conversation, as if each had been opened.
export function useInlineThreadsRead(
    room: string,
    threads: Map<string, Message[]>,
    enabled: boolean,
    markRead: ReturnType<typeof createActivityClient>['read'],
) {
    const positions = JSON.stringify(
        [...threads]
            .map(([thread, replies]) => [
                thread,
                replies.reduce((position, reply) => Math.max(position, reply.sequence ?? 0), 0),
            ])
            .filter(([, through]) => through),
    );
    useEffect(() => {
        const threads: [string, number][] = JSON.parse(positions);
        if (!enabled || !threads.length) return;
        const read = () => {
            if (document.visibilityState === 'visible' && document.hasFocus())
                for (const [thread, through] of threads) markRead(room, through, thread);
        };
        read();
        window.addEventListener('focus', read);
        document.addEventListener('visibilitychange', read);
        return () => {
            window.removeEventListener('focus', read);
            document.removeEventListener('visibilitychange', read);
        };
    }, [room, positions, enabled, markRead]);
}
