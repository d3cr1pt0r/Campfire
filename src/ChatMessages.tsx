import { messageAvatarMode, type MessageAvatarMode } from './messageAppearance';
import { VoiceInviteCard } from './VoiceInviteCard';
import { ReactionChip } from './ReactionChip';
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { defaultRangeExtractor, useVirtualizer } from '@tanstack/react-virtual';
import type { State, User, Message, MessageJump } from './types';
import type { ApiClient } from './api';

import { Avatar } from './Avatar';
import { displayName } from './profiles';
import { roleText } from './theme';
import type { useConversation } from './useConversation';
import {
    MessageCircle,
    Flame,
    Shield,
    Pin,
    Search,
    Paperclip,
    Download,
    Smile,
    Pencil,
    Trash2,
    Reply,
    TimerOff,
    Hourglass,
    ImageOff,
    FileX,
} from 'lucide-react';
import { PollCard } from './PollCard';
import { ChatContent, Emoji } from './ChatContent';
import { frequentEmoji, recordEmojiUse, useEmojiUses } from './emojiUsage';
import { ImageAttachment } from './ImageAttachment';
import { LinkPreviews } from './LinkPreviews';
import { needsScrollHistory, restoredScrollOffset, type ChatScrollPosition } from './chatScroll';
import { conversationSchedule, hasFiles, messageRetention, pinKeeps, unpinText } from './retention';
import type { RetentionUnit } from '../shared/retention.js';

// 24-hour clock, e.g. 09:58.
const messageTime = (created: number) =>
    new Date(created).toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
    });

export function ChatMessages(
    props: Omit<React.ComponentProps<typeof ChatMessageList>, 'saved' | 'save'> & {
        scrollMemory?: Map<string, ChatScrollPosition>;
        scrollKey?: string;
    },
) {
    const { scrollMemory, scrollKey, ...listProps } = props;
    const [saved] = useState(() => (scrollKey ? scrollMemory?.get(scrollKey) : undefined));
    const { conversation, visibleMessages } = props;
    const waiting =
        !props.jump &&
        !!saved &&
        !saved.atEnd &&
        !conversation.error &&
        (!conversation.loaded ||
            (!!conversation.next && needsScrollHistory(saved, visibleMessages)));
    useEffect(() => {
        if (waiting && conversation.loaded && !conversation.loading) void conversation.loadOlder();
    }, [
        waiting,
        conversation.loaded,
        conversation.loading,
        conversation.loadOlder,
        visibleMessages,
    ]);
    if (waiting)
        return (
            <div className="messages" role="status">
                Restoring reading position…
            </div>
        );
    return (
        <ChatMessageList
            {...listProps}
            saved={props.jump ? undefined : saved}
            save={(position) => {
                if (scrollKey) scrollMemory?.set(scrollKey, position);
            }}
        />
    );
}

function ChatMessageList({
    permission,
    conversation,
    search,
    pins,
    dmUser,
    currentChannel,
    visibleMessages,
    user,
    color,
    state,
    dm,
    download,
    act,
    api,
    setModal,
    setEdit,
    clearFilters,
    onReply,
    messageAvatars,
    showRoleColors,
    currentVoiceChannel,
    onJoinVoice,
    thread = false,
    notify,
    retentionUnit,
    saved,
    save,
    jump,
    onJumpShown,
    onJumpFailed,
}: {
    jump?: MessageJump;
    onJumpShown?: (request: number, visible: string[]) => Promise<string[]>;
    onJumpFailed?: (request: number, error: Error) => void;
    messageAvatars?: MessageAvatarMode;
    showRoleColors?: boolean;
    notify?: (text: string) => void;
    // Thread replies share the clock of the thread they belong to.
    retentionUnit?: RetentionUnit;
    saved?: ChatScrollPosition;
    save: (position: ChatScrollPosition) => void;
    currentVoiceChannel?: string | null;
    onJoinVoice?: (channel: string) => void;
    onReply?: (message: Message) => void;
    thread?: boolean;
    permission: (permission: string) => boolean;
    conversation: ReturnType<typeof useConversation>;
    search: string;
    pins: boolean;
    dmUser?: User;
    currentChannel?: State['channels'][number];
    visibleMessages: Message[];
    user: (id: string) => User | undefined;
    color: (user?: User) => string | undefined;
    state: State;
    dm: (id: string) => void;
    download: (id: string, name: string) => Promise<void>;
    act: (fn: () => Promise<unknown>) => Promise<void>;
    api: ApiClient;
    setModal: (modal: string | null) => void;
    setEdit: (message: Message | null) => void;
    clearFilters: () => void;
}) {
    const scroll = useRef<HTMLDivElement>(null);
    const initialized = useRef(false);
    const [focusedId, setFocusedId] = useState<string | null>(null);
    const [ping, setPing] = useState<{ request: number; ids: string[] } | null>(null);
    const completedJump = useRef(0);
    const virtualizer = useVirtualizer({
        count: visibleMessages.length + 1,
        getScrollElement: useCallback(() => scroll.current, []),
        getItemKey: useCallback(
            (index: number) => (index === 0 ? 'history-header' : visibleMessages[index - 1].id),
            [visibleMessages],
        ),
        estimateSize: useCallback(
            (index: number) =>
                index === 0 ? 72 : 100 + visibleMessages[index - 1].attachments.length * 220,
            [visibleMessages],
        ),
        overscan: 5,
        initialMeasurementsCache: saved?.measurements,
        initialOffset: () =>
            saved && !saved.atEnd ? restoredScrollOffset(saved, visibleMessages) : 0,
        useAnimationFrameWithResizeObserver: true,
        anchorTo: 'end',
        followOnAppend: !jump && !conversation.newer,
        scrollEndThreshold: 80,
        rangeExtractor: (range) => {
            const indexes = defaultRangeExtractor(range);
            const focused = focusedId
                ? visibleMessages.findIndex((m) => m.id === focusedId) + 1
                : -1;
            const target = jump ? visibleMessages.findIndex((m) => m.id === jump.id) + 1 : -1;
            return [
                ...new Set([...indexes, ...[focused, target].filter((index) => index > 0)]),
            ].sort((a, b) => a - b);
        },
    });
    // Measurements above the reading position must compensate even while
    // scrolling upward. A partially visible row grows below that position.
    virtualizer.shouldAdjustScrollPositionOnItemSizeChange = (item, _delta, instance) =>
        item.end <= (instance.scrollOffset || 0);
    useLayoutEffect(() => {
        if (!initialized.current && visibleMessages.length) {
            initialized.current = true;
            if (!jump && (!saved || saved.atEnd) && !search && !pins) virtualizer.scrollToEnd();
        }
    }, [visibleMessages.length, virtualizer, search, pins, saved, jump]);
    useLayoutEffect(() => {
        if (!jump || completedJump.current === jump.request || conversation.loading) return;
        const index = visibleMessages.findIndex((message) => message.id === jump.id);
        if (conversation.error || (conversation.loaded && index < 0)) {
            completedJump.current = jump.request;
            onJumpFailed?.(
                jump.request,
                new Error(
                    conversation.error || 'This notification message is no longer available.',
                ),
            );
            return;
        }
        if (!conversation.loaded) return;
        let frame = 0,
            attempts = 0;
        const reveal = () => {
            virtualizer.scrollToIndex(index + 1, { align: 'center' });
            frame = requestAnimationFrame(() => {
                const node = scroll.current?.querySelector<HTMLElement>(
                    `[data-message-id="${CSS.escape(jump.id)}"]`,
                );
                const bounds = node?.getBoundingClientRect(),
                    viewport = scroll.current?.getBoundingClientRect();
                if (
                    bounds &&
                    viewport &&
                    bounds.bottom > viewport.top &&
                    bounds.top < viewport.bottom
                ) {
                    completedJump.current = jump.request;
                    setPing({ request: jump.request, ids: [jump.id] });
                    const visible = [
                        ...(scroll.current?.querySelectorAll<HTMLElement>(
                            '.virtual-message[data-message-id]',
                        ) ?? []),
                    ]
                        .filter((row) => {
                            const bounds = row.querySelector('.message')?.getBoundingClientRect();
                            return (
                                bounds &&
                                bounds.bottom > Math.max(viewport.top, 0) &&
                                bounds.top < Math.min(viewport.bottom, window.innerHeight) &&
                                bounds.right > Math.max(viewport.left, 0) &&
                                bounds.left < Math.min(viewport.right, window.innerWidth)
                            );
                        })
                        .map((row) => row.dataset.messageId!);
                    void onJumpShown?.(jump.request, visible).then((ids) => {
                        if (!ids.length) return;
                        setPing((current) =>
                            current?.request === jump.request
                                ? { ...current, ids: [...new Set([...current.ids, ...ids])] }
                                : current,
                        );
                    });
                } else if (++attempts < 60) reveal();
                else {
                    completedJump.current = jump.request;
                    onJumpFailed?.(
                        jump.request,
                        new Error('Unable to show the notification message.'),
                    );
                }
            });
        };
        reveal();
        return () => {
            cancelAnimationFrame(frame);
        };
    }, [
        jump?.id,
        jump?.request,
        conversation.loaded,
        conversation.loading,
        conversation.error,
        visibleMessages,
        virtualizer,
        onJumpShown,
        onJumpFailed,
    ]);
    useEffect(() => {
        if (!ping) return;
        const timer = window.setTimeout(() => setPing(null), 2000);
        return () => window.clearTimeout(timer);
    }, [ping]);
    const remember = useRef(() => {});
    remember.current = () => {
        const element = scroll.current;
        if (!initialized.current || !element || !conversation.loaded || conversation.error) return;
        const offset = element.scrollTop;
        const item = virtualizer.getVirtualItems().find((item) => item.end > offset);
        const message = item && item.index > 0 ? visibleMessages[item.index - 1] : undefined;
        save({
            offset,
            atEnd: element.scrollHeight - element.clientHeight - offset <= 80,
            anchor:
                message && item
                    ? { id: message.id, created: message.created, offset: offset - item.start }
                    : null,
            measurements: virtualizer.takeSnapshot(),
        });
    };
    // Capture before React detaches the scroll element. Keep measurements with
    // the reading anchor so remounting can restore variable-height rows.
    useLayoutEffect(() => () => remember.current(), []);
    const loadOlder = () => {
        if (
            initialized.current &&
            scroll.current &&
            scroll.current.scrollTop < 400 &&
            conversation.next &&
            !conversation.loading &&
            !conversation.error
        )
            void conversation.loadOlder();
    };
    if (!currentChannel && !dmUser)
        return (
            <div className="messages">
                <p>No text channels are available for your role.</p>
            </div>
        );
    return (
        <div
            className="messages"
            ref={scroll}
            tabIndex={0}
            onScroll={loadOlder}
            aria-label="Message history"
        >
            <div className="virtual-messages" style={{ height: virtualizer.getTotalSize() }}>
                {virtualizer.getVirtualItems().map((item) =>
                    item.index === 0 ? (
                        <div
                            key={item.key}
                            ref={virtualizer.measureElement}
                            data-index={item.index}
                            className="virtual-message"
                            style={{ transform: `translateY(${item.start}px)` }}
                        >
                            {conversation.error && (
                                <div className="inline-notice" role="alert">
                                    {conversation.error}
                                    <button
                                        className="secondary"
                                        onClick={() =>
                                            void (conversation.next
                                                ? conversation.loadOlder()
                                                : conversation.reload())
                                        }
                                    >
                                        Retry loading messages
                                    </button>
                                </div>
                            )}
                            {conversation.next && (
                                <div className="history-loading" role="status">
                                    {conversation.loading
                                        ? 'Loading older messages…'
                                        : 'Scroll up for older messages'}
                                </div>
                            )}
                            {conversation.loading && !visibleMessages.length && (
                                <p className="inline-notice" role="status">
                                    Loading messages…
                                </p>
                            )}
                            {!thread && !search && !pins && !conversation.next && (
                                <div className="channel-welcome">
                                    <div className="welcome-hash">
                                        {dmUser ? <MessageCircle size={40} /> : <Flame size={43} />}
                                    </div>
                                    <span className="mini-label">
                                        {dmUser ? 'DIRECT MESSAGE' : 'A PLACE FOR YOUR PEOPLE'}
                                    </span>
                                    <h1>
                                        {dmUser
                                            ? dmUser.id === state.me.id
                                                ? 'Your personal space.'
                                                : `Say hello to ${displayName(dmUser)}.`
                                            : `Welcome to #${currentChannel?.name || 'general'}`}
                                    </h1>
                                    <p>
                                        {dmUser
                                            ? dmUser.id === state.me.id
                                                ? 'Save notes, links, and files here. Only you can see this conversation.'
                                                : 'Your direct conversation starts here.'
                                            : 'Settle in. Swap stories. Stay for one more.'}
                                    </p>
                                    <div className="welcome-line">
                                        <span>
                                            <Shield size={14} /> Hosted on your server
                                        </span>
                                        <i />{' '}
                                        {dmUser?.id === state.me.id
                                            ? 'Only you'
                                            : 'Only your community'}
                                    </div>
                                </div>
                            )}
                            {pins && (
                                <div className="filter-heading">
                                    <Pin size={18} />
                                    <span>
                                        Pinned messages{search ? ` matching “${search}”` : ''}
                                    </span>
                                    <button className="secondary" onClick={clearFilters}>
                                        Clear filters
                                    </button>
                                </div>
                            )}
                            {search && !pins && (
                                <div className="filter-heading">
                                    <Search size={18} />
                                    <span>
                                        Results for “{search}” <small>in this conversation</small>
                                    </span>
                                    <button className="secondary" onClick={clearFilters}>
                                        Clear search
                                    </button>
                                </div>
                            )}
                        </div>
                    ) : (
                        (() => {
                            const i = item.index - 1;
                            const m = visibleMessages[i];
                            const previous = visibleMessages[i - 1];
                            const date = new Date(m.created).toDateString();
                            const showDate =
                                !previous || new Date(previous.created).toDateString() !== date;
                            // Rows in the same minute as the one above leave the time out.
                            const showTime =
                                !previous ||
                                showDate ||
                                messageTime(previous.created) !== messageTime(m.created);
                            return (
                                <div
                                    key={item.key}
                                    ref={virtualizer.measureElement}
                                    data-index={item.index}
                                    data-message-id={m.id}
                                    className={`virtual-message ${ping?.ids.includes(m.id) ? 'message-ping' : ''}`}
                                    style={{ transform: `translateY(${item.start}px)` }}
                                    onFocusCapture={() => setFocusedId(m.id)}
                                    onBlurCapture={(event) => {
                                        if (!event.currentTarget.contains(event.relatedTarget))
                                            setFocusedId(null);
                                    }}
                                >
                                    {showDate && (
                                        <div className="date-divider">
                                            <span>
                                                {new Date(m.created).toLocaleDateString('en-US', {
                                                    month: 'long',
                                                    day: 'numeric',
                                                    year: 'numeric',
                                                })}
                                            </span>
                                        </div>
                                    )}
                                    <ChatMessage
                                        message={m}
                                        showTime={showTime}
                                        permission={permission}
                                        state={state}
                                        user={user}
                                        color={color}
                                        dm={dm}
                                        download={download}
                                        act={act}
                                        api={api}
                                        setModal={setModal}
                                        setEdit={setEdit}
                                        onReply={onReply}
                                        thread={thread}
                                        notify={notify}
                                        retentionUnit={retentionUnit}
                                        messageAvatars={messageAvatars}
                                        showRoleColors={showRoleColors}
                                        currentVoiceChannel={currentVoiceChannel}
                                        onJoinVoice={onJoinVoice}
                                    />
                                </div>
                            );
                        })()
                    ),
                )}
            </div>
            {(search || pins) &&
                !conversation.loading &&
                !conversation.error &&
                !visibleMessages.length && (
                    <div className="empty-state compact">
                        <Search size={30} />
                        <h3>{pins ? 'No pinned messages yet.' : 'No matching messages.'}</h3>
                    </div>
                )}
            {!!visibleMessages.length && (conversation.newer || !virtualizer.isAtEnd()) && (
                <button
                    className="jump-latest secondary"
                    onClick={() => {
                        if (conversation.newer)
                            void conversation.loadLatest().then(() => virtualizer.scrollToEnd());
                        else virtualizer.scrollToEnd();
                    }}
                >
                    Jump to latest
                </button>
            )}
        </div>
    );
}

export function ChatMessage({
    message: m,
    permission,
    state,
    user,
    color,
    dm,
    download,
    act,
    api,
    setModal,
    setEdit,
    onReply,
    messageAvatars,
    showRoleColors,
    currentVoiceChannel,
    onJoinVoice,
    thread = false,
    notify,
    retentionUnit,
    showTime = true,
}: Pick<
    React.ComponentProps<typeof ChatMessageList>,
    | 'messageAvatars'
    | 'showRoleColors'
    | 'currentVoiceChannel'
    | 'onJoinVoice'
    | 'permission'
    | 'state'
    | 'user'
    | 'color'
    | 'dm'
    | 'download'
    | 'act'
    | 'api'
    | 'setModal'
    | 'setEdit'
    | 'onReply'
    | 'thread'
    | 'notify'
    | 'retentionUnit'
> & { message: Message; showTime?: boolean }) {
    const u = m.author ? user(m.author) : undefined;
    const avatars = messageAvatarMode(messageAvatars);
    const now = Date.now();
    const schedule = conversationSchedule(state, m.room),
        unit = retentionUnit ?? m.retention,
        files = hasFiles(m);
    const retention = messageRetention(schedule, unit, m.created, Boolean(m.pinned), now, files);
    const custom = state.emojis || [];
    const quickReactions = frequentEmoji(useEmojiUses(), custom);
    const reacted = (emoji: string) =>
        m.reactions.some((r) => r.emoji === emoji && r.user === state.me.id);
    // Adding a reaction counts as using the emoji; taking one back does not.
    const react = (emoji: string) => {
        const adding = !reacted(emoji);
        void act(async () => {
            await api(`/messages/${m.id}/reaction`, 'POST', { emoji });
            if (adding) recordEmojiUse([emoji]);
        });
    };
    return (
        <article className={`message message-avatars-${avatars}`}>
            {avatars !== 'hidden' && <Avatar user={u} color={color(u)} />}
            <div className="message-body">
                <div className="message-line">
                    <span className="message-meta">
                        <button
                            title={`@${u?.username || 'unknown'}`}
                            style={roleText(showRoleColors === false ? undefined : color(u))}
                            onClick={() => {
                                if (u && u.id !== state.me.id) dm(u.id);
                            }}
                        >
                            {displayName(u, 'Former member')}
                        </button>
                        {Boolean(m.pinned) && <Pin size={12} />}
                    </span>
                    {!m.poll && !m.voiceInvite && (
                        <div className="message-text rich-text">
                            <ChatContent
                                users={state.users}
                                text={m.body}
                                custom={state.emojis || []}
                            />
                            {Boolean(m.edited) && <small className="edited"> (edited)</small>}
                        </div>
                    )}
                    <time
                        className="message-time"
                        dateTime={new Date(m.created).toISOString()}
                        title={retention?.title}
                    >
                        {retention?.ending && (
                            <Hourglass className="retention-ending" size={10} aria-hidden />
                        )}
                        <span className={showTime ? undefined : 'message-time-repeat'}>
                            {messageTime(m.created)}
                        </span>
                    </time>
                </div>
                {!!m.previews?.length && (
                    <LinkPreviews
                        previews={m.previews}
                        onHide={
                            m.author === state.me.id ||
                            (!m.room.startsWith('dm:') && permission('messages.deleteOthers'))
                                ? () => void act(() => api(`/messages/${m.id}/previews`, 'DELETE'))
                                : undefined
                        }
                    />
                )}
                {m.voiceInvite && (
                    <VoiceInviteCard
                        invite={m.voiceInvite}
                        state={state}
                        currentChannel={currentVoiceChannel}
                        onJoin={onJoinVoice}
                    />
                )}
                {m.poll && (
                    <PollCard
                        message={{ ...m, poll: m.poll }}
                        canVote={permission('reactions.add')}
                        user={user}
                        vote={(answers) =>
                            void act(() => api(`/messages/${m.id}/vote`, 'POST', { answers }))
                        }
                    />
                )}
                {m.attachments.map((a) => {
                    const image = /^image\/(png|jpeg|gif|webp)$/.test(a.mime);
                    // Retention removed the file but kept the message; its name stays.
                    if (a.removed)
                        return (
                            <div className="attachment attachment-removed" key={a.id}>
                                {image ? <ImageOff size={21} /> : <FileX size={21} />}
                                <span>
                                    {a.name}
                                    <small>Removed after the retention period</small>
                                </span>
                            </div>
                        );
                    // Files without a preview keep the download card; images download from it.
                    const card = (
                        <button
                            className="attachment"
                            key={a.id}
                            onClick={() => void download(a.id, a.name)}
                        >
                            <Paperclip size={21} />
                            <span>
                                {a.name}
                                <small>Download attachment</small>
                            </span>
                            <Download size={18} />
                        </button>
                    );
                    return image ? (
                        <ImageAttachment
                            key={a.id}
                            attachment={a}
                            onDownload={() => void download(a.id, a.name)}
                            fallback={card}
                        />
                    ) : (
                        card
                    );
                })}
                <div className="reactions">
                    {[...new Set(m.reactions.map((r) => r.emoji))].map((emoji) => (
                        <ReactionChip
                            key={emoji}
                            emoji={emoji}
                            people={m.reactions
                                .filter((r) => r.emoji === emoji)
                                .map((r) => ({
                                    id: r.user,
                                    user: user(r.user),
                                }))}
                            mine={reacted(emoji)}
                            showNames={
                                state.reactionAuthors !== false &&
                                state.channels.find((c) => c.id === m.room)?.reactionAuthors !==
                                    0 &&
                                state.channels.find((c) => c.id === m.room)?.reactionAuthors !==
                                    false
                            }
                            canReact={permission('reactions.add')}
                            custom={custom}
                            onReact={() => react(emoji)}
                        />
                    ))}
                </div>
                {!thread && !!m.replyCount && (
                    <button className="thread-replies" onClick={() => onReply?.(m)}>
                        <MessageCircle size={15} />
                        {m.replyCount} {m.replyCount === 1 ? 'reply' : 'replies'}
                    </button>
                )}
            </div>
            <div className="message-actions">
                {permission('reactions.add') &&
                    quickReactions.map((emoji) => (
                        <button
                            key={emoji}
                            className="quick-reaction"
                            title={`React with ${emoji}`}
                            aria-label={`React with ${emoji}`}
                            aria-pressed={reacted(emoji)}
                            onClick={() => react(emoji)}
                        >
                            <Emoji value={emoji} custom={custom} />
                        </button>
                    ))}
                <button
                    title="React"
                    disabled={!permission('reactions.add')}
                    onClick={() => setModal(`reaction:${m.id}`)}
                >
                    <Smile size={16} />
                </button>
                {!thread && !m.thread && onReply && (
                    <button
                        title="Reply in thread"
                        aria-label="Reply in thread"
                        disabled={
                            !permission('threads.reply') ||
                            (!m.replyCount && !permission('threads.create'))
                        }
                        onClick={() => onReply(m)}
                    >
                        <Reply size={16} />
                    </button>
                )}
                {m.poll &&
                    !m.poll.ended &&
                    (m.author === state.me.id ||
                        (!m.room.startsWith('dm:') && permission('messages.deleteOthers'))) && (
                        <button
                            title="End poll now"
                            aria-label="End poll now"
                            onClick={() => setModal(`end-poll:${m.id}`)}
                        >
                            <TimerOff size={16} />
                        </button>
                    )}
                {m.author === state.me.id && !m.poll && !m.voiceInvite && (
                    <button
                        title="Edit"
                        onClick={() => {
                            setEdit(m);
                            setModal('edit');
                        }}
                    >
                        <Pencil size={16} />
                    </button>
                )}
                {permission('messages.pin') && (
                    <button
                        title={
                            m.pinned
                                ? 'Unpin'
                                : pinKeeps(schedule, unit, now, files)
                                  ? 'Pin — keeps it permanently'
                                  : 'Pin'
                        }
                        onClick={() =>
                            void act(async () => {
                                const view = await api<Message>(`/messages/${m.id}`, 'PATCH', {
                                    pinned: !m.pinned,
                                });
                                const text =
                                    m.pinned &&
                                    unpinText(schedule, view.retention, Date.now(), hasFiles(view));
                                if (text) notify?.(text);
                            })
                        }
                    >
                        <Pin size={16} />
                    </button>
                )}
                {(m.author === state.me.id || permission('messages.deleteOthers')) && (
                    <button title="Delete" onClick={() => setModal(`delete:${m.id}`)}>
                        <Trash2 size={16} />
                    </button>
                )}
            </div>
        </article>
    );
}
