import type { State } from './types';
import {
    appliesRetention,
    deletionTime,
    finalWindow,
    formatRetention,
    periodAt,
    retentionSchedule,
    upcomingChange,
    type RetentionStep,
    type RetentionUnit,
} from '../shared/retention.js';

// The periods a conversation goes through; null when it isn't a known one.
export function conversationSchedule(
    state: Pick<State, 'retention' | 'channels'>,
    room: string,
): RetentionStep[] | null {
    if (room.startsWith('dm:')) return retentionSchedule(state.retention, null);
    const channel = state.channels.find((entry) => entry.id === room);
    return channel ? retentionSchedule(state.retention, channel) : null;
}

export const formatDay = (time: number, now: number) =>
    new Date(time).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        ...(new Date(time).getFullYear() === new Date(now).getFullYear()
            ? {}
            : { year: 'numeric' }),
    });

// The header chip: the coming shorter period if there is one, otherwise the one in force.
export function retentionChip(schedule: RetentionStep[] | null, now: number, direct: boolean) {
    if (!schedule || !appliesRetention(schedule, now)) return null;
    const days = periodAt(schedule, now),
        change = upcomingChange(schedule, now);
    const where = direct ? 'Direct messages' : 'Messages here';
    const lines = [
        days === Infinity
            ? `${where} are kept forever for now.`
            : `${where} are deleted ${formatRetention(days)} after they’re posted.`,
        ...(change
            ? [
                  `From ${formatDay(change.from, now)}, they’re deleted ${formatRetention(change.days)} after posting.`,
              ]
            : []),
        'Pinned messages are kept.',
    ];
    return {
        label: change
            ? `${formatRetention(change.days)} from ${formatDay(change.from, now)}`
            : formatRetention(days),
        title: lines.join(' '),
    };
}

// The banner for a coming shorter period, until the member dismisses it.
export function retentionNotice(
    schedule: RetentionStep[] | null,
    now: number,
    direct: boolean,
    canPin: boolean,
) {
    const change = schedule && upcomingChange(schedule, now);
    if (!change) return null;
    return {
        source: change.source,
        at: change.from,
        text: `From ${formatDay(change.from, now)}, ${direct ? 'direct messages' : 'messages here'} older than ${formatRetention(change.days)} will be deleted. ${canPin ? 'Pin anything you want to keep.' : 'Pinned messages are kept.'}`,
    };
}

// The hover text on a message's time, and whether it is in its last days.
export function messageRetention(
    schedule: RetentionStep[] | null,
    unit: RetentionUnit | undefined,
    created: number,
    pinned: boolean,
    now: number,
) {
    if (!schedule || !unit || !appliesRetention(schedule, now)) return null;
    if (pinned) return { title: 'Pinned · kept permanently', ending: false };
    if (unit.kept)
        return {
            title: `Posted ${formatDay(created, now)} · kept while its thread has a pinned message`,
            ending: false,
        };
    const at = deletionTime(schedule, unit);
    if (at === null) return null;
    return {
        title: `Posted ${formatDay(created, now)} · deleted ${formatDay(at, now)} unless pinned`,
        ending: at - now <= finalWindow(periodAt(schedule, at)),
    };
}

// The toast after unpinning; null where messages are kept forever.
export function unpinText(
    schedule: RetentionStep[] | null,
    unit: RetentionUnit | undefined,
    now: number,
) {
    if (!schedule || !unit || !appliesRetention(schedule, now)) return null;
    if (unit.kept) return 'Unpinned. Its thread stays, as another message in it is pinned.';
    const at = deletionTime(schedule, unit);
    return at === null ? null : `Unpinned. It will be deleted on ${formatDay(at, now)}.`;
}
