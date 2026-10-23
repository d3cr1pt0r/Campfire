import React, { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { ChatComposer } from './ChatComposer';
import { EmojiPicker } from './EmojiPicker';
import { emojiInMessage, recordEmojiUse } from './emojiUsage';
import { messagePayload, type ApiClient } from './api';
import { displayName } from './profiles';
import type { AppSocket, Message, State, User } from './types';
import type { PollTarget } from './PollDialog';
import type { Gif } from './klipy';
import { appendText } from './richText';
import { validateFileSelection } from '../shared/uploads.js';

type ReplyProps = {
    parent: Message;
    api: ApiClient;
    socket: AppSocket | null;
    state: State;
    permission: (permission: string) => boolean;
    user: (id: string) => User | undefined;
    connected: boolean;
    openPoll: (target: PollTarget) => void;
    focusRequest?: number;
    formattingToolbar: boolean;
    setFormattingToolbar: (shown: boolean) => void;
};

// A thread reply box's draft, files, typing and sending, shared by the thread panel
// and the reply box under a short thread.
export function useThreadReply({
    parent,
    api,
    socket,
    state,
    permission,
    connected,
}: Pick<ReplyProps, 'parent' | 'api' | 'socket' | 'state' | 'permission' | 'connected'>) {
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
    const canPost =
        permission('threads.reply') && (!!parent.replyCount || permission('threads.create'));

    useEffect(() => {
        mounted.current = true;
        const onTyping = (event: { room: string; user: string; thread?: string | null }) => {
            if (
                event.room === parent.room &&
                event.thread === parent.id &&
                event.user !== state.me.id
            )
                setTyping((previous) => ({ ...previous, [event.user]: Date.now() + 3500 }));
        };
        socket?.on('typing', onTyping);
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
            clearInterval(timer);
            socket?.off('typing', onTyping);
        };
    }, [socket, parent.id, parent.room, state.me.id]);

    const addFiles = (files: File[]) => {
        if (!mounted.current || !canPost || !permission('files.attach') || sending.current) return;
        try {
            const next = [...selectedFiles.current, ...files];
            validateFileSelection(next, state.maxUploadBytes);
            selectedFiles.current = next;
            setAttachments(next);
        } catch (e) {
            setError((e as Error).message);
        }
    };
    const pasteDesktop = async (target: HTMLElement, insertText: (text: string) => void) => {
        if (!window.campfire?.readClipboardAttachments || !canPost) return;
        try {
            const clipboard = await window.campfire.readClipboardAttachments(state.maxUploadBytes);
            if (
                !mounted.current ||
                !target.isConnected ||
                !target.isContentEditable ||
                document.activeElement !== target
            )
                return;
            if (clipboard.files.length)
                addFiles(
                    clipboard.files.map(
                        (file) =>
                            new File([new Uint8Array(file.data)], file.name, { type: file.type }),
                    ),
                );
            else if (clipboard.text) insertText(clipboard.text);
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
            validateFileSelection(files, state.maxUploadBytes);
            await api(
                '/messages',
                'POST',
                messagePayload({ room: parent.room, thread: parent.id, body: text }, files),
            );
            recordEmojiUse(emojiInMessage(text, state.emojis || []));
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
    const sendGif = (gif: Gif) =>
        void api('/messages', 'POST', {
            room: parent.room,
            thread: parent.id,
            body: gif.send.url,
        }).catch((e: Error) => {
            if (mounted.current) setError(e.message);
        });
    return {
        draft,
        setDraft,
        attachments,
        setAttachments,
        busy,
        error,
        picker,
        setPicker,
        typing,
        fileInput,
        lastTyping,
        canPost,
        addFiles,
        pasteDesktop,
        send,
        sendGif,
    };
}

export function ThreadReplyComposer({
    reply,
    parent,
    socket,
    state,
    permission,
    user,
    connected,
    openPoll,
    focusRequest,
    formattingToolbar,
    setFormattingToolbar,
    placeholder,
    onCancel,
}: Omit<ReplyProps, 'api'> & {
    reply: ReturnType<typeof useThreadReply>;
    placeholder: string;
    onCancel?: () => void;
}) {
    const { canPost, busy } = reply;
    return (
        <>
            {reply.error && (
                <p className="inline-notice" role="alert">
                    {reply.error}
                </p>
            )}
            {reply.picker && (
                <div className="thread-emoji-picker">
                    <EmojiPicker
                        custom={state.emojis || []}
                        disabled={!canPost || busy}
                        onPick={(emoji) => {
                            reply.setDraft((text) => appendText(text, emoji));
                            reply.setPicker(false);
                        }}
                    />
                    <button aria-label="Close emoji picker" onClick={() => reply.setPicker(false)}>
                        <X size={16} />
                    </button>
                </div>
            )}
            <ChatComposer
                focusRequest={focusRequest}
                canAttach={canPost && permission('files.attach')}
                uploadLimit={state.maxUploadBytes}
                users={state.users}
                state={state}
                emojis={state.emojis}
                attachments={reply.attachments}
                setAttachments={reply.setAttachments}
                draft={reply.draft}
                setDraft={reply.setDraft}
                busy={busy}
                canPost={canPost}
                connected={connected}
                fileInput={reply.fileInput}
                lastTyping={reply.lastTyping}
                addFiles={reply.addFiles}
                send={reply.send}
                pasteDesktop={reply.pasteDesktop}
                onEmoji={() => reply.setPicker(!reply.picker)}
                onTyping={() => socket?.emit('typing', parent.room, parent.id)}
                typing={reply.typing}
                user={user}
                placeholder={placeholder}
                label="Thread reply"
                onPoll={(question) => openPoll({ room: parent.room, thread: parent.id, question })}
                klipyKey={state.klipyKey}
                onGif={reply.sendGif}
                formattingToolbar={formattingToolbar}
                setFormattingToolbar={setFormattingToolbar}
                onCancel={onCancel}
            />
        </>
    );
}

// The reply box under a short thread. Once the thread grows past the inline limit it
// opens in the panel instead, and an empty reply box moves there with it.
export function InlineReply({
    collapsed,
    onClose,
    onMoveToPanel,
    ...props
}: ReplyProps & { collapsed: boolean; onClose: () => void; onMoveToPanel: () => void }) {
    const reply = useThreadReply(props);
    const box = useRef<HTMLDivElement>(null);
    const move = useRef(onMoveToPanel);
    move.current = onMoveToPanel;
    const idle = !reply.busy && !reply.draft.trim() && !reply.attachments.length;
    useEffect(() => {
        if (collapsed && idle) move.current();
    }, [collapsed, idle]);
    // The editor focuses without scrolling, so bring the box into view when opened.
    useEffect(() => {
        const frame = requestAnimationFrame(() =>
            box.current?.scrollIntoView({ block: 'nearest' }),
        );
        return () => cancelAnimationFrame(frame);
    }, [props.focusRequest]);
    const author = props.parent.author ? props.user(props.parent.author) : undefined;
    return (
        <div className="inline-reply" ref={box}>
            <div className="inline-reply-box">
                <ThreadReplyComposer
                    {...props}
                    reply={reply}
                    placeholder={`Reply to ${displayName(author, 'Former member')}`}
                    onCancel={onClose}
                />
            </div>
            <button
                className="inline-reply-close"
                title="Close reply"
                aria-label="Close reply"
                onClick={onClose}
            >
                <X size={16} />
            </button>
        </div>
    );
}
