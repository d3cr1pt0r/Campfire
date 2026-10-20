// Animated profile picture frames; everyone sees the frame a member picks.
export const avatarFrames = [
    'ember',
    'fireflies',
    'aurora',
    'heartbeat',
    'gilded',
    'frost',
    'neon',
    'glitch',
    'storm',
    'vortex',
];

export function isAvatarFrame(value) {
    return avatarFrames.includes(value);
}
