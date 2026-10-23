import { useMemo, useState } from 'react';
import { emojiGroups } from '../shared/emojis.js';
import { Emoji } from './ChatContent';
import { emojiName, searchEmoji } from './emojiCompletion';
import { recentEmoji, useEmojiUses } from './emojiUsage';

type Custom = { id: string; name: string }[];

// The member's recent emoji, the server's custom ones, then every standard emoji by group.
// Typing searches names and keywords; Enter picks the first result.
export function EmojiPicker({
    custom,
    disabled,
    onPick,
}: {
    custom: Custom;
    disabled?: boolean;
    onPick: (emoji: string) => void;
}) {
    const [query, setQuery] = useState('');
    const uses = useEmojiUses();
    const sections = useMemo(
        () =>
            query.trim()
                ? [{ name: 'Results', emoji: searchEmoji(query, custom) }]
                : [
                      { name: 'Recently used', emoji: recentEmoji(uses, custom) },
                      { name: 'Custom', emoji: custom.map((item) => `:${item.name}:`) },
                      ...emojiGroups.map((group) => ({
                          name: group.name,
                          emoji: group.emoji.map((item) => item.emoji),
                      })),
                  ],
        [query, uses, custom],
    ).filter((section) => section.emoji.length);
    const first = sections[0]?.emoji[0];
    return (
        <div className="emoji-picker-panel">
            <input
                className="emoji-search"
                type="search"
                aria-label="Search emoji"
                placeholder="Search emoji"
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                    if (event.key !== 'Enter' || !first || disabled) return;
                    event.preventDefault();
                    onPick(first);
                }}
            />
            <div className="emoji-picker">
                {sections.map((section) => (
                    <section key={section.name} aria-label={section.name}>
                        <h3>{section.name}</h3>
                        <div className="emoji-grid">
                            {section.emoji.map((emoji) => (
                                <button
                                    key={emoji}
                                    title={emoji.startsWith(':') ? emoji : emojiName(emoji)}
                                    disabled={disabled}
                                    onClick={() => onPick(emoji)}
                                >
                                    <Emoji value={emoji} custom={custom} />
                                </button>
                            ))}
                        </div>
                    </section>
                ))}
                {!sections.length && <p className="emoji-empty">No emoji match “{query}”.</p>}
            </div>
        </div>
    );
}
