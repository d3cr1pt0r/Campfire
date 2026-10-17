import React, { useEffect, useRef, useState } from 'react';
import { MessageCircle, Pin, Search, X } from 'lucide-react';
import { ChatMessages } from './ChatMessages';
import { ChatComposer } from './ChatComposer';
import { Emoji } from './ChatContent';
import { useConversation } from './useConversation';
import { displayName } from './profiles';
import type { ApiClient } from './api';
import type { AppSocket, Message, State, User } from './types';
import { validateFileSelection } from '../shared/uploads.js';
import { emojis } from '../shared/emojis.js';

type Props = {
    parent: Message;
    api: ApiClient;
    socket: AppSocket | null;
    state: State;
    permission: (permission: string) => boolean;
    user: (id: string) => User | undefined;
    color: (user?: User) => string | undefined;
    dm: (id: string) => void;
    download: (id: string, name: string) => Promise<void>;
    act: (fn: () => Promise<unknown>) => Promise<void>;
    setModal: (modal: string | null) => void;
    setEdit: (message: Message | null) => void;
    connected: boolean;
    onClose: () => void;
};

export function ThreadPanel(props: Props) {
    const { parent, api, socket, state, permission, user, connected, onClose } = props;
    const [root, setRoot] = useState(parent);
    const [rootError, setRootError] = useState('');
    const [search, setSearch] = useState('');
    const [pins, setPins] = useState(false);
    const [draft, setDraft] = useState('');
    const [attachments, setAttachments] = useState<File[]>([]);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [picker, setPicker] = useState(false);
    const [typing, setTyping] = useState<Record<string, number>>({});
    const fileInput = useRef<HTMLInputElement>(null);
    const lastTyping = useRef(0);
    const sending = useRef(false);
    const selectedFiles = useRef(attachments);
    selectedFiles.current = attachments;
    const mounted = useRef(true);
    const close = useRef(onClose);
    close.current = onClose;
    const canPost =
        permission('messages.send') &&
        permission('threads.reply') &&
        (!!root.replyCount || permission('threads.create'));
    const conversation = useConversation(api, socket, parent.room, true, search, pins, parent.id);

    useEffect(() => {
        mounted.current = true;
        let controller: AbortController | undefined;
        // Live edits/counts received during a fetch take precedence over its snapshot.
        let revision = 0;
        const load = async () => {
            controller?.abort();
            const current = new AbortController();
            controller = current;
            const started = revision;
            try {
                const message = await api<Message>(
                    `/messages/${parent.id}`,
                    'GET',
                    undefined,
                    current.signal,
                );
                if (current.signal.aborted) return;
                if (started === revision) setRoot(message);
                setRootError('');
            } catch (e) {
                if (current.signal.aborted) return;
                if ((e as { status?: number }).status === 404) close.current();
                else setRootError((e as Error).message);
            }
        };
        const update = (message: Message) => {
            if (message.id === parent.id) {
                revision++;
                setRoot(message);
            }
        };
        const remove = (event: { id: string; room: string }) => {
            if (event.id === parent.id && event.room === parent.room) close.current();
        };
        const onTyping = (event: { room: string; user: string; thread?: string | null }) => {
            if (
                event.room === parent.room &&
                event.thread === parent.id &&
                event.user !== state.me.id
            )
                setTyping((previous) => ({ ...previous, [event.user]: Date.now() + 3500 }));
        };
        socket?.on('connect', load);
        socket?.on('message:update', update);
        socket?.on('message:delete', remove);
        socket?.on('typing', onTyping);
        void load();
        const timer = setInterval(
            () =>
                setTyping((previous) =>
                    Object.fromEntries(
                        Object.entries(previous).filter(([, expires]) => expires > Date.now()),
                    ),
                ),
            1500,
        );
        return () => {
            mounted.current = false;
            controller?.abort();
            clearInterval(timer);
            socket?.off('connect', load);
            socket?.off('message:update', update);
            socket?.off('message:delete', remove);
            socket?.off('typing', onTyping);
        };
    }, [api, socket, parent.id, parent.room, state.me.id]);

    const addFiles = (files: File[]) => {
        if (!mounted.current || !canPost || !permission('files.attach') || sending.current) return;
        try {
            const next = [...selectedFiles.current, ...files];
            validateFileSelection(next);
            selectedFiles.current = next;
            setAttachments(next);
        } catch (e) {
            setError((e as Error).message);
        }
    };
    const pasteDesktop = async (textarea: HTMLTextAreaElement) => {
        if (!window.driskord?.readClipboardAttachments || !canPost) return;
        try {
            const clipboard = await window.driskord.readClipboardAttachments();
            if (
                !mounted.current ||
                !textarea.isConnected ||
                textarea.disabled ||
                document.activeElement !== textarea
            )
                return;
            if (clipboard.files.length)
                addFiles(
                    clipboard.files.map(
                        (file) =>
                            new File([new Uint8Array(file.data)], file.name, { type: file.type }),
                    ),
                );
            else if (clipboard.text) document.execCommand('insertText', false, clipboard.text);
        } catch (e) {
            if (mounted.current) setError((e as Error).message);
        }
    };
    const send = async (event: React.FormEvent) => {
        event.preventDefault();
        if (sending.current || !canPost || !connected || (!draft.trim() && !attachments.length))
            return;
        sending.current = true;
        setBusy(true);
        setError('');
        const text = draft;
        const files = [...attachments];
        try {
            validateFileSelection(files);
            const payload = await Promise.all(
                files.map(async (file) => {
                    const data = await new Promise<string>((resolve, reject) => {
                        const reader = new FileReader();
                        reader.onload = () => resolve(String(reader.result).split(',')[1]);
                        reader.onerror = () => reject(new Error('Could not read file'));
                        reader.readAsDataURL(file);
                    });
                    return { name: file.name, data };
                }),
            );
            await api('/messages', 'POST', {
                room: parent.room,
                thread: parent.id,
                body: text,
                attachments: payload,
            });
            if (mounted.current) {
                setDraft((previous) => (previous === text ? '' : previous));
                setAttachments([]);
            }
        } catch (e) {
            if (mounted.current) setError((e as Error).message);
        } finally {
            sending.current = false;
            if (mounted.current) setBusy(false);
        }
    };
    const clearFilters = () => {
        setSearch('');
        setPins(false);
    };
    const threadMessages =
        search || pins ? conversation.messages : [root, ...conversation.messages];
    return (
        <aside
            className="thread-panel"
            aria-label="Message thread"
            onDragOver={(event) => {
                if (event.dataTransfer.types.includes('Files')) {
                    event.preventDefault();
                    event.stopPropagation();
                    event.dataTransfer.dropEffect = canPost && !busy ? 'copy' : 'none';
                }
            }}
            onDrop={(event) => {
                if (event.dataTransfer.types.includes('Files')) {
                    event.preventDefault();
                    event.stopPropagation();
                    addFiles(Array.from(event.dataTransfer.files));
                }
            }}
        >
            <header className="thread-header">
                <MessageCircle size={19} />
                <strong>Thread</strong>
                <span>
                    {root.replyCount || 0} {root.replyCount === 1 ? 'reply' : 'replies'}
                </span>
                <button title="Close thread" aria-label="Close thread" onClick={onClose}>
                    <X size={20} />
                </button>
            </header>
            <div className="thread-tools">
                <label>
                    <Search size={16} />
                    <input
                        aria-label="Search thread"
                        placeholder="Search thread"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                    />
                </label>
                <button
                    title="Pinned replies"
                    aria-label="Pinned replies"
                    aria-pressed={pins}
                    onClick={() => setPins(!pins)}
                >
                    <Pin size={17} />
                </button>
            </div>
            <p className="thread-context">
                Replying to {displayName(user(root.author), 'Former member')}
            </p>
            {rootError && (
                <p className="inline-notice" role="alert">
                    {rootError}
                </p>
            )}
            <ChatMessages
                {...props}
                key={`${search}:${pins}`}
                thread
                conversation={conversation}
                search={search}
                pins={pins}
                currentChannel={state.channels.find((channel) => channel.id === parent.room)}
                dmUser={parent.room.startsWith('dm:') ? state.me : undefined}
                visibleMessages={threadMessages}
                clearFilters={clearFilters}
            />
            {error && (
                <p className="inline-notice" role="alert">
                    {error}
                </p>
            )}
            {picker && (
                <div className="thread-emoji-picker">
                    <button aria-label="Close emoji picker" onClick={() => setPicker(false)}>
                        <X size={16} />
                    </button>
                    <div className="emoji-picker">
                        {[...emojis, ...(state.emojis || []).map((emoji) => `:${emoji.name}:`)].map(
                            (emoji) => (
                                <button
                                    title={emoji}
                                    key={emoji}
                                    disabled={!canPost || busy}
                                    onClick={() => {
                                        setDraft((text) => (text + emoji).slice(0, 4000));
                                        setPicker(false);
                                    }}
                                >
                                    <Emoji value={emoji} custom={state.emojis || []} />
                                </button>
                            ),
                        )}
                    </div>
                </div>
            )}
            <ChatComposer
                canAttach={canPost && permission('files.attach')}
                users={state.users}
                attachments={attachments}
                setAttachments={setAttachments}
                draft={draft}
                setDraft={setDraft}
                busy={busy}
                canPost={canPost}
                connected={connected}
                fileInput={fileInput}
                lastTyping={lastTyping}
                addFiles={addFiles}
                send={send}
                pasteDesktop={pasteDesktop}
                onEmoji={() => setPicker(!picker)}
                onTyping={() => socket?.emit('typing', parent.room, parent.id)}
                typing={typing}
                user={user}
                placeholder="Reply to thread"
                label="Thread reply"
            />
        </aside>
    );
}
