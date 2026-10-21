import type { State, User } from './types';
import { displayName } from './profiles.ts';
import { userStatus } from './presence.ts';

const order = { online: 0, idle: 1, dnd: 2, offline: 3 };
export function inviteMembers(state: State, users: User[], query: string) {
    const term = query.trim().toLocaleLowerCase();
    return users
        .filter((user) =>
            `${displayName(user)} ${user.username}`.toLocaleLowerCase().includes(term),
        )
        .sort(
            (a, b) =>
                order[userStatus(state, a.id)] - order[userStatus(state, b.id)] ||
                displayName(a).localeCompare(displayName(b)) ||
                a.username.localeCompare(b.username) ||
                a.id.localeCompare(b.id),
        );
}
