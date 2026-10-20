import { useEffect, useState } from 'react';
import { ChevronDown, Pin, Trash2 } from 'lucide-react';
import { canonicalRoom } from '../shared/rooms.js';
import { Avatar } from './Avatar';
import { PresenceDot } from './PresenceDot';
import { displayName } from './profiles';
import { userStatus } from './presence';
import type { AppSocket, Message, State, User } from './types';

type Saved = {
    opened: Record<string, number>;
    received: Record<string, number>;
    hidden: Record<string, number>;
    pinned: string[];
    collapsed: boolean;
};
const savedTimes = (value: unknown): Record<string, number> =>
    Object.fromEntries(
        Object.entries(value && typeof value === 'object' ? value : {}).filter(
            ([key, time]) =>
                key.startsWith('dm:') && typeof time === 'number' && Number.isFinite(time),
        ),
    );

export function DirectMessages({
    state,
    socket,
    room,
    unread,
    color,
    dm,
    close,
    storage,
    storageKey,
}: {
    state: State;
    socket: AppSocket | null;
    room: string;
    unread: Record<string, number>;
    color: (user?: User) => string | undefined;
    dm: (id: string) => void;
    close: (destination: string) => void;
    storage: Pick<Storage, 'getItem' | 'setItem'>;
    storageKey: string;
}) {
    const [saved, setSaved] = useState<Saved>(() => {
        try {
            const value = JSON.parse(storage.getItem(storageKey) || 'null');
            return {
                opened: savedTimes(value?.opened),
                received: savedTimes(value?.received),
                hidden: savedTimes(value?.hidden),
                pinned: Array.isArray(value?.pinned)
                    ? value.pinned.filter((key: unknown) => typeof key === 'string')
                    : [],
                collapsed: value?.collapsed === true,
            };
        } catch {
            return { opened: {}, received: {}, hidden: {}, pinned: [], collapsed: false };
        }
    });
    useEffect(() => {
        storage.setItem(storageKey, JSON.stringify(saved));
    }, [saved, storage, storageKey]);
    useEffect(() => {
        if (!room.startsWith('dm:')) return;
        setSaved((previous) =>
            room in previous.opened && !(room in previous.hidden)
                ? previous
                : {
                      ...previous,
                      hidden: Object.fromEntries(
                          Object.entries(previous.hidden).filter(([key]) => key !== room),
                      ),
                      opened: {
                          ...previous.opened,
                          [room]:
                              state.directMessages?.find((entry) => entry.room === room)?.updated ||
                              Date.now(),
                      },
                  },
        );
    }, [room]);
    useEffect(() => {
        setSaved((previous) => {
            let next = previous;
            for (const entry of state.directMessages || []) {
                const received = entry.received || 0;
                if (received <= (next.received[entry.room] || 0)) continue;
                next = { ...next, received: { ...next.received, [entry.room]: received } };
                if (entry.room in next.hidden && received > next.hidden[entry.room])
                    next.hidden = Object.fromEntries(
                        Object.entries(next.hidden).filter(([key]) => key !== entry.room),
                    );
            }
            return next;
        });
    }, [state.directMessages]);
    useEffect(() => {
        const receive = (message: Message) => {
            if (!message.room.startsWith('dm:')) return;
            const incoming = message.author !== state.me.id;
            setSaved((previous) => ({
                ...previous,
                ...(incoming
                    ? {
                          received: {
                              ...previous.received,
                              [message.room]: Math.max(
                                  previous.received[message.room] || 0,
                                  message.created,
                              ),
                          },
                          hidden: Object.fromEntries(
                              Object.entries(previous.hidden).filter(
                                  ([key]) => key !== message.room,
                              ),
                          ),
                      }
                    : {}),
                opened: {
                    ...previous.opened,
                    [message.room]: Math.max(previous.opened[message.room] || 0, message.created),
                },
            }));
        };
        socket?.on('message', receive);
        return () => {
            socket?.off('message', receive);
        };
    }, [socket, state.me.id]);
    const activity = { ...saved.opened };
    for (const entry of state.directMessages || [])
        activity[entry.room] = Math.max(activity[entry.room] || 0, entry.updated);
    const conversations = state.users
        .filter((user) => user.id !== state.me.id)
        .map((user) => ({
            user,
            destination: canonicalRoom(`dm:${state.me.id}:${user.id}`),
        }))
        .filter(
            ({ destination }) =>
                !(destination in saved.hidden) &&
                (destination in activity || unread[destination] > 0 || destination === room),
        )
        .sort(
            (a, b) =>
                Number(saved.pinned.includes(b.destination)) -
                    Number(saved.pinned.includes(a.destination)) ||
                (activity[b.destination] || 0) - (activity[a.destination] || 0) ||
                a.destination.localeCompare(b.destination),
        );
    const total = conversations.reduce((sum, entry) => sum + (unread[entry.destination] || 0), 0);
    return (
        <section className="direct-messages" aria-label="Direct messages">
            <button
                className="category direct-messages-heading"
                aria-expanded={!saved.collapsed}
                aria-controls="direct-message-list"
                onClick={() =>
                    setSaved((previous) => ({ ...previous, collapsed: !previous.collapsed }))
                }
            >
                <ChevronDown size={14} className={saved.collapsed ? 'collapsed' : ''} />
                <span>MESSAGES</span>
                {total > 0 && (
                    <span className="count" aria-label={`${total} unread direct messages`}>
                        {total > 99 ? '99+' : total}
                    </span>
                )}
            </button>
            <div id="direct-message-list" hidden={saved.collapsed}>
                {!conversations.length && (
                    <p className="direct-messages-empty">
                        Select a member to start a conversation.
                    </p>
                )}
                {conversations.map(({ user, destination }) => {
                    const count = unread[destination] || 0;
                    const pinned = saved.pinned.includes(destination);
                    return (
                        <div
                            className={`direct-message-row ${count ? 'has-unread' : ''}`}
                            key={destination}
                        >
                            <button
                                className={`nav-item direct-message ${room === destination ? 'selected' : ''}`}
                                aria-current={room === destination ? 'page' : undefined}
                                aria-label={`Message ${displayName(user)}${count ? `, ${count} unread messages` : ''}`}
                                onClick={() => dm(user.id)}
                            >
                                <div className="avatar-status">
                                    <Avatar user={user} color={color(user)} />
                                    <PresenceDot status={userStatus(state, user.id)} />
                                </div>
                                <span className="direct-message-name">{displayName(user)}</span>
                                {count > 0 && (
                                    <span className="count dm-unread">
                                        {count > 99 ? '99+' : count}
                                    </span>
                                )}
                            </button>
                            <button
                                className="direct-message-action direct-message-pin"
                                aria-label={`${pinned ? 'Unpin' : 'Pin'} conversation with ${displayName(user)}`}
                                aria-pressed={pinned}
                                onClick={() =>
                                    setSaved((previous) => ({
                                        ...previous,
                                        pinned: pinned
                                            ? previous.pinned.filter((key) => key !== destination)
                                            : [...previous.pinned, destination],
                                    }))
                                }
                            >
                                <Pin size={13} />
                            </button>
                            <button
                                className="direct-message-action direct-message-delete"
                                aria-label={`Remove conversation with ${displayName(user)} from Messages`}
                                title="Remove from Messages"
                                onClick={() => {
                                    setSaved((previous) => ({
                                        ...previous,
                                        hidden: {
                                            ...previous.hidden,
                                            [destination]: Math.max(
                                                previous.received[destination] || 0,
                                                state.directMessages?.find(
                                                    (entry) => entry.room === destination,
                                                )?.received || 0,
                                            ),
                                        },
                                        pinned: previous.pinned.filter(
                                            (key) => key !== destination,
                                        ),
                                    }));
                                    close(destination);
                                }}
                            >
                                <Trash2 size={13} />
                            </button>
                        </div>
                    );
                })}
            </div>
        </section>
    );
}
