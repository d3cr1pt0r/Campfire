import type { Poll } from './types';

// Matches the lengths the server accepts.
export const pollLengths = [
    [1, '1 hour'],
    [4, '4 hours'],
    [24, '1 day'],
    [72, '3 days'],
    [168, '1 week'],
] as const;
export const maxAnswers = 10;

// Rounded down, so it never promises more time than remains.
export function timeLeft(ends: number, now: number): string {
    const minutes = Math.floor((ends - now) / 60000);
    if (minutes < 1) return 'Less than a minute left';
    if (minutes < 60) return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} left`;
    const hours = Math.floor(minutes / 60);
    if (hours < 48) return `${hours} ${hours === 1 ? 'hour' : 'hours'} left`;
    return `${Math.floor(hours / 24)} days left`;
}

// Share of the people who voted, so multiple-choice answers can add up past 100%.
export function percent(count: number, total: number): number {
    return total ? Math.round((count / total) * 100) : 0;
}

// The answers with the most votes once results are visible; empty when nobody voted.
export function leaders(poll: Poll): string[] {
    const top = Math.max(0, ...poll.answers.map((answer) => answer.count ?? 0));
    return top ? poll.answers.filter((answer) => answer.count === top).map((a) => a.id) : [];
}

// "/poll Game night?" opens the poll dialog with that question; null for anything else.
export function pollCommand(draft: string): string | null {
    const match = /^\/poll(?:\s+([\s\S]*))?$/i.exec(draft.trim());
    return match ? (match[1] ?? '').trim() : null;
}

// The first thing stopping a poll from being posted, worded for the person writing it.
export function pollProblem(question: string, answers: string[]): string | null {
    if (!question.trim()) return 'Write a question.';
    const filled = answers.map((answer) => answer.trim().toLowerCase()).filter(Boolean);
    if (filled.length < 2) return 'Add at least two answers.';
    if (new Set(filled).size !== filled.length) return 'Each answer must be different.';
    return null;
}
