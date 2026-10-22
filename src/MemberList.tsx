import { Fragment } from 'react';
import { Phone, X } from 'lucide-react';
import { hasPermission } from '../shared/permissions.js';
import { MemberIdentity } from './MemberIdentity';
import { displayName } from './profiles';
import { statusLabels, userStatus } from './presence';
import type { State, User } from './types';

export function MemberList({
    state,
    color,
    dm,
    startCall,
    callActive,
    busy,
    onClose,
}: {
    state: State;
    color: (user?: User) => string | undefined;
    dm: (id: string) => void;
    startCall: (id: string) => Promise<unknown>;
    callActive: boolean;
    busy: boolean;
    onClose: () => void;
}) {
    return (
        <aside className="member-list" id="community-members" aria-label="Community members">
            <div className="member-list-heading">
                <span>Members · {state.users.length}</span>
                <button aria-label="Close member list" title="Close member list" onClick={onClose}>
                    <X size={18} />
                </button>
            </div>
            {(['online', 'idle', 'dnd', 'offline'] as const).map((status) => {
                const group = state.users.filter((user) => userStatus(state, user.id) === status);
                return group.length ? (
                    <Fragment key={status}>
                        <div className="member-category">
                            {statusLabels[status].toUpperCase()} — {group.length}
                        </div>
                        {group.map((user) => {
                            const self = user.id === state.me.id;
                            const name = displayName(user);
                            const unavailable = busy
                                ? 'Please wait'
                                : callActive
                                  ? 'Leave your current call first'
                                  : status === 'offline'
                                    ? 'This member is offline'
                                    : !hasPermission(state.me, state.roles, 'calls.join') ||
                                        !hasPermission(state.me, state.roles, 'calls.start')
                                      ? 'You do not have permission to start calls'
                                      : !hasPermission(user, state.roles, 'calls.join')
                                        ? 'This member cannot join calls'
                                        : '';
                            return (
                                <div className="member-row" key={user.id}>
                                    <button
                                        className="member"
                                        aria-label={`Message ${name}${self ? ' (you)' : ''}`}
                                        title={`@${user.username}`}
                                        onClick={() => dm(user.id)}
                                    >
                                        <MemberIdentity
                                            user={user}
                                            state={state}
                                            color={color(user)}
                                            self={self}
                                            status={status}
                                        />
                                    </button>
                                    {!self && (
                                        <button
                                            className="member-call"
                                            title={unavailable || `Call ${name}`}
                                            aria-label={`Call ${name}`}
                                            disabled={!!unavailable}
                                            onClick={() => void startCall(user.id)}
                                        >
                                            <Phone size={15} />
                                        </button>
                                    )}
                                </div>
                            );
                        })}
                    </Fragment>
                ) : null;
            })}
        </aside>
    );
}
