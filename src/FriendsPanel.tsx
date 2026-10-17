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
    return (
        <section className="friends-view">
            <div className="friends-header">
                <div>
                    <span className="mini-label">YOUR PEOPLE</span>
                    <h1>Life’s better in good company.</h1>
                    <p className="muted">Find your friends and keep the conversation going.</p>
                </div>
                <button className="primary" onClick={() => setModal('friend')}>
                    <Plus size={17} />
                    Add friend
                </button>
            </div>
            <div className="section-label">
                FRIENDS — {state.friends.filter((f) => f.accepted).length}
            </div>
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
            {state.friends.map((f) => {
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
                                    title="Call friend"
                                    disabled={
                                        !!call.channel ||
                                        !permission('voice') ||
                                        !state.online.includes(id)
                                    }
                                    onClick={() => void startDirectCall(id)}
                                >
                                    <Phone size={21} />
                                </button>
                                <button title="Message" onClick={() => dm(id)}>
                                    <MessageCircle size={21} />
                                </button>
                            </>
                        ) : f.recipient === state.me.id ? (
                            <button
                                title="Accept friend request"
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
                            title="Remove / decline friend"
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
