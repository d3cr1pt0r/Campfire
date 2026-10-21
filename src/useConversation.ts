import { useEffect, useMemo, useSyncExternalStore } from 'react';
import type { AppSocket } from './types';
import type { ApiClient } from './api';
import type { Message } from './types';
import { createConversation, type MessagePage } from './conversation';

export function useConversation(
    api: ApiClient,
    socket: AppSocket | null,
    room: string,
    enabled: boolean,
    search: string,
    pins: boolean,
    thread: string | null = null,
) {
    const conversation = useMemo(
        () =>
            createConversation(
                room,
                (before, signal) => {
                    const params = new URLSearchParams({ room, limit: '100' });
                    if (thread) params.set('thread', thread);
                    if (before) params.set('before', before);
                    if (search) params.set('search', search);
                    if (pins) params.set('pinned', '1');
                    return api<MessagePage>(`/messages?${params}`, 'GET', undefined, signal);
                },
                (message) =>
                    (message.thread ?? null) === thread &&
                    (!pins || !!message.pinned) &&
                    (!search || message.body.toLowerCase().includes(search.toLowerCase())),
            ),
        [api, room, search, pins, thread],
    );
    const snapshot = useSyncExternalStore(conversation.subscribe, conversation.getSnapshot);
    useEffect(() => {
        if (!enabled) return;
        const reload = () => {
            void conversation.reload();
        };
        const upsert = (message: Message) => conversation.receive({ type: 'upsert', message });
        const remove = (event: { room: string; id: string }) => {
            if (event.room === room) conversation.receive({ type: 'delete', id: event.id });
        };
        const expire = (event: { room: string; ids: string[] }) => {
            if (event.room === room) conversation.receive({ type: 'expire', ids: event.ids });
        };
        const deletedMember = ({ id }: { id: string }) => {
            conversation.receive({ type: 'member-deleted', id });
        };
        socket?.on('connect', reload);
        socket?.on('message', upsert);
        socket?.on('message:update', upsert);
        socket?.on('message:delete', remove);
        socket?.on('messages:expired', expire);
        socket?.on('member:deleted', deletedMember);
        reload();
        return () => {
            conversation.cancel();
            socket?.off('connect', reload);
            socket?.off('message', upsert);
            socket?.off('message:update', upsert);
            socket?.off('message:delete', remove);
            socket?.off('messages:expired', expire);
            socket?.off('member:deleted', deletedMember);
        };
    }, [conversation, socket, room, enabled]);
    // Abort on replacement without permanently closing an object during React's
    // development effect replay. Request generations reject obsolete results.
    return {
        ...snapshot,
        messages: enabled ? snapshot.messages : [],
        loadOlder: conversation.loadOlder,
        reload: conversation.reload,
    };
}
