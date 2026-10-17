import type { User } from './types';
import { displayName } from './profiles';
import { AuthImage } from './ChatContent';
export const initials = (s: string) =>
    s
        .split(/[ -]/)
        .map((w) => w[0])
        .join('')
        .slice(0, 2)
        .toUpperCase();
export function Avatar({
    user,
    color,
    small = false,
    speaking = false,
}: {
    user?: User;
    color?: string;
    small?: boolean;
    speaking?: boolean;
}) {
    return (
        <span
            title={user ? `${displayName(user)} (@${user.username})` : undefined}
            className={`avatar ${small ? 'small' : ''} ${speaking ? 'speaking' : ''}`}
            style={{ background: color || '#7972e8' }}
        >
            {user?.avatar ? (
                <AuthImage path={`/avatars/${user.avatar}`} alt={displayName(user)} />
            ) : (
                initials(displayName(user, '?'))
            )}
        </span>
    );
}
