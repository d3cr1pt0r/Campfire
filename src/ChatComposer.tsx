import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Emoji } from './ChatContent';
import { emojiQuery, emojiMatches } from './emojiCompletion';
import { mentionQuery, completeMention } from './mentions';
import { Paperclip, X, Plus, Smile, Send } from 'lucide-react';
import { displayName } from './profiles';
import type { User } from './types';

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
    pasteDesktop: (textarea: HTMLTextAreaElement) => Promise<void>;
    onEmoji: () => void;
    onTyping: () => void;
    typing: Record<string, number>;
    user: (id: string) => User | undefined;
    placeholder: string;
    label?: string;
    focusRequest?: number;
    users: User[];
    emojis?: { id: string; name: string; author: string }[];
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
}: Props) {
    const input = useRef<HTMLTextAreaElement>(null);
    useLayoutEffect(() => {
        if (focusRequest !== undefined && canPost) input.current?.focus({ preventScroll: true });
    }, [focusRequest, canPost]);
    useLayoutEffect(() => {
        const textarea = input.current;
        const composer = textarea?.parentElement;
        if (!textarea || !composer) return;
        const resize = () => {
            textarea.style.height = 'auto';
            textarea.style.height = `${textarea.scrollHeight}px`;
        };
        resize();
        let width = composer.clientWidth;
        let frame = 0;
        const observer = new ResizeObserver(() => {
            if (composer.clientWidth === width) return;
            width = composer.clientWidth;
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(resize);
        });
        observer.observe(composer);
        return () => {
            observer.disconnect();
            cancelAnimationFrame(frame);
        };
    }, [draft]);
    const listId = useId();
    const [caret, setCaret] = useState(0);
    const [active, setActive] = useState(0);
    const [focused, setFocused] = useState(false);
    const [composing, setComposing] = useState(false);
    const [dismissed, setDismissed] = useState('');
    const query = !composing && focused && canPost ? mentionQuery(draft, caret) : null;
    const matches =
        query && dismissed !== `${draft}:${caret}`
            ? users
                  .filter((candidate) =>
                      candidate.username.toLowerCase().startsWith(query.query.toLowerCase()),
                  )
                  .sort((a, b) => a.username.localeCompare(b.username))
                  .slice(0, 8)
            : [];
    const emojiSearch =
        !composing && focused && canPost && dismissed !== `${draft}:${caret}`
            ? emojiQuery(draft, caret)
            : null;
    const emojiOptions = emojiSearch ? emojiMatches(emojiSearch.query, emojis) : [];
    const completeEmoji = (option: { value: string }) => {
        if (!emojiSearch) return;
        const text = draft.slice(0, emojiSearch.start) + option.value + ' ' + draft.slice(caret);
        if (text.length > 4000) return;
        const next = emojiSearch.start + option.value.length + 1;
        setDraft(text);
        setCaret(next);
        setDismissed(`${text}:${next}`);
        requestAnimationFrame(() => {
            input.current?.focus();
            input.current?.setSelectionRange(next, next);
        });
    };
    const optionCount = matches.length || emojiOptions.length;
    const chosen = Math.min(active, Math.max(0, optionCount - 1));
    useEffect(() => {
        if (optionCount)
            document.getElementById(`${listId}-${chosen}`)?.scrollIntoView({ block: 'nearest' });
    }, [chosen, listId, optionCount]);
    const complete = (candidate: User) => {
        if (!query) return;
        const result = completeMention(draft, query, candidate.username);
        if (!result) return;
        setDraft(result.text);
        setCaret(result.caret);
        setDismissed(`${result.text}:${result.caret}`);
        requestAnimationFrame(() => {
            input.current?.focus();
            input.current?.setSelectionRange(result.caret, result.caret);
        });
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
            <form className="composer" onSubmit={send}>
                <button
                    type="button"
                    title={
                        canAttach
                            ? 'Attach files (up to 10 files, 5 MB total)'
                            : 'You do not have permission to attach files'
                    }
                    disabled={busy || !canAttach}
                    onClick={() => fileInput.current?.click()}
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
                <textarea
                    ref={input}
                    role="combobox"
                    aria-autocomplete="list"
                    aria-expanded={!!optionCount}
                    aria-controls={optionCount ? listId : undefined}
                    aria-activedescendant={optionCount ? `${listId}-${chosen}` : undefined}
                    onFocus={() => setFocused(true)}
                    onBlur={() => setFocused(false)}
                    onCompositionStart={() => setComposing(true)}
                    onCompositionEnd={() => setComposing(false)}
                    onSelect={(event) => {
                        const next = event.currentTarget.selectionStart;
                        if (next !== caret) {
                            setCaret(next);
                            setActive(0);
                        }
                    }}
                    aria-label={label}
                    placeholder={canPost ? placeholder : 'This conversation is read-only'}
                    value={draft}
                    disabled={!canPost}
                    maxLength={4000}
                    rows={1}
                    onChange={(e) => {
                        setDraft(e.target.value);
                        setCaret(e.target.selectionStart);
                        setActive(0);
                        if (Date.now() - lastTyping.current > 2000) {
                            onTyping();
                            lastTyping.current = Date.now();
                        }
                    }}
                    onPaste={(event) => {
                        const files = Array.from(event.clipboardData.files);
                        if (files.length) {
                            event.preventDefault();
                            addFiles(files);
                        }
                    }}
                    onKeyDown={(e) => {
                        if (e.nativeEvent.isComposing || composing) return;
                        if (optionCount) {
                            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                                e.preventDefault();
                                setActive(
                                    (chosen + (e.key === 'ArrowDown' ? 1 : -1) + optionCount) %
                                        optionCount,
                                );
                                return;
                            }
                            if ((e.key === 'Enter' || e.key === 'Tab') && !e.shiftKey) {
                                e.preventDefault();
                                if (emojiOptions.length) completeEmoji(emojiOptions[chosen]);
                                else complete(matches[chosen]);
                                return;
                            }
                            if (e.key === 'Escape') {
                                e.preventDefault();
                                e.stopPropagation();
                                setDismissed(`${draft}:${caret}`);
                                return;
                            }
                        }
                        if (
                            (e.ctrlKey || e.metaKey) &&
                            !e.altKey &&
                            !e.shiftKey &&
                            e.key.toLowerCase() === 'v' &&
                            window.campfire?.readClipboardAttachments
                        ) {
                            e.preventDefault();
                            void pasteDesktop(e.currentTarget);
                            return;
                        }

                        if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                            e.preventDefault();
                            if (!busy && !e.nativeEvent.isComposing) void send(e);
                        }
                    }}
                />
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
