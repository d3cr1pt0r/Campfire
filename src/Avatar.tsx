import type { CSSProperties } from 'react';
import type { User } from './types';
import type { AvatarFrame } from '../shared/frames.js';
import { isAvatarFrame } from '../shared/frames.js';
import { displayName, initials } from './profiles';
export { initials } from './profiles';
import { AuthImage } from './ChatContent';
// Sparks, fireflies, and twinkles each animate on their own staggered timeline.
const particles: Record<AvatarFrame, number> = { ember: 3, fireflies: 3, aurora: 2 };
export function Avatar({
    user,
    color,
    small = false,
    speaking = false,
    frame = user?.frame,
}: {
    user?: User;
    color?: string;
    small?: boolean;
    speaking?: boolean;
    // Previews can show a frame the member hasn't saved yet.
    frame?: AvatarFrame | null;
}) {
    const framed = isAvatarFrame(frame) ? frame : null;
    return (
        <span
            title={user ? `${displayName(user)} (@${user.username})` : undefined}
            className={`avatar ${small ? 'small' : ''} ${speaking ? 'speaking' : ''} ${framed ? `framed frame-${framed}` : ''}`}
            style={{ background: color || '#d9a466' }}
        >
            {user?.avatar ? (
                <AuthImage path={`/avatars/${user.avatar}`} alt={displayName(user)} />
            ) : (
                initials(displayName(user, '?'))
            )}
            {framed && (
                <span className="avatar-frame" aria-hidden="true">
                    <span className="avatar-frame-glow" />
                    <span className="avatar-frame-ring" />
                    {Array.from({ length: particles[framed] }, (_, index) => (
                        <span
                            key={index}
                            className="avatar-frame-particle"
                            style={{ '--particle': index } as CSSProperties}
                        />
                    ))}
                </span>
            )}
        </span>
    );
}
