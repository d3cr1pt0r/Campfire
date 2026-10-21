import { hasPermission } from '../shared/permissions.js';
import type { ApiClient } from './api';
import type { State, User } from './types';
import { InviteMembers } from './InviteMembers';
import type { RefObject } from 'react';

export function CallInvite({
    state,
    channel,
    api,
    color,
    disabled,
    searchRef,
}: {
    state: State;
    channel: string | null;
    api: ApiClient;
    color: (user?: User) => string | undefined;
    disabled: boolean;
    searchRef: RefObject<HTMLInputElement | null>;
}) {
    const room = state.directCalls?.find((call) => call.id === channel);
    return (
        <div className="call-invite-picker">
            <h2 id="action-dialog-title">Invite a member to this call</h2>
            <p>Members can accept or decline the invitation.</p>
            <InviteMembers
                state={state}
                users={state.users.filter((member) => member.id !== state.me.id)}
                color={color}
                searchRef={searchRef}
                disabled={disabled || !room || !hasPermission(state.me, state.roles, 'calls.start')}
                unavailable={(member) =>
                    room?.members.includes(member.id)
                        ? 'In this call'
                        : room?.invited.includes(member.id)
                          ? 'Invited'
                          : !state.online.includes(member.id)
                            ? 'Offline'
                            : !hasPermission(member, state.roles, 'calls.join')
                              ? 'Cannot join'
                              : undefined
                }
                onInvite={(user) =>
                    api(`/calls/${encodeURIComponent(channel || '')}/invite`, 'POST', { user })
                }
            />
        </div>
    );
}
