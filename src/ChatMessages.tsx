import { ReactionChip } from './ReactionChip';
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { defaultRangeExtractor, useVirtualizer } from '@tanstack/react-virtual';
import type { State, User, Message } from './types';
import type { ApiClient } from './api';

import { Avatar } from './Avatar';
import { displayName } from './profiles';
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
} from 'lucide-react';
import { PollCard } from './PollCard';
import { ChatContent, AuthImage } from './ChatContent';
import { needsScrollHistory, restoredScrollOffset, type ChatScrollPosition } from './chatScroll';

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
            saved={saved}
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
    thread = false,
    saved,
    save,
}: {
    saved?: ChatScrollPosition;
    save: (position: ChatScrollPosition) => void;
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
        followOnAppend: true,
        scrollEndThreshold: 80,
        rangeExtractor: (range) => {
            const indexes = defaultRangeExtractor(range);
            const focused = focusedId
                ? visibleMessages.findIndex((m) => m.id === focusedId) + 1
                : -1;
            return focused > 0
                ? [...new Set([...indexes, focused])].sort((a, b) => a - b)
                : indexes;
        },
    });
    // Measurements above the reading position must compensate even while
    // scrolling upward. A partially visible row grows below that position.
    virtualizer.shouldAdjustScrollPositionOnItemSizeChange = (item, _delta, instance) =>
        item.end <= (instance.scrollOffset || 0);
    useLayoutEffect(() => {
        if (!initialized.current && visibleMessages.length) {
            initialized.current = true;
            if ((!saved || saved.atEnd) && !search && !pins) virtualizer.scrollToEnd();
        }
    }, [visibleMessages.length, virtualizer, search, pins, saved]);
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
                                            ? `Say hello to ${displayName(dmUser)}.`
                                            : `Welcome to #${currentChannel?.name || 'general'}`}
                                    </h1>
                                    <p>
                                        {dmUser
                                            ? 'Your direct conversation starts here.'
                                            : 'Settle in. Swap stories. Stay for one more.'}
                                    </p>
                                    <div className="welcome-line">
                                        <span>
                                            <Shield size={14} /> Hosted on your server
                                        </span>
                                        <i /> Only your community
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
                            return (
                                <div
                                    key={item.key}
                                    ref={virtualizer.measureElement}
                                    data-index={item.index}
                                    data-message-id={m.id}
                                    className="virtual-message"
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
            {!!visibleMessages.length && !virtualizer.isAtEnd() && (
                <button className="jump-latest secondary" onClick={() => virtualizer.scrollToEnd()}>
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
    thread = false,
}: Pick<
    React.ComponentProps<typeof ChatMessageList>,
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
> & { message: Message }) {
    const u = m.author ? user(m.author) : undefined;
    return (
        <article className="message">
            <time className="message-time" dateTime={new Date(m.created).toISOString()}>
                <span>
                    {new Date(m.created).toLocaleTimeString('en-US', {
                        hour: 'numeric',
                        minute: '2-digit',
                    })}
                </span>
            </time>
            <Avatar user={u} color={color(u)} />
            <div className="message-body">
                <div className="message-line">
                    <span className="message-meta">
                        <button
                            title={`@${u?.username || 'unknown'}`}
                            style={{ color: color(u) }}
                            onClick={() => {
                                if (u && u.id !== state.me.id) dm(u.id);
                            }}
                        >
                            {displayName(u, 'Former member')}
                        </button>
                        {Boolean(m.pinned) && <Pin size={12} />}
                    </span>
                    {!m.poll && (
                        <span className="message-text">
                            <ChatContent
                                users={state.users}
                                text={m.body}
                                custom={state.emojis || []}
                            />
                            {Boolean(m.edited) && <small className="edited"> (edited)</small>}
                        </span>
                    )}
                </div>
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
                {m.attachments.map((a) => (
                    <React.Fragment key={a.id}>
                        {(/^image\/(png|jpeg|gif|webp)$/.test(a.mime) ||
                            /\.(png|jpe?g|gif|webp)$/i.test(a.name)) && (
                            <AuthImage
                                path={`/attachments/${a.id}/preview`}
                                originalPath={`/attachments/${a.id}?inline=1`}
                                alt={a.name}
                                className="chat-image"
                                expandable
                            />
                        )}
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
                    </React.Fragment>
                ))}
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
                            mine={m.reactions.some(
                                (r) => r.emoji === emoji && r.user === state.me.id,
                            )}
                            showNames={
                                state.reactionAuthors !== false &&
                                state.channels.find((c) => c.id === m.room)?.reactionAuthors !==
                                    0 &&
                                state.channels.find((c) => c.id === m.room)?.reactionAuthors !==
                                    false
                            }
                            canReact={permission('reactions.add')}
                            custom={state.emojis || []}
                            onReact={() =>
                                void act(() => api(`/messages/${m.id}/reaction`, 'POST', { emoji }))
                            }
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
                <button
                    title="React"
                    disabled={!permission('reactions.add')}
                    onClick={() => setModal(`reaction:${m.id}`)}
                >
                    <Smile size={16} />
                </button>
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
                {m.author === state.me.id && !m.poll && (
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
                        title={m.pinned ? 'Unpin' : 'Pin'}
                        onClick={() =>
                            void act(() =>
                                api(`/messages/${m.id}`, 'PATCH', {
                                    pinned: !m.pinned,
                                }),
                            )
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
