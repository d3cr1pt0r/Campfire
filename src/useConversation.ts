import { useEffect, useMemo, useSyncExternalStore } from 'react';
import type { AppSocket } from './types';
import type { ApiClient } from './api';
import type { Message } from './types';
import { createConversation, type MessagePage } from './conversation';
import { inlineReplyLimit } from '../shared/threads.js';

export function useConversation(
    api: ApiClient,
    socket: AppSocket | null,
    room: string,
    enabled: boolean,
    search: string,
    pins: boolean,
    thread: string | null = null,
    around: string | null = null,
) {
    // Keep short-thread replies in the unfiltered channel view, including anchored pages.
    const inline = !thread && !search && !pins;
    const conversation = useMemo(() => {
        let anchor = search || pins ? null : around;
        return createConversation(
            room,
            (before, signal, latest) => {
                if (latest) anchor = null;
                const params = new URLSearchParams({ room, limit: '100' });
                if (thread) params.set('thread', thread);
                if (before) params.set('before', before);
                else if (anchor) params.set('around', anchor);
                if (search) params.set('search', search);
                if (pins) params.set('pinned', '1');
                return api<MessagePage>(`/messages?${params}`, 'GET', undefined, signal);
            },
            (message) =>
                ((message.thread ?? null) === thread || (inline && !!message.thread)) &&
                (!pins || !!message.pinned) &&
                (!search || message.body.toLowerCase().includes(search.toLowerCase())),
        );
    }, [api, room, search, pins, thread, around, inline]);
    const snapshot = useSyncExternalStore(conversation.subscribe, conversation.getSnapshot);
    const { messages, replies } = useMemo(() => {
        if (!inline) return { messages: snapshot.messages, replies: null };
        const messages: Message[] = [],
            replies = new Map<string, Message[]>();
        for (const message of snapshot.messages) {
            const thread = message.thread && replies.get(message.thread);
            if (!message.thread) messages.push(message);
            else if (thread) thread.push(message);
            else replies.set(message.thread, [message]);
        }
        return { messages, replies };
    }, [snapshot.messages, inline]);
    useEffect(() => {
        if (!enabled) return;
        const filling = new AbortController();
        const deleted = new Set<string>();
        const known = (id: string) => conversation.getSnapshot().messages.some((m) => m.id === id);
        // A thread that shrank back to a few replies needs the ones this view skipped
        // while it was long. Live arrivals, edits and deletions win over the fetch.
        const fill = (parent: Message) => {
            const count = parent.replyCount ?? 0;
            if (!inline || parent.thread || parent.room !== room) return;
            if (!count || count > inlineReplyLimit) return;
            const loaded = conversation
                .getSnapshot()
                .messages.filter((m) => m.thread === parent.id).length;
            if (loaded >= count) return;
            const params = new URLSearchParams({
                room,
                thread: parent.id,
                limit: String(inlineReplyLimit),
            });
            api<MessagePage>(`/messages?${params}`, 'GET', undefined, filling.signal)
                .then((page) => {
                    if (!known(parent.id)) return;
                    for (const message of page.messages)
                        if (!known(message.id) && !deleted.has(message.id))
                            conversation.receive({ type: 'upsert', message });
                })
                .catch(() => {});
        };
        const reload = () => {
            void conversation.reload();
        };
        const upsert = (message: Message) => {
            conversation.receive({ type: 'upsert', message });
            fill(message);
        };
        const remove = (event: { room: string; id: string }) => {
            if (event.room !== room) return;
            deleted.add(event.id);
            conversation.receive({ type: 'delete', id: event.id });
        };
        const expire = (event: { room: string; ids: string[] }) => {
            if (event.room === room) conversation.receive({ type: 'expire', ids: event.ids });
        };
        const strip = (event: { room: string; ids: string[] }) => {
            if (event.room === room) conversation.receive({ type: 'strip', ids: event.ids });
        };
        const deletedMember = ({ id }: { id: string }) => {
            conversation.receive({ type: 'member-deleted', id });
        };
        socket?.on('connect', reload);
        socket?.on('message', upsert);
        socket?.on('message:update', upsert);
        socket?.on('message:delete', remove);
        socket?.on('messages:expired', expire);
        socket?.on('messages:files-removed', strip);
        socket?.on('member:deleted', deletedMember);
        reload();
        return () => {
            filling.abort();
            conversation.cancel();
            socket?.off('connect', reload);
            socket?.off('message', upsert);
            socket?.off('message:update', upsert);
            socket?.off('message:delete', remove);
            socket?.off('messages:expired', expire);
            socket?.off('messages:files-removed', strip);
            socket?.off('member:deleted', deletedMember);
        };
    }, [conversation, socket, room, enabled, api, inline]);
    // Abort on replacement without permanently closing an object during React's
    // development effect replay. Request generations reject obsolete results.
    return {
        ...snapshot,
        messages: enabled ? messages : [],
        // Replies by thread, for the channel view; null where threads never show inline.
        replies: enabled ? replies : null,
        loadOlder: conversation.loadOlder,
        loadLatest: conversation.loadLatest,
        reload: conversation.reload,
    };
}
