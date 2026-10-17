import { useState } from 'react';
import type { State, User } from './types';
import type { ApiClient } from './api';
import type { useCall } from './useCall';
import { Avatar } from './Avatar';
import { displayName } from './profiles';
import { Plus, Users, ArrowRight, Phone, MessageCircle, Check, X } from 'lucide-react';

export function FriendsPanel({
    state,
    call,
    startDirectCall,
    permission,
    user,
    color,
    dm,
    setModal,
    act,
    api,
}: {
    state: State;
    call: Pick<ReturnType<typeof useCall>, 'channel'>;
    startDirectCall: (id: string) => Promise<void>;
    permission: (permission: string) => boolean;
    user: (id: string) => User | undefined;
    color: (user?: User) => string | undefined;
    dm: (id: string) => void;
    setModal: (modal: string | null) => void;
    act: (fn: () => Promise<unknown>) => Promise<void>;
    api: ApiClient;
}) {
    const [filter, setFilter] = useState<'all' | 'online' | 'requests'>('all');
    const accepted = state.friends.filter((friend) => friend.accepted);
    const requests = state.friends.filter((friend) => !friend.accepted);
    const incoming = requests.filter((friend) => friend.recipient === state.me.id).length;
    const visible = (filter === 'requests' ? requests : accepted).filter(
        (friend) =>
            filter !== 'online' ||
            state.online.includes(friend.sender === state.me.id ? friend.recipient : friend.sender),
    );
    return (
        <section className="friends-view">
            <div className="friends-header">
                <div>
                    <span className="mini-label">YOUR PEOPLE</span>
                    <h1>Friends</h1>
                    <p className="muted">Find your friends and keep the conversation going.</p>
                </div>
                <button className="primary" onClick={() => setModal('friend')}>
                    <Plus size={17} />
                    Add friend
                </button>
            </div>
            <div className="friend-filters" role="group" aria-label="Filter friends">
                <button aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>
                    All friends · {accepted.length}
                </button>
                <button aria-pressed={filter === 'online'} onClick={() => setFilter('online')}>
                    Online
                </button>
                <button aria-pressed={filter === 'requests'} onClick={() => setFilter('requests')}>
                    Requests · {requests.length}
                    {incoming > 0 ? ` (${incoming} incoming)` : ''}
                </button>
            </div>
            {state.friends.length > 0 && visible.length === 0 && (
                <div className="empty-state compact">
                    <h3>
                        {filter === 'requests'
                            ? 'No pending requests'
                            : filter === 'online'
                              ? 'No friends online'
                              : 'No friends yet'}
                    </h3>
                    <p>
                        {filter === 'requests'
                            ? 'New friend requests will appear here.'
                            : filter === 'online'
                              ? 'You can still send an offline friend a message from All friends.'
                              : 'Add a friend to start a conversation.'}
                    </p>
                </div>
            )}
            {state.friends.length === 0 && (
                <div className="empty-state">
                    <div className="empty-icon">
                        <Users size={40} />
                    </div>
                    <h2>A familiar face goes a long way.</h2>
                    <p>Add a friend using their username on this server.</p>
                    <button className="primary" onClick={() => setModal('friend')}>
                        Find a friend <ArrowRight size={17} />
                    </button>
                </div>
            )}
            {visible.map((f) => {
                const id = f.sender === state.me.id ? f.recipient : f.sender;
                const u = user(id);
                return (
                    <div className="friend-row" key={id}>
                        <Avatar user={u} color={color(u)} />
                        <div>
                            <strong title={`@${u?.username}`}>{displayName(u)}</strong>
                            <small>
                                @{u?.username} ·{' '}
                                {f.accepted
                                    ? state.online.includes(id)
                                        ? 'Online'
                                        : 'Offline'
                                    : f.sender === state.me.id
                                      ? 'Friend request sent'
                                      : 'Wants to be your friend'}
                            </small>
                        </div>
                        {f.accepted ? (
                            <>
                                <button
                                    aria-label={`Call ${displayName(u)}`}
                                    title={
                                        call.channel
                                            ? 'Leave your current call to start another'
                                            : !permission('voice')
                                              ? 'Your role cannot make calls'
                                              : !state.online.includes(id)
                                                ? 'This friend is offline'
                                                : 'Call friend'
                                    }
                                    disabled={
                                        !!call.channel ||
                                        !permission('voice') ||
                                        !state.online.includes(id)
                                    }
                                    onClick={() => void startDirectCall(id)}
                                >
                                    <Phone size={21} />
                                </button>
                                <button
                                    title="Message"
                                    aria-label={`Message ${displayName(u)}`}
                                    onClick={() => dm(id)}
                                >
                                    <MessageCircle size={21} />
                                </button>
                            </>
                        ) : f.recipient === state.me.id ? (
                            <button
                                title="Accept friend request"
                                aria-label={`Accept request from ${displayName(u)}`}
                                onClick={() =>
                                    void act(() =>
                                        api('/friends', 'POST', {
                                            username: u?.username,
                                        }),
                                    )
                                }
                            >
                                <Check size={21} />
                            </button>
                        ) : null}
                        <button
                            title={
                                f.accepted
                                    ? 'Remove friend'
                                    : f.sender === state.me.id
                                      ? 'Cancel request'
                                      : 'Decline request'
                            }
                            aria-label={`${f.accepted ? 'Remove' : f.sender === state.me.id ? 'Cancel request to' : 'Decline request from'} ${displayName(u)}`}
                            onClick={() => setModal(`remove-friend:${id}`)}
                        >
                            <X size={20} />
                        </button>
                    </div>
                );
            })}
        </section>
    );
}
