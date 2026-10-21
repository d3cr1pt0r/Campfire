# Message formatting — 2026-10-21

## User-facing behavior

- Channel, DM and thread composers, and the Edit message dialog, format text as you type, like Slack. Typing `**bold**`, `*italic*` or `_italic_`, `~~strike~~` or `~strike~`, `` `code` ``, `- ` or `* ` (bulleted list), `1. ` (numbered list), `> ` (quote) or ` ``` ` (code block) converts immediately. Backspace right after a conversion restores the typed characters.
- A formatting toolbar sits at the top of the composer: bold, italic, strikethrough, inline code, code block, bulleted list, numbered list, quote. The **Aa** button hides or shows it; the choice is a per-device preference. The toolbar is one tab stop, with arrow keys moving between buttons.
- Shortcuts: Ctrl/Cmd+B bold, Ctrl/Cmd+I italic, Ctrl/Cmd+Shift+X strikethrough, Ctrl/Cmd+Shift+C inline code, Ctrl/Cmd+Shift+7 numbered list, Ctrl/Cmd+Shift+8 bulleted list, Ctrl/Cmd+Shift+9 quote.
- Lists nest: Tab indents a list item under the one above it and Shift+Tab outdents it; bulleted and numbered lists mix freely across levels. Nested numbered lists show 1. → a. → i. Inside a list, Tab stays in the editor even when the item cannot move.
- Enter sends. Shift+Enter adds a line, continues a list or quote, and leaves it on an empty line (in a nested list, one level at a time). Inside a code block Enter adds a line, Enter on an empty last line leaves the block, and Ctrl/Cmd+Enter sends. Backspace at the start of a list item (outdenting a nested one), quote line or code block removes that formatting.
- Messages render bold, italic, strikethrough, inline code (monospace on a tinted background), code blocks with a copy button, lists and quotes. Code has no syntax colouring. Links, mentions and emoji work inside formatting but not inside code.
- A mention inside code is quoted text: it is not highlighted and does not notify.
- Pasting from other applications inserts plain text with its line breaks; copying and pasting within Campfire keeps formatting. Pasted files still attach.
- Not supported by design: headings, tables, images, raw HTML, masked links (`[text](url)`) and syntax highlighting.

## Storage

Message bodies remain plain text in a small Markdown subset, so the server, database, search and API are unchanged. The editor converts between the stored text and its document on every change; characters that would otherwise read as formatting are backslash-escaped, so text that is typed is stored and rendered literally (`snake_case`, `__init__` and `5 * 3` stay unescaped). Existing messages are parsed the same way, so an older message containing `**word**` now renders bold. Nested list items are indented to the content of their parent item (two spaces under `- `, three under `1. `); when reading, two or more spaces past a marker nest, so loosely indented typing still nests. Lists of one kind that end up adjacent are joined in the editor, because they read back as one list. The 4,000-character limit applies to the stored text, including formatting characters.

## Implementation inventory

- `src/messageFormat.ts`: parser for the stored subset (CommonMark-style flanking rules, escapes, code spans, fenced code, lists, quotes) and the text runs used for mentions.
- `src/richText.ts`: ProseMirror schema, Markdown ⇄ document conversion with a round-trip check and a plain-text fallback for combinations the syntax cannot express, input rules, commands and key bindings, the length limit, plain-text paste and picker emoji appending.
- `src/RichEditor.tsx`: React wrapper around the ProseMirror view, placeholder, paste/drop handling and the formatting toolbar.
- `src/ChatComposer.tsx`, `src/forms.tsx` (`MessageForm`), `src/main.tsx`, `src/ThreadPanel.tsx`: composer and edit dialog integration, mention/emoji suggestions on editor positions, desktop clipboard paste, toolbar preference.
- `src/ChatContent.tsx`, `src/ChatMessages.tsx`: React rendering of formatted messages (no HTML strings).
- `src/notifications.ts`: mention notifications ignore code.
- `src/campfire-theme.css`: formatting, editor and toolbar styles for Ember and Canvas.
- New pinned dependencies: `prosemirror-model`, `-state`, `-view`, `-transform`, `-commands`, `-keymap`, `-history`, `-inputrules`, `-schema-list` (one maintainer; transitive `orderedmap`, `rope-sequence`, `w3c-keyname`). The production bundle grows from 511 kB (160 kB gzip) to 747 kB (234 kB gzip).

## Verification

- `npm run format:check`, `npm run check`, `npm test` (258 passing, including 18 new tests in `test/message-format.test.js` for parsing, round trips, randomized documents, nested lists, Tab/Shift+Tab, input rules, commands, paste and the length limit), `npm run build` and `git diff --check` passed.
- Windows Electron, two clients against a temporary server, typing with real key events: typed Markdown became live formatting, Ctrl+B toggled bold, mention suggestions still completed, the stored body matched the expected Markdown, the second client rendered every element with the name inline with the first line, the composer cleared after sending, the thread composer used the editor with a one-row toolbar, the edit dialog opened formatted, the toolbar toggle persisted, a code mention was not highlighted, Tab/Shift+Tab/Shift+Enter built nested bulleted and numbered lists that were stored as indented Markdown and rendered nested on the other client, and there were no renderer console errors. A separate fuzz run round-tripped 4,000 random nested list documents exactly. Screenshots were checked in Ember and Canvas.
- `scripts/verify-member-messaging.mjs` and its `--roles` mode passed with the composer selectors updated for the editor. On this Windows machine the unmodified member-messaging run stopped at its first `capturePage` with `UnknownVizError`; run through a wrapper that disables Chromium's `CalculateNativeWinOcclusion` feature, every step passed.
