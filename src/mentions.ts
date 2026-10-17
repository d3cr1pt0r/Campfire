import type { User } from './types';

type Identity = Pick<User, 'id' | 'username'>;
const word = /[\p{L}\p{N}_-]/u;

export function mentionSegments(text: string, users: Identity[]) {
    const names = [...users].sort((a, b) => b.username.length - a.username.length);
    const lower = text.toLowerCase();
    const result: { text: string; user?: Identity }[] = [];
    let start = 0;
    for (let index = 0; index < text.length; index++) {
        if (text[index] !== '@' || (index > 0 && /[\p{L}\p{N}_@]/u.test(text[index - 1]))) continue;
        const user = names.find((candidate) => {
            const end = index + candidate.username.length + 1;
            return (
                lower.startsWith(candidate.username.toLowerCase(), index + 1) &&
                (end === text.length || !word.test(text[end]))
            );
        });
        if (!user) continue;
        if (index > start) result.push({ text: text.slice(start, index) });
        const end = index + user.username.length + 1;
        result.push({ text: text.slice(index, end), user });
        index = end - 1;
        start = end;
    }
    if (start < text.length) result.push({ text: text.slice(start) });
    return result;
}

export function mentionQuery(text: string, caret: number) {
    const before = text.slice(0, caret);
    const start = before.lastIndexOf('@');
    if (start < 0 || (start > 0 && /[\p{L}\p{N}_@]/u.test(before[start - 1]))) return null;
    const query = before.slice(start + 1);
    if (query.length > 32 || !/^[a-zA-Z0-9_ -]*$/.test(query)) return null;
    return {
        start,
        end: caret + (text.slice(caret).match(/^[a-zA-Z0-9_-]*/)?.[0].length || 0),
        query,
    };
}

export function completeMention(
    text: string,
    query: { start: number; end: number },
    username: string,
) {
    const insertion = `@${username} `;
    const value = text.slice(0, query.start) + insertion + text.slice(query.end);
    if (value.length > 4000) return null;
    return { text: value, caret: query.start + insertion.length };
}
