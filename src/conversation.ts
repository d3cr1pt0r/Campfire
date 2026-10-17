import type { Message } from './types';

export type MessagePage = { messages: Message[]; next: string | null };
export type ConversationEvent =
    | { type: 'upsert'; message: Message }
    | { type: 'delete'; id: string };
type Snapshot = { messages: Message[]; next: string | null; loading: boolean; error: string };

export function createConversation(
    room: string,
    load: (before: string | null, signal: AbortSignal) => Promise<MessagePage>,
    matches: (message: Message) => boolean = () => true,
) {
    let snapshot: Snapshot = { messages: [], next: null, loading: false, error: '' };
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
        const id = event.type === 'delete' ? event.id : event.message.id;
        const next = messages.filter((message) => message.id !== id);
        if (event.type === 'upsert' && matches(event.message)) next.push(event.message);
        return sorted(next);
    };
    const receive = (event: ConversationEvent) => {
        if (closed || (event.type === 'upsert' && event.message.room !== room)) return;
        pending?.events.push(event);
        publish({ ...snapshot, messages: apply(snapshot.messages, event) });
    };
    const request = async (older: boolean) => {
        if (closed || (older && (pending || !snapshot.next))) return;
        pending?.controller.abort();
        const current = { controller: new AbortController(), events: [] as ConversationEvent[] };
        pending = current;
        publish({ ...snapshot, loading: true, error: '' });
        try {
            const page = await load(older ? snapshot.next : null, current.controller.signal);
            if (closed || pending !== current) return;
            const initial = older ? [...snapshot.messages, ...page.messages] : page.messages;
            let messages = [
                ...new Map(
                    initial.filter((m) => m.room === room && matches(m)).map((m) => [m.id, m]),
                ).values(),
            ];
            // Events that arrived after this request started win over its snapshot,
            // including edits and deletions of messages not yet loaded.
            for (const event of current.events) messages = apply(messages, event);
            publish({ messages: sorted(messages), next: page.next, loading: false, error: '' });
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
