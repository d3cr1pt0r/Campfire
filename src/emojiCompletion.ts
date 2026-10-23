import { emojiGroups } from '../shared/emojis.js';

const entries = emojiGroups.flatMap((group) => group.emoji);
// Short names Campfire offered before the full emoji list; they come before the list's own.
const aliases: Record<string, string> = {
    smile: '😄',
    grinning: '😀',
    laugh: '😆',
    joy: '😂',
    rofl: '🤣',
    wink: '😉',
    blush: '😊',
    heart_eyes: '😍',
    thinking: '🤔',
    sunglasses: '😎',
    cry: '😢',
    sob: '😭',
    angry: '😠',
    scream: '😱',
    sleeping: '😴',
    party: '🥳',
    wave: '👋',
    thumbsup: '👍',
    thumbsdown: '👎',
    clap: '👏',
    pray: '🙏',
    muscle: '💪',
    heart: '❤️',
    broken_heart: '💔',
    fire: '🔥',
    star: '⭐',
    sparkles: '✨',
    eyes: '👀',
    check: '✅',
    x: '❌',
    tada: '🎉',
    rocket: '🚀',
    '100': '💯',
    coffee: '☕',
    beer: '🍺',
    pizza: '🍕',
    skull: '💀',
    sweat_smile: '😅',
    slightly_smiling_face: '🙂',
    raised_hands: '🙌',
    handshake: '🤝',
};
export function emojiQuery(text: string, caret: number) {
    const match = /(?:^|\s):([a-z0-9_+-]*)$/i.exec(text.slice(0, caret));
    return match
        ? { start: caret - match[1].length - 1, end: caret, query: match[1].toLowerCase() }
        : null;
}
const shortcodes = new Map([
    ...entries.flatMap((entry) => entry.shortcodes.map((name) => [name, entry.emoji] as const)),
    ...Object.entries(aliases),
]);
const names = [...new Set([...Object.keys(aliases), ...shortcodes.keys()])];
export function emojiMatches(query: string, custom: { name: string }[]) {
    return [
        ...custom.map(({ name }) => ({ name, value: `:${name}:` })),
        ...names
            .filter((name) => !custom.some((c) => c.name === name))
            .map((name) => ({ name, value: shortcodes.get(name)! })),
    ]
        .filter((item) => item.name.startsWith(query))
        .slice(0, 8);
}

// Picker search: every typed word starts a word of the emoji's name, keywords or short
// names. Exact and leading name matches come first; the rest keep the picker's order.
let searchWords: Map<string, string[]> | undefined;
export function searchEmoji(query: string, custom: { name: string }[]) {
    const terms = query
        .toLowerCase()
        .split(/[\s_:]+/)
        .filter(Boolean);
    if (!terms.length) return [];
    const phrase = terms.join(' '),
        code = terms.join('_');
    searchWords ??= new Map(
        entries.map((entry) => [
            entry.emoji,
            `${entry.name} ${entry.keywords} ${entry.shortcodes.join(' ')}`.split(/[\s_:-]+/),
        ]),
    );
    const matches = (words: string[]) =>
        terms.every((term) => words.some((word) => word.startsWith(term)));
    const rank = (name: string, shortcodes: string[]) =>
        name === phrase || shortcodes.includes(code)
            ? 0
            : name.startsWith(phrase)
              ? 1
              : shortcodes.some((shortcode) => shortcode.startsWith(code))
                ? 2
                : 3;
    return [
        ...custom.filter((item) => matches(item.name.split('_'))).map((item) => `:${item.name}:`),
        ...entries
            .filter((entry) => matches(searchWords!.get(entry.emoji)!))
            .map((entry, order) => ({ entry, order, rank: rank(entry.name, entry.shortcodes) }))
            .sort((a, b) => a.rank - b.rank || a.order - b.order)
            .map(({ entry }) => entry.emoji),
    ];
}
const byEmoji = new Map(entries.map((entry) => [entry.emoji, entry]));
// The short name shown on hover, or the full name when the emoji has none.
export const emojiName = (emoji: string) => {
    const entry = byEmoji.get(emoji);
    return entry ? (entry.shortcodes[0] ? `:${entry.shortcodes[0]}:` : entry.name) : emoji;
};
