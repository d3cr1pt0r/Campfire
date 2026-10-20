import type { CSSProperties } from 'react';
import type { User } from './types';
import type { AvatarFrame } from '../shared/frames.js';
import { isAvatarFrame } from '../shared/frames.js';
import { displayName, initials } from './profiles';
export { initials } from './profiles';
import { AuthImage } from './ChatContent';
// Sparks, fireflies, bolts and other pieces each animate on their own staggered timeline.
const particles: Record<AvatarFrame, number> = {
    ember: 3,
    fireflies: 3,
    aurora: 2,
    heartbeat: 2,
    gilded: 1,
    frost: 4,
    neon: 0,
    glitch: 3,
    storm: 3,
    vortex: 4,
};
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
            // Saved pictures are opaque; a fill behind them bleeds through the antialiased corners.
            style={user?.avatar ? undefined : { background: color || '#d9a466' }}
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
