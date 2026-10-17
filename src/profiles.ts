import type { User } from './types';
export function initials(name: string): string {
    return (
        (name.match(/[\p{L}\p{N}][^\s-]*/gu) || [])
            .slice(0, 2)
            .map((word) => [...word][0])
            .join('')
            .toUpperCase() || '?'
    );
}
export function displayName(
    user?: Pick<User, 'nickname' | 'username'>,
    fallback = 'Member',
): string {
    return user?.nickname || user?.username || fallback;
}
