import React from 'react';
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
};
export function ChatComposer({
    attachments,
    setAttachments,
    draft,
    setDraft,
    busy,
    canPost,
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
}: Props) {
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
            <form className="composer" onSubmit={send}>
                <button
                    type="button"
                    title="Attach files (up to 10 files, 5 MB total)"
                    disabled={busy || !canPost}
                    onClick={() => fileInput.current?.click()}
                >
                    <Plus size={22} />
                </button>
                <input
                    type="file"
                    multiple
                    hidden
                    ref={fileInput}
                    onChange={(e) => {
                        addFiles(Array.from(e.target.files || []));
                        e.target.value = '';
                    }}
                />
                <textarea
                    aria-label={label}
                    placeholder={canPost ? placeholder : 'This conversation is read-only'}
                    value={draft}
                    disabled={!canPost}
                    maxLength={4000}
                    rows={1}
                    style={!draft ? { height: 'auto' } : undefined}
                    onChange={(e) => {
                        setDraft(e.target.value);
                        e.target.style.height = 'auto';
                        e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`;
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
                        if (
                            (e.ctrlKey || e.metaKey) &&
                            !e.altKey &&
                            !e.shiftKey &&
                            e.key.toLowerCase() === 'v' &&
                            window.driskord?.readClipboardAttachments
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
            <div className="composer-help">
                {Object.keys(typing).length ? (
                    <span>
                        {Object.keys(typing)
                            .map((id) => displayName(user(id)))
                            .join(', ')}{' '}
                        is typing…
                    </span>
                ) : (
                    <span>
                        <strong>Enter</strong> to send · <strong>Shift + Enter</strong> for a new
                        line
                    </span>
                )}
                <span>
                    {draft.length > 3500
                        ? `${draft.length}/4000`
                        : 'A little hello can go a long way.'}
                </span>
            </div>
        </div>
    );
}
