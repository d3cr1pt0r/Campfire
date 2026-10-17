// Stable aliases also work on platforms without an emoji name API.
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
export function emojiMatches(query: string, custom: { name: string }[]) {
    return [
        ...custom.map(({ name }) => ({ name, value: `:${name}:` })),
        ...Object.entries(aliases)
            .filter(([name]) => !custom.some((c) => c.name === name))
            .map(([name, value]) => ({ name, value })),
    ]
        .filter((item) => item.name.startsWith(query))
        .slice(0, 8);
}
