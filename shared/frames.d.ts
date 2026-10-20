export type AvatarFrame = 'ember' | 'fireflies' | 'aurora';
export const avatarFrames: AvatarFrame[];
export function isAvatarFrame(value: unknown): value is AvatarFrame;
