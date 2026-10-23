import { useSyncExternalStore } from 'react';
import { emojis } from '../shared/emojis.js';
import { messageTexts } from './messageFormat.ts';

// The emoji a member sent or reacted with lately, oldest first, kept on this device for each
// server account. Only the last uses count, so suggestions follow changing habits.
const windowSize = 50;
const fallback = ['👍', '😂', '❤️'];
const standard = new Set(emojis);
type Custom = { name: string }[];

let uses: string[] = [];
let save = (_uses: string[]) => {};
const listeners = new Set<() => void>();
const publish = (next: string[]) => {
    uses = next;
    listeners.forEach((listener) => listener());
};
export function openEmojiUsage(storage: Pick<Storage, 'getItem' | 'setItem'>, key: string) {
    let saved: unknown = [];
    try {
        saved = JSON.parse(storage.getItem(key) || '[]');
    } catch {}
    save = (next) => storage.setItem(key, JSON.stringify(next));
    publish(
        Array.isArray(saved)
            ? saved.filter((emoji) => typeof emoji === 'string').slice(-windowSize)
            : [],
    );
}
export function recordEmojiUse(used: string[]) {
    if (!used.length) return;
    const next = [...uses, ...used].slice(-windowSize);
    save(next);
    publish(next);
}
export const useEmojiUses = () =>
    useSyncExternalStore(
        (listener) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        () => uses,
    );

// Custom emoji can be deleted after they were used.
const available = (uses: string[], custom: Custom) =>
    uses.filter(
        (emoji) => standard.has(emoji) || custom.some((item) => `:${item.name}:` === emoji),
    );
// The most used emoji in the window, ties going to the latest. Common reactions fill the rest.
export function frequentEmoji(uses: string[], custom: Custom, count = 3) {
    const scores = new Map<string, { count: number; last: number }>();
    available(uses, custom).forEach((emoji, index) =>
        scores.set(emoji, { count: (scores.get(emoji)?.count ?? 0) + 1, last: index }),
    );
    const ranked = [...scores]
        .sort(([, a], [, b]) => b.count - a.count || b.last - a.last)
        .map(([emoji]) => emoji);
    return [...new Set([...ranked, ...fallback])].slice(0, count);
}
// Distinct emoji, the latest first.
export const recentEmoji = (uses: string[], custom: Custom, count = 16) =>
    [...new Set(available(uses, custom).reverse())].slice(0, count);

// The standard and custom emoji in a sent message, once each, ignoring code.
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
export function emojiInMessage(text: string, custom: Custom) {
    const found: string[] = [];
    for (const part of messageTexts(text)) {
        for (const { segment } of graphemes.segment(part))
            if (standard.has(segment)) found.push(segment);
        for (const [token, name] of part.matchAll(/:([a-z0-9_]{2,32}):/g))
            if (custom.some((item) => item.name === name)) found.push(token);
    }
    return [...new Set(found)];
}
