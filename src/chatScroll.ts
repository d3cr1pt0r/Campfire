import type { VirtualItem } from '@tanstack/react-virtual';
import type { Message } from './types';

export type ChatScrollPosition = {
    offset: number;
    atEnd: boolean;
    anchor: { id: string; created: number; offset: number } | null;
    measurements: VirtualItem[];
};

export function needsScrollHistory(position: ChatScrollPosition, messages: Message[]) {
    const anchor = position.anchor;
    if (position.atEnd || !anchor) return false;
    if (!messages.length) return true;
    if (messages.some((message) => message.id === anchor.id)) return false;
    const first = messages[0];
    return (
        first.created > anchor.created || (first.created === anchor.created && first.id > anchor.id)
    );
}

export function restoredScrollOffset(position: ChatScrollPosition, messages: Message[]) {
    if (!position.anchor) return position.offset;
    const sizes = new Map(position.measurements.map((item) => [item.key, item.size]));
    let offset = sizes.get('history-header') ?? 72;
    for (const message of messages) {
        if (
            message.id === position.anchor.id ||
            message.created > position.anchor.created ||
            (message.created === position.anchor.created && message.id > position.anchor.id)
        )
            return Math.max(0, offset + position.anchor.offset);
        offset += sizes.get(message.id) ?? 100 + message.attachments.length * 220;
    }
    return Math.max(0, offset);
}
