import {
    Fragment,
    Schema,
    Slice,
    type Mark,
    type MarkType,
    type Node,
    type NodeType,
} from 'prosemirror-model';
import {
    EditorState,
    Plugin,
    Selection,
    TextSelection,
    type Command,
    type Transaction,
} from 'prosemirror-state';
import {
    baseKeymap,
    chainCommands,
    createParagraphNear,
    lift,
    liftEmptyBlock,
    newlineInCode,
    splitBlock,
    toggleMark,
    wrapIn,
} from 'prosemirror-commands';
import { liftListItem, sinkListItem, splitListItem, wrapInList } from 'prosemirror-schema-list';
import {
    InputRule,
    inputRules,
    textblockTypeInputRule,
    undoInputRule,
    wrappingInputRule,
} from 'prosemirror-inputrules';
import { keymap } from 'prosemirror-keymap';
import { history, redo, undo } from 'prosemirror-history';
import {
    delimiterFormats,
    delimiterRole,
    escapable,
    parseInline,
    parseMessage,
    type Inline,
    type List,
    type ListItem,
} from './messageFormat.ts';

export const maxMessageLength = 4000;

// One paragraph per line keeps the editor's structure identical to the stored text.
export const schema = new Schema({
    nodes: {
        doc: { content: 'block+' },
        paragraph: {
            group: 'block',
            content: 'inline*',
            parseDOM: [{ tag: 'p' }],
            toDOM: () => ['p', 0],
        },
        blockquote: {
            group: 'block',
            content: 'paragraph+',
            defining: true,
            parseDOM: [{ tag: 'blockquote' }],
            toDOM: () => ['blockquote', 0],
        },
        bullet_list: {
            group: 'block list',
            content: 'list_item+',
            parseDOM: [{ tag: 'ul' }],
            toDOM: () => ['ul', 0],
        },
        ordered_list: {
            group: 'block list',
            content: 'list_item+',
            attrs: { order: { default: 1 } },
            parseDOM: [
                {
                    tag: 'ol',
                    getAttrs: (dom) => ({ order: Number(dom.getAttribute('start') ?? 1) || 1 }),
                },
            ],
            toDOM: (node) =>
                node.attrs.order === 1 ? ['ol', 0] : ['ol', { start: node.attrs.order }, 0],
        },
        // A line of text, optionally followed by lists nested under it.
        list_item: {
            content: 'paragraph list*',
            defining: true,
            parseDOM: [{ tag: 'li' }],
            toDOM: () => ['li', 0],
        },
        code_block: {
            group: 'block',
            content: 'text*',
            marks: '',
            code: true,
            defining: true,
            parseDOM: [{ tag: 'pre', preserveWhitespace: 'full' }],
            toDOM: () => ['pre', ['code', 0]],
        },
        text: { group: 'inline' },
    },
    marks: {
        bold: { parseDOM: [{ tag: 'strong' }], toDOM: () => ['strong', 0] },
        italic: { parseDOM: [{ tag: 'em' }], toDOM: () => ['em', 0] },
        strike: { parseDOM: [{ tag: 's' }], toDOM: () => ['s', 0] },
        code: {
            excludes: '_',
            inclusive: false,
            code: true,
            parseDOM: [{ tag: 'code' }],
            toDOM: () => ['code', 0],
        },
    },
});
const { nodes, marks } = schema;

function inlineNodes(content: Inline[], active: readonly Mark[] = []): Node[] {
    return content.flatMap((part) => {
        if (part.type === 'text') return part.text ? [schema.text(part.text, active)] : [];
        if (part.type === 'code')
            return part.text ? [schema.text(part.text, [marks.code.create()])] : [];
        return inlineNodes(part.children, marks[part.type].create().addToSet(active));
    });
}
const paragraph = (content: Inline[] = []) => nodes.paragraph.create(null, inlineNodes(content));
function listNode(list: List): Node {
    return list.type === 'bullets'
        ? nodes.bullet_list.create(null, list.items.map(listItem))
        : nodes.ordered_list.create({ order: list.start }, list.items.map(listItem));
}
function listItem(item: ListItem): Node {
    return nodes.list_item.create(null, [paragraph(item.content), ...item.children.map(listNode)]);
}

export function docFromMarkdown(markdown: string) {
    return nodes.doc.create(
        null,
        parseMessage(markdown).map((block) => {
            if (block.type === 'code')
                return nodes.code_block.create(null, block.text ? schema.text(block.text) : null);
            if (block.type === 'quote')
                return nodes.blockquote.create(
                    null,
                    block.lines.map((line) => paragraph(line)),
                );
            if (block.type === 'paragraph') return paragraph(block.content);
            return listNode(block);
        }),
    );
}

type Run = { text: string; marks: readonly Mark[] };
type Piece = { text: string; literal: boolean };
const emphasis = [
    [marks.bold, '**'],
    [marks.italic, ''],
    [marks.strike, '~~'],
] as const;

function codeSpan(text: string): Piece {
    const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
    const fence = '`'.repeat(longest + 1);
    const pad = /^`|`$/.test(text) || (/^ [^]* $/.test(text) && !!text.trim());
    return { text: `${fence}${pad ? ' ' : ''}${text}${pad ? ' ' : ''}${fence}`, literal: false };
}

// Whitespace moves outside delimiters, which cannot open or close next to it.
function wrap(group: Piece[], delimiter: string): Piece[] {
    const inner = [...group];
    let lead = '';
    let trail = '';
    while (inner.length && inner[0].literal) {
        const space = /^\s*/u.exec(inner[0].text)![0];
        lead += space;
        if (space.length < inner[0].text.length) {
            inner[0] = { ...inner[0], text: inner[0].text.slice(space.length) };
            break;
        }
        inner.shift();
    }
    while (inner.length && inner[inner.length - 1].literal) {
        const last = inner[inner.length - 1];
        const space = /\s*$/u.exec(last.text)![0];
        trail = space + trail;
        if (space.length < last.text.length) {
            inner[inner.length - 1] = {
                ...last,
                text: last.text.slice(0, -space.length || undefined),
            };
            break;
        }
        inner.pop();
    }
    if (!inner.length) return [{ text: lead + trail, literal: true }];
    const mark = { text: delimiter, literal: false };
    return [{ text: lead, literal: true }, mark, ...inner, mark, { text: trail, literal: true }];
}

function pieces(runs: Run[], depth: number, italic: string): Piece[] {
    if (depth === emphasis.length)
        return runs.map((run) =>
            marks.code.isInSet(run.marks) ? codeSpan(run.text) : { text: run.text, literal: true },
        );
    const [type, delimiter] = emphasis[depth];
    const result: Piece[] = [];
    for (let start = 0; start < runs.length; ) {
        const inside = !!type.isInSet(runs[start].marks);
        let end = start + 1;
        while (end < runs.length && !!type.isInSet(runs[end].marks) === inside) end++;
        const group = pieces(runs.slice(start, end), depth + 1, italic);
        result.push(...(inside ? wrap(group, delimiter || italic) : group));
        start = end;
    }
    return result;
}

// Escapes only characters that would otherwise read as formatting.
function joinPieces(parts: Piece[]) {
    const chars = parts.flatMap((part) =>
        part.text.split('').map((char) => ({ char, literal: part.literal })),
    );
    const escaped = new Array<boolean>(chars.length).fill(false);
    for (let index = 0; index < chars.length; ) {
        const { char, literal } = chars[index];
        let end = index + 1;
        while (end < chars.length && chars[end].char === char) end++;
        if (literal && char === '`') escaped[index] = true;
        else if (literal && char === '\\')
            escaped[index] = escapable.includes(chars[index + 1]?.char ?? 'x');
        else if (delimiterFormats[char]) {
            const run = chars.slice(index, end);
            const role = delimiterRole(char, chars[index - 1]?.char ?? '', chars[end]?.char ?? '');
            const active =
                run.some((entry) => !entry.literal) ||
                (!!delimiterFormats[char][run.length] && (role.open || role.close));
            if (active) for (let at = index; at < end; at++) escaped[at] = chars[at].literal;
        }
        if (char === '`' || char === '\\') end = index + 1;
        index = end;
    }
    return chars.map((entry, index) => (escaped[index] ? '\\' : '') + entry.char).join('');
}

// Compares formatting character by character; whitespace may sit outside emphasis.
function sameFormatting(markdown: string, runs: Run[]) {
    const expected = runs.flatMap((run) =>
        run.text.split('').map((char) => ({
            char,
            key: run.marks
                .map((mark) => mark.type.name)
                .sort()
                .join(),
        })),
    );
    const actual: { char: string; key: string }[] = [];
    const walk = (content: Inline[], active: string[]) =>
        content.forEach((part) => {
            if (part.type === 'text' || part.type === 'code')
                for (const char of part.text.split(''))
                    actual.push({
                        char,
                        key: (part.type === 'code' ? [...active, 'code'] : active).sort().join(),
                    });
            else walk(part.children, [...active, part.type]);
        });
    walk(parseInline(markdown), []);
    return (
        actual.length === expected.length &&
        actual.every(
            (entry, index) =>
                entry.char === expected[index].char &&
                (entry.key === expected[index].key ||
                    (/\s/u.test(entry.char) &&
                        !entry.key.includes('code') &&
                        !expected[index].key.includes('code'))),
        )
    );
}

function inlineMarkdown(block: Node) {
    const runs: Run[] = [];
    block.forEach((child) => runs.push({ text: child.text ?? '', marks: child.marks }));
    for (const italic of ['_', '*']) {
        const markdown = joinPieces(pieces(runs, 0, italic));
        if (sameFormatting(markdown, runs)) return markdown;
    }
    // Rare combinations the syntax cannot express keep their text and code.
    const plain = runs.map((run) => ({
        text: run.text,
        marks: run.marks.filter((mark) => mark.type === marks.code),
    }));
    return joinPieces(pieces(plain, 0, '*'));
}

// Plain lines that would read as a quote or (possibly indented) list item.
const escapeLineStart = (line: string) =>
    /^>(?: |$)/.test(line)
        ? `\\${line}`
        : line.replace(/^( *)([-*]) /, '$1\\$2 ').replace(/^( *)(\d{1,9})\. /, '$1$2\\. ');

const serialized = new WeakMap<Node, string>();

export function markdownFromDoc(doc: Node) {
    const cached = serialized.get(doc);
    if (cached !== undefined) return cached;
    const lines: { text: string; empty: boolean }[] = [];
    const line = (prefix: string, textblock: Node) =>
        lines.push({ text: prefix + inlineMarkdown(textblock), empty: !textblock.content.size });
    // Nested lists are indented to the content of the item they belong to.
    const list = (node: Node, indent: string) =>
        node.forEach((item, _, index) => {
            const marker =
                node.type === nodes.ordered_list ? `${node.attrs.order + index}. ` : '- ';
            line(indent + marker, item.child(0));
            for (let child = 1; child < item.childCount; child++)
                list(item.child(child), indent + ' '.repeat(marker.length));
        });
    doc.forEach((block) => {
        if (block.type === nodes.code_block) {
            const text = block.textContent;
            const fence = '`'.repeat(
                Math.max(
                    3,
                    ...text.split('\n').map((row) => (/^`*/.exec(row)![0].length || 0) + 1),
                ),
            );
            lines.push({ text: `${fence}\n${text}\n${fence}`, empty: false });
        } else if (block.type === nodes.blockquote) block.forEach((child) => line('> ', child));
        else if (block.type.isInGroup('list')) list(block, '');
        else
            lines.push({
                text: escapeLineStart(inlineMarkdown(block)),
                empty: !block.content.size,
            });
    });
    // Trailing blank lines would be trimmed by the server anyway.
    while (lines.length && lines[lines.length - 1].empty) lines.pop();
    const markdown = lines.map((entry) => entry.text).join('\n');
    serialized.set(doc, markdown);
    return markdown;
}

export const inCodeBlock = (state: EditorState) => !!state.selection.$head.parent.type.spec.code;

export function markActive(state: EditorState, type: MarkType) {
    const { from, to, empty, $from } = state.selection;
    return empty
        ? !!type.isInSet(state.storedMarks || $from.marks())
        : state.doc.rangeHasMark(from, to, type);
}

export function blockActive(state: EditorState, type: NodeType) {
    const { $from } = state.selection;
    for (let depth = $from.depth; depth > 0; depth--)
        if ($from.node(depth).type === type) return true;
    return false;
}

// In nested lists only the innermost one counts, so a bullet inside a numbered item is a bullet.
export function listActive(state: EditorState, type: NodeType) {
    const { $from } = state.selection;
    for (let depth = $from.depth; depth > 0; depth--)
        if ($from.node(depth).type.isInGroup('list')) return $from.node(depth).type === type;
    return false;
}

// Turns the code block into one paragraph per line, or the selected blocks into a code block.
export const toggleCodeBlock: Command = (state, dispatch) => {
    const { $from, $to } = state.selection;
    if ($from.parent.type === nodes.code_block && $from.sameParent($to)) {
        if (dispatch) {
            const block = $from.parent;
            const start = $from.before();
            const rows = block.textContent.split('\n');
            const before = block.textContent.slice(0, $from.parentOffset).split('\n');
            const tr = state.tr.replaceWith(
                start,
                start + block.nodeSize,
                rows.map((row) => nodes.paragraph.create(null, row ? schema.text(row) : null)),
            );
            const offset = rows
                .slice(0, before.length - 1)
                .reduce((sum, row) => sum + row.length + 2, start + 1);
            tr.setSelection(
                TextSelection.create(tr.doc, offset + before[before.length - 1].length),
            );
            dispatch(tr.scrollIntoView());
        }
        return true;
    }
    const from = $from.depth ? $from.before(1) : 0;
    const to = $to.depth ? $to.after(1) : state.doc.content.size;
    const rows: string[] = [];
    let cursor = 0;
    state.doc.nodesBetween(from, to, (node, pos) => {
        if (!node.isTextblock) return true;
        if ($from.pos >= pos && $from.pos <= pos + node.nodeSize)
            cursor = rows.join('\n').length + (rows.length ? 1 : 0) + $from.pos - pos - 1;
        rows.push(node.textContent);
        return false;
    });
    if (dispatch) {
        const text = rows.join('\n');
        const tr = state.tr.replaceWith(
            from,
            to,
            nodes.code_block.create(null, text ? schema.text(text) : null),
        );
        tr.setSelection(TextSelection.create(tr.doc, from + 1 + Math.min(cursor, text.length)));
        dispatch(tr.scrollIntoView());
    }
    return true;
};

export function toggleList(type: NodeType): Command {
    return (state, dispatch) => {
        const { $from } = state.selection;
        if ($from.depth >= 3 && $from.node(-1).type === nodes.list_item) {
            if ($from.node(-2).type === type) return liftListItem(nodes.list_item)(state, dispatch);
            if (dispatch) dispatch(state.tr.setNodeMarkup($from.before(-2), type));
            return true;
        }
        return wrapInList(type)(state, dispatch);
    };
}

export const toggleQuote: Command = (state, dispatch) =>
    blockActive(state, nodes.blockquote)
        ? lift(state, dispatch)
        : wrapIn(nodes.blockquote)(state, dispatch);

// Tab nests a list item under the one above it and Shift+Tab moves it back out. Inside a
// list Tab stays in the editor even when the item cannot move, rather than leaving it.
const indent: Command = (state, dispatch) =>
    blockActive(state, nodes.list_item) && (sinkListItem(nodes.list_item)(state, dispatch) || true);
const outdent: Command = (state, dispatch) =>
    blockActive(state, nodes.list_item) && (liftListItem(nodes.list_item)(state, dispatch) || true);

export const formatting = {
    bold: toggleMark(marks.bold),
    italic: toggleMark(marks.italic),
    strike: toggleMark(marks.strike),
    code: toggleMark(marks.code),
    codeBlock: toggleCodeBlock,
    bullets: toggleList(nodes.bullet_list),
    numbers: toggleList(nodes.ordered_list),
    quote: toggleQuote,
    indent,
    outdent,
};

const cursorAtStart = (state: EditorState) =>
    state.selection instanceof TextSelection &&
    state.selection.$cursor &&
    state.selection.$cursor.parentOffset === 0
        ? state.selection.$cursor
        : null;

// Backspace at the start of a list item, quote line or code block removes that formatting.
const unwrapAtStart: Command = (state, dispatch) => {
    const $cursor = cursorAtStart(state);
    if (!$cursor) return false;
    if ($cursor.parent.type === nodes.code_block) return toggleCodeBlock(state, dispatch);
    if ($cursor.node(-1).type === nodes.list_item)
        return liftListItem(nodes.list_item)(state, dispatch);
    if ($cursor.node(-1).type === nodes.blockquote) return lift(state, dispatch);
    return false;
};

// Enter adds a line in a code block; on an empty last line it leaves the block.
const codeEnter: Command = (state, dispatch) => {
    const { $head, empty } = state.selection;
    if (!empty || !$head.parent.type.spec.code) return false;
    const block = $head.parent;
    if ($head.parentOffset < block.content.size || !block.textContent.endsWith('\n'))
        return newlineInCode(state, dispatch);
    if (dispatch) {
        const tr = state.tr.delete($head.pos - 1, $head.pos);
        const after = tr.mapping.map($head.after());
        tr.insert(after, nodes.paragraph.create());
        tr.setSelection(TextSelection.create(tr.doc, after + 1));
        dispatch(tr.scrollIntoView());
    }
    return true;
};

// Arrowing past the end of a final list, quote or code block opens a plain line.
const leaveLastBlock: Command = (state, dispatch) => {
    const { $head, empty } = state.selection;
    const last = state.doc.lastChild;
    if (!empty || !last || last.type === nodes.paragraph) return false;
    if ($head.pos !== Selection.atEnd(state.doc).head) return false;
    if (dispatch) {
        const end = state.doc.content.size;
        const tr = state.tr.insert(end, nodes.paragraph.create());
        dispatch(tr.setSelection(TextSelection.create(tr.doc, end + 1)).scrollIntoView());
    }
    return true;
};

const shiftEnter = chainCommands(
    newlineInCode,
    splitListItem(nodes.list_item),
    liftListItem(nodes.list_item),
    createParagraphNear,
    liftEmptyBlock,
    splitBlock,
);

// Typing **bold**, *italic*, _italic_, ~~strike~~, ~strike~ or `code` applies the format.
function markRule(pattern: RegExp, type: MarkType) {
    return new InputRule(
        pattern,
        (state, match, start, end) => {
            const [whole, content] = match;
            const open = whole.indexOf(content);
            const tr = state.tr
                .delete(start + open + content.length, end)
                .delete(start, start + open)
                .addMark(start, start + content.length, type.create());
            return tr.removeStoredMark(type);
        },
        { inCodeMark: false },
    );
}

const delimited = (delimiter: string, char: string) =>
    new RegExp(
        `(?<![\\p{L}\\p{N}${char}])${delimiter}([^${char}\\s](?:[^${char}]*[^${char}\\s])?)${delimiter}$`,
        'u',
    );

export const rules = [
    markRule(delimited('\\*\\*', '*'), marks.bold),
    markRule(delimited('\\*', '*'), marks.italic),
    markRule(delimited('_', '_'), marks.italic),
    markRule(delimited('~~', '~'), marks.strike),
    markRule(delimited('~', '~'), marks.strike),
    markRule(/(?<!`)`([^`]+)`$/u, marks.code),
    wrappingInputRule(/^[-*]\s$/, nodes.bullet_list),
    wrappingInputRule(
        /^(\d{1,9})\.\s$/,
        nodes.ordered_list,
        (match) => ({ order: Number(match[1]) }),
        (match, node) => node.childCount + node.attrs.order === Number(match[1]),
    ),
    wrappingInputRule(/^>\s$/, nodes.blockquote),
    textblockTypeInputRule(/^```$/, nodes.code_block),
];

export const shortcuts: Record<string, Command> = {
    'Mod-b': formatting.bold,
    'Mod-i': formatting.italic,
    // Formats outside this schema would only be discarded.
    'Mod-u': () => true,
    'Mod-Shift-x': formatting.strike,
    'Mod-Shift-c': formatting.code,
    'Mod-Shift-7': formatting.numbers,
    'Mod-Shift-8': formatting.bullets,
    'Mod-Shift-9': formatting.quote,
    'Mod-z': undo,
    'Mod-y': redo,
    'Mod-Shift-z': redo,
    Enter: codeEnter,
    'Shift-Enter': shiftEnter,
    Tab: indent,
    'Shift-Tab': outdent,
    Backspace: chainCommands(undoInputRule, unwrapAtStart),
    ArrowDown: leaveLastBlock,
    ArrowRight: leaveLastBlock,
};

// Adjacent lists of one kind read back as a single list, so the editor joins them too
// rather than showing a split that would disappear once the message is sent.
const joinAdjacentLists = new Plugin({
    appendTransaction(transactions, _previous, state) {
        if (!transactions.some((tr) => tr.docChanged)) return null;
        const joins: number[] = [];
        const visit = (parent: Node, start: number) => {
            let previous: Node | null = null;
            parent.forEach((child, offset) => {
                if (previous?.type === child.type && child.type.isInGroup('list'))
                    joins.push(start + offset);
                if (!child.isTextblock) visit(child, start + offset + 1);
                previous = child;
            });
        };
        visit(state.doc, 0);
        if (!joins.length) return null;
        const tr = state.tr;
        for (const pos of joins.reverse()) tr.join(pos);
        return tr;
    },
});

// Rejects edits that would make the stored message too long; shrinking is always allowed.
const lengthLimit = new Plugin({
    filterTransaction: (tr, state) => {
        if (!tr.docChanged) return true;
        const length = markdownFromDoc(tr.doc).length;
        return length <= maxMessageLength || length <= markdownFromDoc(state.doc).length;
    },
});

export function createEditorState(markdown: string, plugins: Plugin[] = []) {
    const doc = docFromMarkdown(markdown);
    return EditorState.create({
        doc,
        selection: Selection.atEnd(doc),
        plugins: [
            ...plugins,
            inputRules({ rules }),
            keymap(shortcuts),
            keymap(baseKeymap),
            history(),
            joinAdjacentLists,
            lengthLimit,
        ],
    });
}

// Pasted text keeps its lines, but not formatting from other applications.
export function insertPlainText(state: EditorState, text: string): Transaction {
    const normalized = text.replace(/\r\n?/g, '\n');
    if (state.selection.$from.parent.type.spec.code) return state.tr.insertText(normalized);
    const rows = normalized.split('\n');
    if (rows.length === 1) return state.tr.insertText(normalized);
    const slice = new Slice(
        Fragment.from(
            rows.map((row) => nodes.paragraph.create(null, row ? schema.text(row) : null)),
        ),
        1,
        1,
    );
    return state.tr.replaceSelection(slice).scrollIntoView();
}

// Appends picker emoji without disturbing the formatting already in the draft.
export function appendText(markdown: string, text: string) {
    const doc = docFromMarkdown(markdown);
    const state = EditorState.create({ doc });
    const tr =
        doc.lastChild?.type === nodes.code_block
            ? state.tr.insert(doc.content.size, nodes.paragraph.create(null, schema.text(text)))
            : state.tr.insertText(text, Selection.atEnd(doc).from);
    const result = markdownFromDoc(tr.doc);
    return result.length > maxMessageLength ? markdown : result;
}
