// Retention policies keep messages for a number of days; 0 keeps them forever. A channel's null
// follows the server default. A shorter period waits in retentionNext until retentionAt, so
// members get a week's notice; there, null means the channel will follow the server default.
// With keepText, periods remove only files; turning it off waits until keepTextUntil.
export const dayMs = 86400000;
export const noticeMs = 7 * dayMs;
export const maxRetentionDays = 3650;
export const retentionPresets = [
    [0, 'Forever'],
    [365, '1 year'],
    [182, '6 months'],
    [91, '3 months'],
    [30, '1 month'],
    [14, '2 weeks'],
];
export const isRetentionDays = (days) =>
    Number.isSafeInteger(days) && days >= 0 && days <= maxRetentionDays;
export const formatRetention = (days) =>
    !days || days === Infinity
        ? 'Forever'
        : (retentionPresets.find(([value]) => value === days)?.[1] ??
          `${days} ${days === 1 ? 'day' : 'days'}`);

// Schedules measure periods in days, with Infinity for forever.
const length = (value) => (value ? value : Infinity);
const policyOf = (policy) => ({
    retention: policy?.retention ?? null,
    retentionNext: policy?.retentionNext ?? null,
    retentionAt: policy?.retentionAt ?? null,
});
const steps = (policy) => [
    { from: -Infinity, value: policy.retention },
    ...(policy.retentionAt === null
        ? []
        : [{ from: policy.retentionAt, value: policy.retentionNext }]),
];

// The periods a conversation goes through, as [{ from, days, source, keepText }] by time.
// channel is null for direct messages.
export function retentionSchedule(policies, channel) {
    const schedule = periods(policies, channel);
    if (!policies.keepText) return schedule.map((step) => ({ ...step, keepText: false }));
    const until = policies.keepTextUntil ?? Infinity;
    return schedule.flatMap((step, index) => {
        if (until <= step.from) return [{ ...step, keepText: false }];
        if (until >= (schedule[index + 1]?.from ?? Infinity)) return [{ ...step, keepText: true }];
        return [
            { ...step, keepText: true },
            { ...step, from: until, keepText: false },
        ];
    });
}
function periods({ server, dm }, channel) {
    if (channel === null)
        return steps(policyOf(dm)).map(({ from, value }) => ({
            from,
            days: length(value),
            source: 'dm',
        }));
    const inherited = steps(policyOf(server)),
        own = steps(policyOf(channel));
    return own.flatMap(({ from, value }, index) => {
        if (value !== null) return [{ from, days: length(value), source: 'channel' }];
        const until = own[index + 1]?.from ?? Infinity;
        return inherited
            .filter(
                (step, next) => step.from < until && (inherited[next + 1]?.from ?? Infinity) > from,
            )
            .map((step) => ({
                from: Math.max(step.from, from),
                days: length(step.value),
                source: 'server',
            }));
    });
}
export const periodAt = (schedule, time) => schedule.findLast((step) => step.from <= time).days;

// When a thread whose clock started at since loses its files, or with text, is deleted; null
// while it is kept.
export function deletionTime(schedule, { since, kept, pollEnds }, { text = false } = {}) {
    if (kept) return null;
    for (const [index, step] of schedule.entries()) {
        if (text && step.keepText) continue;
        const at = Math.max(step.from, since + step.days * dayMs);
        if (at < (schedule[index + 1]?.from ?? Infinity)) return Math.max(at, pollEnds ?? 0);
    }
    return null;
}
// Threads whose clock started at or before this were due by time: for their files, or with
// text, for deletion.
export function expiryCutoff(schedule, time, { text = false } = {}) {
    let cutoff = -Infinity;
    schedule.forEach((step, index) => {
        if (step.from <= time && !(text && step.keepText))
            cutoff = Math.max(
                cutoff,
                Math.min(schedule[index + 1]?.from ?? Infinity, time) - step.days * dayMs,
            );
    });
    return cutoff;
}
// The next change that deletes more, which members are told about. kind says what it does:
// 'files' (a shorter period for files), 'messages' (a shorter period for messages) or 'text'
// (messages are deleted too, no longer only their files).
export function upcomingChange(schedule, now) {
    for (const [index, step] of schedule.entries()) {
        const previous = schedule[index - 1];
        if (step.from <= now) continue;
        if (step.days < previous.days)
            return { ...step, kind: step.keepText ? 'files' : 'messages' };
        if (previous.keepText && !step.keepText && step.days !== Infinity)
            return { ...step, kind: 'text' };
    }
    return null;
}
export const appliesRetention = (schedule, now) =>
    periodAt(schedule, now) !== Infinity || !!upcomingChange(schedule, now);
// Messages show an hourglass in their last week, or the last quarter of a shorter period.
export const finalWindow = (days) => Math.min(7 * dayMs, (days * dayMs) / 4);

export const settlePolicy = (policy, now) =>
    policy.retentionAt !== null && policy.retentionAt <= now
        ? { retention: policy.retentionNext, retentionNext: null, retentionAt: null }
        : policy;
// Saving a longer or equal period applies at once and cancels a pending change; a shorter one
// waits a week unless applyNow. inherited is the server default in force, which a channel's
// null stands for.
export function nextPolicy(policy, value, { now, applyNow = false, inherited = 0 }) {
    const current = settlePolicy(policyOf(policy), now);
    const days = (retention) => length(retention === null ? inherited : retention);
    if (applyNow || days(value) >= days(current.retention))
        return { retention: value, retentionNext: null, retentionAt: null };
    const keep = current.retentionAt !== null && days(value) >= days(current.retentionNext);
    return {
        retention: current.retention,
        retentionNext: value,
        retentionAt: keep ? current.retentionAt : now + noticeMs,
    };
}
export const isShorter = (policy, value, options) =>
    nextPolicy(policy, value, { ...options, applyNow: false }).retentionAt !== null;

export const settleKeepText = ({ keepText, keepTextUntil = null }, now) =>
    keepText && keepTextUntil !== null && keepTextUntil <= now
        ? { keepText: false, keepTextUntil: null }
        : { keepText: !!keepText, keepTextUntil: keepText ? keepTextUntil : null };
// Keeping text applies at once; no longer keeping it waits a week unless applyNow.
export function nextKeepText(mode, keepText, { now, applyNow = false }) {
    const current = settleKeepText(mode, now);
    if (keepText || applyNow || !current.keepText) return { keepText, keepTextUntil: null };
    return { keepText: true, keepTextUntil: current.keepTextUntil ?? now + noticeMs };
}
