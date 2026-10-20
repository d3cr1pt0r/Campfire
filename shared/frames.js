// Profile picture frames; everyone sees the frame a member picks. The last eight are static.
export const avatarFrames = [
    'ember',
    'fireflies',
    'aurora',
    'gilded',
    'frost',
    'storm',
    'tide',
    'lanterns',
    'breath',
    'stardust',
    'bubbles',
    'wisps',
    'dandelion',
    'smoke',
    'magma',
    'autumn',
    'meteors',
    'honey',
    'gold',
    'silver',
    'rosegold',
    'obsidian',
    'pearl',
    'jade',
    'sunset',
    'spectrum',
];

export function isAvatarFrame(value) {
    return avatarFrames.includes(value);
}
