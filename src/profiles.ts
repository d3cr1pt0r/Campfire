import type { User } from './types';
export function displayName(
    user?: Pick<User, 'nickname' | 'username'>,
    fallback = 'Member',
): string {
    return user?.nickname || user?.username || fallback;
}
