// Retention policies keep messages for a number of days; 0 keeps them forever. A channel's null
// follows the server default. A shorter period waits in retentionNext until retentionAt, so
// members get a week's notice; there, null means the channel will follow the server default.
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

// The periods a conversation goes through, as [{ from, days, source }] by time. channel is null
// for direct messages.
export function retentionSchedule({ server, dm }, channel) {
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

// When a thread whose clock started at since is deleted, or null while it is kept.
export function deletionTime(schedule, { since, kept, pollEnds }) {
    if (kept) return null;
    for (const [index, step] of schedule.entries()) {
        const at = Math.max(step.from, since + step.days * dayMs);
        if (at < (schedule[index + 1]?.from ?? Infinity)) return Math.max(at, pollEnds ?? 0);
    }
    return null;
}
// Threads whose clock started at or before this were due by time.
export function expiryCutoff(schedule, time) {
    let cutoff = -Infinity;
    schedule.forEach((step, index) => {
        if (step.from <= time)
            cutoff = Math.max(
                cutoff,
                Math.min(schedule[index + 1]?.from ?? Infinity, time) - step.days * dayMs,
            );
    });
    return cutoff;
}
// The next change that shortens the period, which members are told about.
export const upcomingChange = (schedule, now) =>
    schedule.find((step, index) => step.from > now && step.days < schedule[index - 1].days) ?? null;
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
