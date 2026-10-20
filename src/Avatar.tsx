import type { CSSProperties } from 'react';
import type { User } from './types';
import type { AvatarFrame } from '../shared/frames.js';
import { isAvatarFrame } from '../shared/frames.js';
import { displayName, initials } from './profiles';
export { initials } from './profiles';
import { AuthImage } from './ChatContent';
// Sparks, fireflies, leaves and other pieces each animate on their own staggered timeline.
const particles: Record<AvatarFrame, number> = {
    ember: 3,
    fireflies: 3,
    aurora: 2,
    gilded: 1,
    frost: 4,
    storm: 3,
    tide: 2,
    lanterns: 4,
    breath: 0,
    stardust: 2,
    bubbles: 4,
    wisps: 2,
    dandelion: 3,
    smoke: 4,
    magma: 3,
    autumn: 4,
    meteors: 3,
    honey: 3,
    gold: 0,
    silver: 0,
    rosegold: 0,
    obsidian: 0,
    pearl: 0,
    jade: 0,
    sunset: 0,
    spectrum: 0,
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
