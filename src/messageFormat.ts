// Message bodies use a small Markdown subset: **bold**, *italic* or _italic_,
// ~~strike~~, `code`, ``` fenced code blocks, "- " or "1. " lists (nested by
// indentation) and "> " quotes. Parsing produces a tree that is rendered as
// React elements, never as HTML.

export type Inline =
    | { type: 'text'; text: string }
    | { type: 'code'; text: string }
    | { type: 'bold' | 'italic' | 'strike'; children: Inline[] };

export type ListItem = { content: Inline[]; children: List[] };
export type List =
    | { type: 'bullets'; items: ListItem[] }
    | { type: 'numbers'; start: number; items: ListItem[] };

export type Block =
    | { type: 'paragraph'; content: Inline[] }
    | { type: 'quote'; lines: Inline[][] }
    | List
    | { type: 'code'; text: string };

export type Emphasis = 'bold' | 'italic' | 'strike';

// Characters a backslash turns into literal text.
export const escapable = '\\`*_~>-.';

// Delimiter runs that format: * italic, ** bold, *** both, _ italic, ~~ strike.
export const delimiterFormats: Record<string, Record<number, Emphasis[]>> = {
    '*': { 1: ['italic'], 2: ['bold'], 3: ['bold', 'italic'] },
    _: { 1: ['italic'] },
    '~': { 2: ['strike'] },
};

const space = (char: string) => !char || /\s/u.test(char);
const punctuation = (char: string) => /[\p{P}\p{S}]/u.test(char);

// CommonMark flanking rules decide whether a delimiter run can open or close.
// Underscores never format inside a word, so snake_case stays literal.
export function delimiterRole(char: string, before: string, after: string) {
    const left = !space(after) && (!punctuation(after) || space(before) || punctuation(before));
    const right = !space(before) && (!punctuation(before) || space(after) || punctuation(after));
    if (char !== '_') return { open: left, close: right };
    return {
        open: left && (!right || punctuation(before)),
        close: right && (!left || punctuation(after)),
    };
}

const runLength = (source: string, index: number) => {
    let end = index;
    while (source[end] === source[index]) end++;
    return end - index;
};

// A code span closes at the next backtick run of exactly the opening length.
function closingBackticks(source: string, from: number, length: number) {
    for (let index = from; index < source.length; ) {
        if (source[index] !== '`') {
            index++;
            continue;
        }
        const run = runLength(source, index);
        if (run === length) return index;
        index += run;
    }
    return -1;
}

type Frame = { char: string; length: number; children: Inline[] };

export function parseInline(source: string): Inline[] {
    const root: Frame = { char: '', length: 0, children: [] };
    const stack = [root];
    const push = (node: Inline) => {
        const children = stack[stack.length - 1].children;
        const last = children[children.length - 1];
        if (node.type === 'text' && last?.type === 'text') last.text += node.text;
        else children.push(node);
    };
    // An opener that never closes turns back into its literal characters.
    const unwind = () => {
        const frame = stack.pop()!;
        push({ type: 'text', text: frame.char.repeat(frame.length) });
        frame.children.forEach(push);
    };
    let index = 0;
    while (index < source.length) {
        const char = source[index];
        if (char === '\\' && index + 1 < source.length && escapable.includes(source[index + 1])) {
            push({ type: 'text', text: source[index + 1] });
            index += 2;
            continue;
        }
        if (char === '`') {
            const length = runLength(source, index);
            const close = closingBackticks(source, index + length, length);
            if (close < 0) {
                push({ type: 'text', text: source.slice(index, index + length) });
                index += length;
                continue;
            }
            let text = source.slice(index + length, close);
            if (text.length > 1 && text.startsWith(' ') && text.endsWith(' ') && text.trim())
                text = text.slice(1, -1);
            push({ type: 'code', text });
            index = close + length;
            continue;
        }
        const formats = delimiterFormats[char];
        if (formats) {
            const length = runLength(source, index);
            const kinds = formats[length];
            const role = delimiterRole(char, source[index - 1] ?? '', source[index + length] ?? '');
            let opener = -1;
            if (kinds && role.close)
                for (let at = stack.length - 1; at > 0 && opener < 0; at--)
                    if (stack[at].char === char && stack[at].length === length) opener = at;
            if (opener > 0) {
                while (stack.length - 1 > opener) unwind();
                let node: Inline[] = stack.pop()!.children;
                for (const kind of [...kinds].reverse()) node = [{ type: kind, children: node }];
                push(node[0]);
            } else if (kinds && role.open) stack.push({ char, length, children: [] });
            else push({ type: 'text', text: source.slice(index, index + length) });
            index += length;
            continue;
        }
        let end = index + 1;
        while (end < source.length && !'\\`*_~'.includes(source[end])) end++;
        push({ type: 'text', text: source.slice(index, end) });
        index = end;
    }
    while (stack.length > 1) unwind();
    return root.children;
}

const fence = /^(`{3,})[^`]*$/;
const quote = /^>(?: (.*))?$/;
const listLine = /^( *)(?:([-*])|(\d{1,9})\.) (.*)$/;
const closesFence = (line: string, length: number) =>
    /^`{3,}\s*$/.test(line) && line.trimEnd().length >= length;

export function parseMessage(text: string): Block[] {
    const lines = text.split(/\r\n?|\n/);
    const blocks: Block[] = [];
    // Open lists from the outermost; each level nests under the previous level's last item.
    let levels: { indent: number; list: List }[] = [];
    const newList = (number: string | undefined, item: ListItem): List =>
        number === undefined
            ? { type: 'bullets', items: [item] }
            : { type: 'numbers', start: Number(number), items: [item] };
    const addListItem = (indent: number, number: string | undefined, content: string) => {
        const item: ListItem = { content: parseInline(content), children: [] };
        if (!levels.length) {
            const list = newList(number, item);
            blocks.push(list);
            levels = [{ indent, list }];
            return;
        }
        let depth = levels.length - 1;
        while (depth > 0 && levels[depth].indent > indent) depth--;
        // Two or more spaces past a marker nest under that level's last item.
        if (indent >= levels[depth].indent + 2) {
            if (depth + 1 === levels.length) {
                const list = newList(number, item);
                levels[depth].list.items[levels[depth].list.items.length - 1].children.push(list);
                levels.push({ indent, list });
                return;
            }
            depth++;
        }
        levels.length = depth + 1;
        const level = levels[depth];
        if (level.list.type === (number === undefined ? 'bullets' : 'numbers')) {
            level.list.items.push(item);
            return;
        }
        // A different marker at the same level starts a sibling list.
        level.list = newList(number, item);
        if (depth === 0) blocks.push(level.list);
        else {
            const parent = levels[depth - 1].list.items;
            parent[parent.length - 1].children.push(level.list);
        }
    };
    for (let index = 0; index < lines.length; index++) {
        const line = lines[index];
        const item = listLine.exec(line);
        if (item) {
            addListItem(item[1].length, item[3], item[4]);
            continue;
        }
        levels = [];
        const open = fence.exec(line);
        if (open) {
            let close = index + 1;
            while (close < lines.length && !closesFence(lines[close], open[1].length)) close++;
            // An unclosed fence is ordinary text.
            if (close < lines.length) {
                blocks.push({ type: 'code', text: lines.slice(index + 1, close).join('\n') });
                index = close;
                continue;
            }
        }
        const last = blocks[blocks.length - 1];
        let match: RegExpExecArray | null;
        if ((match = quote.exec(line))) {
            const content = parseInline(match[1] ?? '');
            if (last?.type === 'quote') last.lines.push(content);
            else blocks.push({ type: 'quote', lines: [content] });
        } else blocks.push({ type: 'paragraph', content: parseInline(line) });
    }
    return blocks;
}

// Text outside code, where mentions, links and emoji apply.
export function messageTexts(text: string) {
    const texts: string[] = [];
    const walk = (content: Inline[]) =>
        content.forEach((part) => {
            if (part.type === 'text') texts.push(part.text);
            else if (part.type !== 'code') walk(part.children);
        });
    const walkList = (list: List): void =>
        list.items.forEach((item) => {
            walk(item.content);
            item.children.forEach(walkList);
        });
    for (const block of parseMessage(text)) {
        if (block.type === 'paragraph') walk(block.content);
        else if (block.type === 'quote') block.lines.forEach(walk);
        else if (block.type !== 'code') walkList(block);
    }
    return texts;
}
