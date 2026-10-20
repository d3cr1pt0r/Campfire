// Animated profile picture frames; everyone sees the frame a member picks.
export const avatarFrames = ['ember', 'fireflies', 'aurora'];

export function isAvatarFrame(value) {
    return avatarFrames.includes(value);
}
