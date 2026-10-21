import type { Preferences } from './types';

export type MessageAvatarMode = NonNullable<Preferences['messageAvatars']>;
export function messageAvatarMode(value: unknown): MessageAvatarMode {
    return value === 'normal' || value === 'hidden' ? value : 'compact';
}
