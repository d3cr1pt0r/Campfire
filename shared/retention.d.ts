export interface RetentionPolicy {
    retention: number | null;
    retentionNext: number | null;
    retentionAt: number | null;
}
export interface RetentionPolicies {
    server: RetentionPolicy;
    dm: RetentionPolicy;
}
export interface RetentionStep {
    from: number;
    days: number;
    source: 'server' | 'dm' | 'channel';
}
export interface RetentionUnit {
    since: number;
    kept: boolean;
    pollEnds: number | null;
}
export const dayMs: number;
export const noticeMs: number;
export const maxRetentionDays: number;
export const retentionPresets: [number, string][];
export function isRetentionDays(days: unknown): days is number;
export function formatRetention(days: number): string;
export function retentionSchedule(
    policies: RetentionPolicies,
    channel: Partial<RetentionPolicy> | null,
): RetentionStep[];
export function periodAt(schedule: RetentionStep[], time: number): number;
export function deletionTime(schedule: RetentionStep[], unit: RetentionUnit): number | null;
export function expiryCutoff(schedule: RetentionStep[], time: number): number;
export function upcomingChange(schedule: RetentionStep[], now: number): RetentionStep | null;
export function appliesRetention(schedule: RetentionStep[], now: number): boolean;
export function finalWindow(days: number): number;
export function settlePolicy(policy: RetentionPolicy, now: number): RetentionPolicy;
export function nextPolicy(
    policy: Partial<RetentionPolicy>,
    value: number | null,
    options: { now: number; applyNow?: boolean; inherited?: number },
): RetentionPolicy;
export function isShorter(
    policy: Partial<RetentionPolicy>,
    value: number | null,
    options: { now: number; inherited?: number },
): boolean;
