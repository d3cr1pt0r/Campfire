import React from 'react';
import type { State, User, Message } from './types';
import type { ApiClient } from './api';

import { Avatar } from './Avatar';
import { displayName } from './profiles';
import type { useConversation } from './useConversation';
import {
    MessageCircle,
    Hash,
    Shield,
    Pin,
    Search,
    Paperclip,
    Download,
    Smile,
    Pencil,
    Trash2,
} from 'lucide-react';
import { ChatContent, AuthImage, Emoji } from './ChatContent';

export function ChatMessages({
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
    bottom,
    clearFilters,
}: {
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
    bottom: React.RefObject<HTMLDivElement | null>;
}) {
    if (!currentChannel && !dmUser)
        return (
            <div className="messages">
                <p>No text channels are available for your role.</p>
            </div>
        );
    return (
        <div className="messages">
            {conversation.error && (
                <div className="inline-notice" role="alert">
                    {conversation.error}
                </div>
            )}
            {conversation.next && (
                <button
                    className="secondary load-older"
                    disabled={conversation.loading}
                    onClick={() => void conversation.loadOlder()}
                >
                    {conversation.loading ? 'Loading…' : 'Load older messages'}
                </button>
            )}
            {conversation.loading && !visibleMessages.length && (
                <p className="inline-notice" role="status">
                    Loading messages…
                </p>
            )}
            {!search && !pins && (
                <div className="channel-welcome">
                    <div className="welcome-hash">
                        {dmUser ? <MessageCircle size={40} /> : <Hash size={43} />}
                    </div>
                    <span className="mini-label">{dmUser ? 'DIRECT MESSAGE' : 'TEXT CHANNEL'}</span>
                    <h1>
                        {dmUser
                            ? `Say hello to ${displayName(dmUser)}.`
                            : `Welcome to #${currentChannel?.name || 'general'}`}
                    </h1>
                    <p>
                        {dmUser
                            ? 'Your direct conversation starts here.'
                            : 'This is your space to share ideas, catch up, and make things happen.'}
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
                    <span>Pinned messages{search ? ` matching “${search}”` : ''}</span>
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
            {visibleMessages.map((m, i) => {
                const u = user(m.author);
                const previous = visibleMessages[i - 1];
                const date = new Date(m.created).toDateString();
                const showDate = !previous || new Date(previous.created).toDateString() !== date;
                return (
                    <React.Fragment key={m.id}>
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
                        <article className="message">
                            <Avatar user={u} color={color(u)} />
                            <div className="message-body">
                                <div className="message-meta">
                                    <button
                                        title={`@${u?.username || 'unknown'}`}
                                        style={{ color: color(u) }}
                                        onClick={() => {
                                            if (u && u.id !== state.me.id) dm(u.id);
                                        }}
                                    >
                                        {displayName(u, 'Former member')}
                                    </button>
                                    <time>
                                        {new Date(m.created).toLocaleTimeString('en-US', {
                                            hour: 'numeric',
                                            minute: '2-digit',
                                        })}
                                    </time>
                                    {Boolean(m.pinned) && <Pin size={12} />}
                                </div>
                                <p>
                                    <ChatContent text={m.body} custom={state.emojis || []} />
                                    {Boolean(m.edited) && (
                                        <small className="edited"> (edited)</small>
                                    )}
                                </p>
                                {m.attachments.map((a) => (
                                    <React.Fragment key={a.id}>
                                        {(/^image\/(png|jpeg|gif|webp)$/.test(a.mime) ||
                                            /\.(png|jpe?g|gif|webp)$/i.test(a.name)) && (
                                            <AuthImage
                                                path={`/attachments/${a.id}?inline=1`}
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
                                        <button
                                            className={
                                                m.reactions.some(
                                                    (r) =>
                                                        r.emoji === emoji && r.user === state.me.id,
                                                )
                                                    ? 'mine'
                                                    : ''
                                            }
                                            key={emoji}
                                            aria-label={`${emoji}: ${m.reactions.filter((r) => r.emoji === emoji).length} reactions`}
                                            aria-pressed={m.reactions.some(
                                                (r) => r.emoji === emoji && r.user === state.me.id,
                                            )}
                                            disabled={!permission('send')}
                                            onClick={() =>
                                                void act(() =>
                                                    api(`/messages/${m.id}/reaction`, 'POST', {
                                                        emoji,
                                                    }),
                                                )
                                            }
                                        >
                                            <Emoji value={emoji} custom={state.emojis || []} />{' '}
                                            <span>
                                                {
                                                    m.reactions.filter((r) => r.emoji === emoji)
                                                        .length
                                                }
                                            </span>
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <div className="message-actions">
                                <button
                                    title="React"
                                    disabled={!permission('send')}
                                    onClick={() => setModal(`reaction:${m.id}`)}
                                >
                                    <Smile size={16} />
                                </button>
                                {m.author === state.me.id && permission('send') && (
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
                                {permission('manage') && (
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
                                {permission('send') &&
                                    (m.author === state.me.id || permission('manage')) && (
                                        <button
                                            title="Delete"
                                            onClick={() => setModal(`delete:${m.id}`)}
                                        >
                                            <Trash2 size={16} />
                                        </button>
                                    )}
                            </div>
                        </article>
                    </React.Fragment>
                );
            })}
            {(search || pins) &&
                !conversation.loading &&
                !conversation.error &&
                !visibleMessages.length && (
                    <div className="empty-state compact">
                        <Search size={30} />
                        <h3>{pins ? 'No pinned messages yet.' : 'No matching messages.'}</h3>
                    </div>
                )}
            <div ref={bottom} />
        </div>
    );
}
