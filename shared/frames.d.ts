export type AvatarFrame =
    | 'ember'
    | 'fireflies'
    | 'aurora'
    | 'heartbeat'
    | 'gilded'
    | 'frost'
    | 'neon'
    | 'glitch'
    | 'storm'
    | 'vortex';
export const avatarFrames: AvatarFrame[];
export function isAvatarFrame(value: unknown): value is AvatarFrame;
