import type { Message } from './types';

export type MessagePage = { messages: Message[]; next: string | null; newer?: boolean };
// A message after retention removed its files and link cards, which leave placeholders.
export const removeFiles = (message: Message): Message => ({
    ...message,
    attachments: message.attachments.map(({ id, name, mime }) => ({
        id,
        name,
        mime,
        removed: true,
    })),
    previews: undefined,
});
export type ConversationEvent =
    | { type: 'upsert'; message: Message }
    | { type: 'member-deleted'; id: string }
    | { type: 'delete'; id: string }
    // Expired threads: their first messages, which took the replies with them.
    | { type: 'expire'; ids: string[] }
    // Threads whose files and link cards were removed, keeping the text.
    | { type: 'strip'; ids: string[] };
type Snapshot = {
    messages: Message[];
    next: string | null;
    loading: boolean;
    loaded: boolean;
    error: string;
    newer?: boolean;
};

export function createConversation(
    room: string,
    load: (before: string | null, signal: AbortSignal, latest?: boolean) => Promise<MessagePage>,
    matches: (message: Message) => boolean = () => true,
) {
    let snapshot: Snapshot = { messages: [], next: null, loading: false, loaded: false, error: '' };
    let pending: { controller: AbortController; events: ConversationEvent[] } | null = null;
    let closed = false;
    const listeners = new Set<() => void>();
    const publish = (next: Snapshot) => {
        snapshot = next;
        listeners.forEach((listener) => listener());
    };
    const sorted = (messages: Message[]) =>
        messages.sort((a, b) => a.created - b.created || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const apply = (messages: Message[], event: ConversationEvent) => {
        if (event.type === 'member-deleted')
            return messages.map((message) => ({
                ...message,
                author: message.author === event.id ? null : message.author,
                reactions: message.reactions.filter((reaction) => reaction.user !== event.id),
            }));
        const inThread = (message: Message, ids: string[]) =>
            ids.includes(message.id) || ids.includes(message.thread ?? '');
        if (event.type === 'expire')
            return messages.filter((message) => !inThread(message, event.ids));
        if (event.type === 'strip')
            return messages.map((message) =>
                inThread(message, event.ids) ? removeFiles(message) : message,
            );
        const id = event.type === 'delete' ? event.id : event.message.id;
        const next = messages.filter((message) => message.id !== id);
        if (event.type === 'upsert' && matches(event.message)) next.push(event.message);
        return sorted(next);
    };
    const receive = (event: ConversationEvent) => {
        if (closed || (event.type === 'upsert' && event.message.room !== room)) return;
        pending?.events.push(event);
        if (
            snapshot.newer &&
            event.type === 'upsert' &&
            !snapshot.messages.some((m) => m.id === event.message.id)
        )
            return;
        publish({ ...snapshot, messages: apply(snapshot.messages, event) });
    };
    const request = async (older: boolean, latest = false) => {
        if (closed || (older && (pending || !snapshot.next))) return;
        pending?.controller.abort();
        const current = { controller: new AbortController(), events: [] as ConversationEvent[] };
        pending = current;
        publish({ ...snapshot, loading: true, error: '' });
        try {
            const page = await load(
                older ? snapshot.next : null,
                current.controller.signal,
                latest,
            );
            if (closed || pending !== current) return;
            const initial = older ? [...snapshot.messages, ...page.messages] : page.messages;
            let messages = [
                ...new Map(
                    initial.filter((m) => m.room === room && matches(m)).map((m) => [m.id, m]),
                ).values(),
            ];
            // Events that arrived after this request started win over its snapshot,
            // including edits and deletions of messages not yet loaded.
            for (const event of current.events) {
                if (
                    (page.newer || (older && snapshot.newer)) &&
                    event.type === 'upsert' &&
                    !messages.some((m) => m.id === event.message.id)
                )
                    continue;
                messages = apply(messages, event);
            }
            publish({
                messages: sorted(messages),
                next: page.next,
                loading: false,
                loaded: true,
                error: '',
                ...(page.newer || (older && snapshot.newer) ? { newer: true } : {}),
            });
        } catch (error) {
            if (!closed && pending === current && !current.controller.signal.aborted)
                publish({ ...snapshot, loading: false, error: (error as Error).message });
        } finally {
            if (pending === current) pending = null;
        }
    };
    return {
        getSnapshot: () => snapshot,
        subscribe(listener: () => void) {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
        receive,
        reload: () => request(false),
        loadOlder: () => request(true),
        loadLatest: () => request(false, true),
        cancel() {
            pending?.controller.abort();
            pending = null;
        },
        close() {
            closed = true;
            pending?.controller.abort();
            pending = null;
            listeners.clear();
        },
    };
}
