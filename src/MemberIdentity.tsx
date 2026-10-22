import type { ReactNode } from 'react';
import { Shield } from 'lucide-react';
import { roleColor } from '../shared/permissions.js';
import { Avatar } from './Avatar';
import { PresenceDot } from './PresenceDot';
import { displayName } from './profiles';
import { userStatus, type DisplayStatus } from './presence';
import type { State, User } from './types';

// Shared identity for compact member rows; the caller owns its button, summary,
// selection semantics, and trailing actions.
export function MemberIdentity({
    user,
    state,
    color,
    secondary,
    self = false,
    speaking = false,
    status,
    showOwner = true,
    nameClassName = '',
    textClassName = '',
}: {
    user?: User;
    state?: State;
    color?: string;
    secondary?: ReactNode;
    self?: boolean;
    speaking?: boolean;
    status?: DisplayStatus;
    showOwner?: boolean;
    nameClassName?: string;
    textClassName?: string;
}) {
    const tint = color ?? (user && state ? roleColor(user, state.roles) : undefined);
    const presence = status ?? (user && state ? userStatus(state, user.id) : undefined);
    const detail =
        secondary === undefined
            ? user && state
                ? user.owner
                    ? 'Owner'
                    : state.roles
                          .filter((role) => user.roles.includes(role.id))
                          .map((role) => role.name)
                          .join(' · ') ||
                      state.roles.find((role) => role.id === 'everyone')?.name ||
                      'Default'
                : user
                  ? '@' + user.username
                  : undefined
            : secondary;
    return (
        <span className="member-identity" title={user ? '@' + user.username : undefined}>
            <span className="avatar-status">
                <Avatar user={user} color={tint} frame={user?.frame} speaking={speaking} />
                {presence && <PresenceDot status={presence} />}
            </span>
            <span className={'member-identity-text ' + textClassName}>
                <strong className={nameClassName} style={{ color: tint }}>
                    {displayName(user)}
                    {self && <small className="member-self"> (you)</small>}
                </strong>
                {detail && <small>{detail}</small>}
            </span>
            {showOwner && user?.owner && <Shield size={13} className="owner-shield" />}
        </span>
    );
}
