import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { EditorState } from 'prosemirror-state';
import { Emoji } from './ChatContent';
import { emojiQuery, emojiMatches } from './emojiCompletion';
import { mentionQuery, completeMention } from './mentions';
import { CaseSensitive, Paperclip, X, Plus, Smile, Send, Vote } from 'lucide-react';
import { pollCommand } from './polls';
import { displayName } from './profiles';
import { FormattingToolbar, RichEditor, type RichEditorHandle } from './RichEditor';
import { inCodeBlock } from './richText';
import type { User } from './types';

// The text around the caret, for mention and emoji suggestions.
type Caret = { text: string; offset: number; start: number; head: number; code: boolean };
const caretAt = (state: EditorState): Caret | null => {
    const { $head, empty } = state.selection;
    if (!empty) return null;
    return {
        text: $head.parent.textContent,
        offset: $head.parentOffset,
        start: $head.start(),
        head: $head.pos,
        code: !!$head.parent.type.spec.code || $head.marks().some((mark) => !!mark.type.spec.code),
    };
};

type Props = {
    attachments: File[];
    setAttachments: React.Dispatch<React.SetStateAction<File[]>>;
    draft: string;
    setDraft: React.Dispatch<React.SetStateAction<string>>;
    busy: boolean;
    canPost: boolean;
    canAttach: boolean;
    connected: boolean;
    fileInput: React.RefObject<HTMLInputElement | null>;
    lastTyping: React.RefObject<number>;
    addFiles: (files: File[]) => void;
    send: (e: React.FormEvent) => Promise<void>;
    pasteDesktop: (target: HTMLElement, insertText: (text: string) => void) => Promise<void>;
    onEmoji: () => void;
    onTyping: () => void;
    typing: Record<string, number>;
    user: (id: string) => User | undefined;
    placeholder: string;
    label?: string;
    focusRequest?: number;
    users: User[];
    emojis?: { id: string; name: string; author: string | null }[];
    // Opens the poll dialog, with a question when typed as "/poll Question".
    onPoll?: (question: string) => void;
    formattingToolbar: boolean;
    setFormattingToolbar: (shown: boolean) => void;
};
export function ChatComposer({
    attachments,
    setAttachments,
    draft,
    setDraft,
    busy,
    canPost,
    canAttach,
    connected,
    fileInput,
    lastTyping,
    addFiles,
    send,
    pasteDesktop,
    onEmoji,
    onTyping,
    typing,
    user,
    placeholder,
    label = 'Message',
    focusRequest,
    users,
    emojis = [],
    onPoll,
    formattingToolbar,
    setFormattingToolbar,
}: Props) {
    const editor = useRef<RichEditorHandle>(null);
    const form = useRef<HTMLFormElement>(null);
    const addButton = useRef<HTMLButtonElement>(null);
    const menu = useRef<HTMLDivElement>(null);
    const [menuOpen, setMenuOpen] = useState(false);
    const canPoll = !!onPoll && canPost;
    const menuItems = () => [
        ...(menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ||
            []),
    ];
    useEffect(() => {
        if (!menuOpen) return;
        menuItems()[0]?.focus();
        const close = (event: MouseEvent) => {
            const target = event.target as Node;
            if (!menu.current?.contains(target) && !addButton.current?.contains(target))
                setMenuOpen(false);
        };
        document.addEventListener('mousedown', close);
        return () => document.removeEventListener('mousedown', close);
    }, [menuOpen]);
    const closeMenu = () => {
        setMenuOpen(false);
        addButton.current?.focus();
    };
    const submit = (event: React.FormEvent) => {
        const question = onPoll ? pollCommand(draft) : null;
        if (question === null) return send(event);
        event.preventDefault();
        setDraft('');
        onPoll?.(question);
    };
    useLayoutEffect(() => {
        if (focusRequest !== undefined && canPost) editor.current?.focus();
    }, [focusRequest, canPost]);
    const listId = useId();
    const [caret, setCaret] = useState<Caret | null>(null);
    const [editorState, setEditorState] = useState<EditorState | null>(null);
    const [active, setActive] = useState(0);
    const [focused, setFocused] = useState(false);
    const [composing, setComposing] = useState(false);
    const [dismissed, setDismissed] = useState('');
    const suggesting = !composing && focused && canPost && !!caret && !caret.code;
    const caretKey = caret ? `${caret.text}:${caret.head}` : '';
    const query = suggesting ? mentionQuery(caret.text, caret.offset) : null;
    const matches =
        query && dismissed !== caretKey
            ? users
                  .filter((candidate) =>
                      candidate.username.toLowerCase().startsWith(query.query.toLowerCase()),
                  )
                  .sort((a, b) => a.username.localeCompare(b.username))
                  .slice(0, 8)
            : [];
    const emojiSearch =
        suggesting && dismissed !== caretKey ? emojiQuery(caret.text, caret.offset) : null;
    const emojiOptions = emojiSearch ? emojiMatches(emojiSearch.query, emojis) : [];
    const completeEmoji = (option: { value: string }) => {
        if (!emojiSearch || !caret) return;
        const insertion = option.value + ' ';
        const text =
            caret.text.slice(0, emojiSearch.start) + insertion + caret.text.slice(caret.offset);
        setDismissed(`${text}:${caret.start + emojiSearch.start + insertion.length}`);
        editor.current?.replace(caret.start + emojiSearch.start, caret.head, insertion);
    };
    const optionCount = matches.length || emojiOptions.length;
    const chosen = Math.min(active, Math.max(0, optionCount - 1));
    useEffect(() => {
        if (optionCount)
            document.getElementById(`${listId}-${chosen}`)?.scrollIntoView({ block: 'nearest' });
    }, [chosen, listId, optionCount]);
    const complete = (candidate: User) => {
        if (!query || !caret) return;
        const result = completeMention(caret.text, query, candidate.username);
        if (!result) return;
        setDismissed(`${result.text}:${caret.start + result.caret}`);
        editor.current?.replace(
            caret.start + query.start,
            caret.start + query.end,
            `@${candidate.username} `,
        );
    };
    const onKey = (e: KeyboardEvent, state: EditorState) => {
        if (e.isComposing || composing) return false;
        if (optionCount) {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                setActive((chosen + (e.key === 'ArrowDown' ? 1 : -1) + optionCount) % optionCount);
                return true;
            }
            if ((e.key === 'Enter' || e.key === 'Tab') && !e.shiftKey) {
                if (emojiOptions.length) completeEmoji(emojiOptions[chosen]);
                else complete(matches[chosen]);
                return true;
            }
            if (e.key === 'Escape') {
                e.stopPropagation();
                setDismissed(caretKey);
                return true;
            }
        }
        if (
            (e.ctrlKey || e.metaKey) &&
            !e.altKey &&
            !e.shiftKey &&
            e.key.toLowerCase() === 'v' &&
            window.campfire?.readClipboardAttachments
        ) {
            void pasteDesktop(e.currentTarget as HTMLElement, (text) =>
                editor.current?.insertText(text),
            );
            return true;
        }
        // Enter sends; inside a code block it adds a line unless Ctrl/Cmd is held.
        if (e.key === 'Enter' && !e.shiftKey && !e.altKey) {
            if (!e.ctrlKey && !e.metaKey && inCodeBlock(state)) return false;
            if (!busy) form.current?.requestSubmit();
            return true;
        }
        return false;
    };
    return (
        <div className="composer-wrap">
            {attachments.map((file, index) => (
                <div className="attachment-preview" key={`${index}:${file.name}`}>
                    <Paperclip size={15} />
                    {file.name}
                    <small>{Math.ceil(file.size / 1024)} KB</small>
                    <button
                        disabled={busy}
                        onClick={() =>
                            setAttachments((previous) => previous.filter((_, i) => i !== index))
                        }
                        aria-label={`Remove ${file.name}`}
                    >
                        <X size={15} />
                    </button>
                </div>
            ))}
            {!!matches.length && (
                <div
                    className="mention-suggestions"
                    id={listId}
                    role="listbox"
                    aria-label="Mention a user"
                >
                    {matches.map((candidate, index) => (
                        <button
                            type="button"
                            key={candidate.id}
                            id={`${listId}-${index}`}
                            role="option"
                            aria-selected={chosen === index}
                            tabIndex={-1}
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => complete(candidate)}
                        >
                            <strong>@{candidate.username}</strong>
                            <span>{displayName(candidate)}</span>
                        </button>
                    ))}
                </div>
            )}
            {!!emojiOptions.length && (
                <div
                    className="mention-suggestions"
                    id={listId}
                    role="listbox"
                    aria-label="Choose an emoji"
                >
                    {emojiOptions.map((option, index) => (
                        <button
                            type="button"
                            key={option.name}
                            id={`${listId}-${index}`}
                            role="option"
                            aria-selected={chosen === index}
                            tabIndex={-1}
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => completeEmoji(option)}
                        >
                            <Emoji value={option.value} custom={emojis} />
                            <span>:{option.name}:</span>
                        </button>
                    ))}
                </div>
            )}
            {menuOpen && (
                <div
                    className="composer-menu"
                    role="menu"
                    aria-label="Add to message"
                    ref={menu}
                    onKeyDown={(event) => {
                        const items = menuItems();
                        const index = items.indexOf(document.activeElement as HTMLButtonElement);
                        if (event.key === 'Escape') {
                            event.preventDefault();
                            event.stopPropagation();
                            closeMenu();
                        }
                        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                            event.preventDefault();
                            const step = event.key === 'ArrowDown' ? 1 : -1;
                            items[(index + step + items.length) % items.length]?.focus();
                        }
                    }}
                    onBlur={(event) => {
                        if (!menu.current?.contains(event.relatedTarget as Node))
                            setMenuOpen(false);
                    }}
                >
                    <button
                        type="button"
                        role="menuitem"
                        disabled={!canAttach}
                        title={
                            canAttach
                                ? 'Up to 10 files, 5 MB total'
                                : 'You do not have permission to attach files'
                        }
                        onClick={() => {
                            setMenuOpen(false);
                            fileInput.current?.click();
                        }}
                    >
                        <Paperclip size={17} />
                        Upload files
                    </button>
                    {onPoll && (
                        <button
                            type="button"
                            role="menuitem"
                            disabled={!canPoll}
                            onClick={() => {
                                setMenuOpen(false);
                                onPoll('');
                            }}
                        >
                            <Vote size={17} />
                            Create poll
                        </button>
                    )}
                </div>
            )}
            <form className="composer" ref={form} onSubmit={submit}>
                {formattingToolbar && canPost && editorState && (
                    <FormattingToolbar
                        state={editorState}
                        disabled={!canPost}
                        run={(command) => editor.current?.run(command)}
                    />
                )}
                <button
                    type="button"
                    className="composer-add"
                    ref={addButton}
                    title="Add files or a poll"
                    aria-label="Add files or a poll"
                    aria-haspopup="menu"
                    aria-expanded={menuOpen}
                    disabled={busy || (!canAttach && !canPoll)}
                    onClick={() => setMenuOpen((open) => !open)}
                >
                    <Plus size={22} />
                </button>
                <input
                    type="file"
                    disabled={!canAttach}
                    multiple
                    hidden
                    ref={fileInput}
                    onChange={(e) => {
                        addFiles(Array.from(e.target.files || []));
                        e.target.value = '';
                    }}
                />
                <RichEditor
                    ref={editor}
                    className="composer-input"
                    value={draft}
                    label={label}
                    placeholder={canPost ? placeholder : 'This conversation is read-only'}
                    disabled={!canPost}
                    attributes={{
                        'aria-autocomplete': 'list',
                        'aria-controls': optionCount ? listId : undefined,
                        'aria-activedescendant': optionCount ? `${listId}-${chosen}` : undefined,
                    }}
                    onChange={(markdown) => {
                        setDraft(markdown);
                        if (Date.now() - lastTyping.current > 2000) {
                            onTyping();
                            lastTyping.current = Date.now();
                        }
                    }}
                    onState={(state) => {
                        const next = caretAt(state);
                        if (next?.head !== caret?.head) setActive(0);
                        setCaret(next);
                        setEditorState(state);
                    }}
                    onFocusChange={setFocused}
                    onCompositionChange={setComposing}
                    onFiles={addFiles}
                    onKey={onKey}
                />
                <button
                    type="button"
                    title={formattingToolbar ? 'Hide formatting' : 'Show formatting'}
                    aria-label="Formatting toolbar"
                    aria-pressed={formattingToolbar}
                    disabled={!canPost}
                    onClick={() => setFormattingToolbar(!formattingToolbar)}
                >
                    <CaseSensitive size={21} />
                </button>
                <button
                    type="button"
                    title="Add emoji"
                    disabled={!canPost || busy}
                    onClick={onEmoji}
                >
                    <Smile size={21} />
                </button>
                <button
                    className="send-button"
                    type="submit"
                    title="Send message"
                    disabled={
                        busy || !connected || !canPost || (!draft.trim() && !attachments.length)
                    }
                >
                    <Send size={18} />
                </button>
            </form>
            {(Object.keys(typing).length > 0 || draft.length > 3500) && (
                <div className="composer-help">
                    {Object.keys(typing).length > 0 && (
                        <span>
                            {Object.keys(typing)
                                .map((id) => displayName(user(id)))
                                .join(', ')}{' '}
                            is typing…
                        </span>
                    )}
                    {draft.length > 3500 && <span>{draft.length}/4000</span>}
                </div>
            )}
        </div>
    );
}
