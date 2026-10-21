import type { Message, State } from './types';
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

// Files and link cards are what a period removes from messages whose text is kept.
export const hasFiles = (message: Pick<Message, 'attachments' | 'previews'>) =>
    message.attachments.some((attachment) => !attachment.removed) || !!message.previews?.length;
const stepAt = (schedule: RetentionStep[], time: number) =>
    schedule.filter((step) => step.from <= time).at(-1)!;
const periodName = (step: RetentionStep) =>
    step.keepText && step.days !== Infinity
        ? `Files · ${formatRetention(step.days)}`
        : formatRetention(step.days);
// The period in force, as the Storage tab lists it.
export const periodLabel = (schedule: RetentionStep[], now: number) =>
    periodName(stepAt(schedule, now));

// The header chip: the coming change if there is one, otherwise the period in force.
export function retentionChip(schedule: RetentionStep[] | null, now: number, direct: boolean) {
    if (!schedule || !appliesRetention(schedule, now)) return null;
    const step = stepAt(schedule, now),
        change = upcomingChange(schedule, now);
    const where = direct ? 'Direct messages' : 'Messages here',
        files = direct ? 'Files in direct messages' : 'Files here';
    const period = formatRetention(step.days);
    const lines = [
        step.days === Infinity
            ? `${where} are kept forever for now.`
            : step.keepText
              ? `${files} are removed ${period} after they’re posted; the messages are kept.`
              : `${where} are deleted ${period} after they’re posted.`,
    ];
    if (change) {
        const from = `From ${formatDay(change.from, now)}`,
            days = formatRetention(change.days);
        lines.push(
            change.kind === 'files'
                ? `${from}, files are removed ${days} after posting.`
                : change.kind === 'text'
                  ? `${from}, messages are deleted too, ${days} after posting.`
                  : step.keepText
                    ? `${from}, messages are deleted ${days} after posting.`
                    : `${from}, they’re deleted ${days} after posting.`,
        );
    }
    lines.push(
        (change ?? step).keepText
            ? 'Pinned messages keep their files.'
            : 'Pinned messages are kept.',
    );
    return {
        label: change
            ? `${periodName(change)} from ${formatDay(change.from, now)}`
            : periodName(step),
        title: lines.join(' '),
    };
}

// The banner for a coming change that deletes more, until the member dismisses it. A change to
// keeping text is server-wide, so it is dismissed once for every conversation.
export function retentionNotice(
    schedule: RetentionStep[] | null,
    now: number,
    direct: boolean,
    canPin: boolean,
) {
    const change = schedule && upcomingChange(schedule, now);
    if (!change) return null;
    const from = `From ${formatDay(change.from, now)}`,
        days = formatRetention(change.days),
        messages = direct ? 'direct messages' : 'messages here';
    const what =
        change.kind === 'files'
            ? `${from}, files ${direct ? 'in direct messages' : 'here'} older than ${days} will be removed.`
            : change.kind === 'text'
              ? `${from}, ${messages} older than ${days} will be deleted, not just their files.`
              : `${from}, ${messages} older than ${days} will be deleted.`;
    return {
        source: change.kind === 'text' ? ('keep-text' as const) : change.source,
        at: change.from,
        text: `${what} ${canPin ? 'Pin anything you want to keep.' : 'Pinned messages are kept.'}`,
    };
}

// When a thread loses its files, and its text, if nothing kept it; null when not at all.
const removal = (schedule: RetentionStep[], unit: RetentionUnit, files: boolean) => {
    const free = { ...unit, kept: false };
    const text = deletionTime(schedule, free, { text: true }),
        attached = deletionTime(schedule, free);
    if (text === null && (!files || attached === null)) return null;
    return { text, files: files ? attached : null };
};

// The hover text on a message's time, and whether it is in its last days. Messages whose
// text is kept and that have no files have nothing at risk, so they show nothing.
export function messageRetention(
    schedule: RetentionStep[] | null,
    unit: RetentionUnit | undefined,
    created: number,
    pinned: boolean,
    now: number,
    files = false,
) {
    if (!schedule || !unit || !appliesRetention(schedule, now)) return null;
    const at = removal(schedule, unit, files);
    if (!at) return null;
    if (pinned) return { title: 'Pinned · kept permanently', ending: false };
    const posted = `Posted ${formatDay(created, now)}`;
    if (unit.kept)
        return { title: `${posted} · kept while its thread has a pinned message`, ending: false };
    const next = (at.files ?? at.text)!;
    const what =
        at.text !== null && (at.files === null || at.files === at.text)
            ? `deleted ${formatDay(at.text, now)}`
            : at.text !== null
              ? `files removed ${formatDay(next, now)}, deleted ${formatDay(at.text, now)}`
              : `files removed ${formatDay(next, now)}`;
    return {
        title: `${posted} · ${what} unless pinned`,
        ending: next - now <= finalWindow(periodAt(schedule, next)),
    };
}

// Whether pinning changes anything for this message.
export const pinKeeps = (
    schedule: RetentionStep[] | null,
    unit: RetentionUnit | undefined,
    now: number,
    files: boolean,
) => !!schedule && !!unit && appliesRetention(schedule, now) && !!removal(schedule, unit, files);

// The toast after unpinning; null where nothing is removed.
export function unpinText(
    schedule: RetentionStep[] | null,
    unit: RetentionUnit | undefined,
    now: number,
    files = false,
) {
    if (!schedule || !unit || !appliesRetention(schedule, now)) return null;
    const at = removal(schedule, unit, files);
    if (!at) return null;
    if (unit.kept) return 'Unpinned. Its thread stays, as another message in it is pinned.';
    if (at.text !== null && (at.files === null || at.files === at.text))
        return `Unpinned. It will be deleted on ${formatDay(at.text, now)}.`;
    return `Unpinned. Its files will be removed on ${formatDay(at.files!, now)}.`;
}
