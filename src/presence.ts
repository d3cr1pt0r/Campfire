import type { PresenceStatus, State } from './types';

export type DisplayStatus = PresenceStatus | 'offline';
export const statusLabels: Record<DisplayStatus, string> = {
    online: 'Online',
    idle: 'Idle',
    dnd: 'Do not disturb',
    offline: 'Offline',
};
export function userStatus(state: State, id: string): DisplayStatus {
    if (!state.online.includes(id)) return 'offline';
    return state.presence?.[id] || 'online';
}

export function shouldIdle(enabled: boolean, minutes: number, idleSeconds: number, locked = false) {
    return enabled && (locked || idleSeconds >= minutes * 60);
}
export function idleDelay(value: number | undefined) {
    return [1, 5, 10, 15, 30].includes(value || 0) ? value! : 5;
}
