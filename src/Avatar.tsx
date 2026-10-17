import type { User } from './types';
import { displayName, initials } from './profiles';
export { initials } from './profiles';
import { AuthImage } from './ChatContent';
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
            style={{ background: color || '#d9a466' }}
        >
            {user?.avatar ? (
                <AuthImage path={`/avatars/${user.avatar}`} alt={displayName(user)} />
            ) : (
                initials(displayName(user, '?'))
            )}
        </span>
    );
}
