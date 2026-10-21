import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EditorState, TextSelection } from 'prosemirror-state';
import { parseInline, parseMessage, messageTexts } from '../src/messageFormat.ts';
import {
    schema,
    docFromMarkdown,
    markdownFromDoc,
    createEditorState,
    formatting,
    shortcuts,
    insertPlainText,
    appendText,
    maxMessageLength,
    listActive,
} from '../src/richText.ts';
import { shouldNotify } from '../src/notifications.ts';

const { nodes, marks } = schema;
const backslash = String.fromCharCode(92);
const text = (value, ...names) =>
    schema.text(
        value,
        names.map((name) => marks[name].create()),
    );
const paragraph = (...content) => nodes.paragraph.create(null, content);
const doc = (...content) => nodes.doc.create(null, content);
const item = (...content) => nodes.list_item.create(null, paragraph(...content));
const roundTrip = (node) => {
    const markdown = markdownFromDoc(node);
    const parsed = docFromMarkdown(markdown);
    assert.ok(parsed.eq(node), `${JSON.stringify(markdown)} parsed as ${parsed}, not ${node}`);
    return markdown;
};

test('inline formatting follows flanking rules so ordinary punctuation stays literal', () => {
    const plain = (value) => assert.deepEqual(parseInline(value), [{ type: 'text', text: value }]);
    for (const value of ['snake_case_name', '__init__', 'a * b * c', '*.txt and *.md', '~5 min'])
        plain(value);
    assert.deepEqual(parseInline('**bold** *it* _it_ ~~gone~~'), [
        { type: 'bold', children: [{ type: 'text', text: 'bold' }] },
        { type: 'text', text: ' ' },
        { type: 'italic', children: [{ type: 'text', text: 'it' }] },
        { type: 'text', text: ' ' },
        { type: 'italic', children: [{ type: 'text', text: 'it' }] },
        { type: 'text', text: ' ' },
        { type: 'strike', children: [{ type: 'text', text: 'gone' }] },
    ]);
    assert.deepEqual(parseInline('***both***'), [
        {
            type: 'bold',
            children: [{ type: 'italic', children: [{ type: 'text', text: 'both' }] }],
        },
    ]);
    assert.deepEqual(parseInline(`${backslash}*literal${backslash}*`), [
        { type: 'text', text: '*literal*' },
    ]);
    assert.deepEqual(parseInline(`C:${backslash}Users`), [
        { type: 'text', text: `C:${backslash}Users` },
    ]);
});

test('code spans keep their contents literal, including backticks and delimiters', () => {
    assert.deepEqual(parseInline('run `npm *test*` now'), [
        { type: 'text', text: 'run ' },
        { type: 'code', text: 'npm *test*' },
        { type: 'text', text: ' now' },
    ]);
    assert.deepEqual(parseInline('``a`b``'), [{ type: 'code', text: 'a`b' }]);
    assert.deepEqual(parseInline('`` `tick` ``'), [{ type: 'code', text: '`tick`' }]);
    assert.deepEqual(parseInline('a `lone tick'), [{ type: 'text', text: 'a `lone tick' }]);
});

test('blocks group lists and quotes, and only closed fences become code blocks', () => {
    assert.deepEqual(
        parseMessage('hi\n- a\n* b\n3. x\n4. y\n> q\n>\n```js\n  code\n```\n```\nopen').map(
            (block) => block.type,
        ),
        ['paragraph', 'bullets', 'numbers', 'quote', 'code', 'paragraph', 'paragraph'],
    );
    const [, , numbers, quote, code] = parseMessage(
        'hi\n- a\n3. x\n4. y\n> q\n>\n```js\n  code\n```',
    );
    assert.equal(numbers.start, 3);
    assert.equal(quote.lines.length, 2);
    assert.equal(code.text, '  code');
    assert.deepEqual(parseMessage('````\n```\n````')[0], { type: 'code', text: '```' });
    assert.deepEqual(parseMessage('-5 degrees')[0].type, 'paragraph');
});

test('mentions inside code neither render as text runs nor notify', () => {
    assert.deepEqual(messageTexts('hey @bob `@alice` **@carol**\n```\n@dave\n```'), [
        'hey @bob ',
        ' ',
        '@carol',
    ]);
    const me = { id: 'me', username: 'alice', role: 'member', status: 'online' };
    const message = (body) => ({ id: 'm', room: 'general', author: 'bob', body });
    const prefs = { notifications: true };
    assert.equal(shouldNotify(message('`@alice`'), me, prefs, 'https://x', [me]), false);
    assert.equal(shouldNotify(message('```\n@alice\n```'), me, prefs, 'https://x', [me]), false);
    assert.equal(shouldNotify(message('**@alice**'), me, prefs, 'https://x', [me]), true);
});

test('editor documents survive storage as text, escaping only what would format', () => {
    assert.equal(roundTrip(doc(paragraph(text('bold', 'bold'), text('text')))), '**bold**text');
    assert.equal(
        roundTrip(doc(paragraph(text('un'), text('believ', 'italic'), text('able')))),
        'un*believ*able',
    );
    assert.equal(
        roundTrip(doc(paragraph(text('bold ', 'bold'), text('both', 'bold', 'italic')))),
        '**bold _both_**',
    );
    assert.equal(
        roundTrip(doc(paragraph(text('a_b snake_case __init__ 5 * 3 ** done')))),
        'a_b snake_case __init__ 5 * 3 ** done',
    );
    assert.equal(
        roundTrip(doc(paragraph(text('*x* _y_ ~~z~~ `q`')))),
        String.raw`\*x\* \_y\_ \~\~z\~\~ \`q\``,
    );
    for (const line of [
        '- not a list',
        '* not a list',
        '1. not a list',
        '> not a quote',
        '>',
        '```',
    ])
        roundTrip(doc(paragraph(text(line))));
    roundTrip(doc(paragraph(text('https://example.com/_private_ link'))));
    roundTrip(doc(paragraph(text(`C:${backslash}Users${backslash}*`))));
    roundTrip(doc(paragraph(text(`ends with ${backslash}`), text('code', 'code'))));
    roundTrip(
        doc(paragraph(text('use '), text('a`b', 'code'), text(' and '), text('`x`', 'code'))),
    );
    roundTrip(doc(paragraph(text('  ', 'code'), text(' padded ', 'code'))));
});

test('blocks round-trip, including fences inside code and list numbering', () => {
    roundTrip(doc(nodes.code_block.create(null, schema.text('const a = 1;\n```\n\n  indented'))));
    roundTrip(doc(nodes.code_block.create(), paragraph(text('after'))));
    roundTrip(
        doc(
            nodes.bullet_list.create(null, [item(text('one')), item(text('- two', 'bold'))]),
            paragraph(text('after')),
        ),
    );
    assert.equal(
        roundTrip(
            doc(nodes.ordered_list.create({ order: 3 }, [item(text('three')), item(text('four'))])),
        ),
        '3. three\n4. four',
    );
    roundTrip(
        doc(
            nodes.blockquote.create(null, [
                paragraph(text('q')),
                paragraph(),
                paragraph(text('s', 'strike')),
            ]),
        ),
    );
    roundTrip(doc(paragraph(text('a')), paragraph(), paragraph(), paragraph(text('b'))));
});

test('whitespace moves outside emphasis and trailing blank lines are dropped', () => {
    assert.equal(
        markdownFromDoc(doc(paragraph(text('hello '), text(' bold ', 'bold'), text('world')))),
        'hello  **bold** world',
    );
    assert.equal(markdownFromDoc(doc(paragraph(text('hi')), paragraph(), paragraph())), 'hi');
    assert.equal(
        markdownFromDoc(doc(nodes.bullet_list.create(null, [item(text('a')), item()]))),
        '- a',
    );
});

test('randomized documents always keep their text through storage', () => {
    const alphabet = ['a', 'b', ' ', '*', '_', '~', '`', '\\', '-', '>', '1', '.', '@'];
    let seed = 7;
    const random = (n) => {
        seed = (seed * 1103515245 + 12345) % 2147483648;
        return seed % n;
    };
    const names = ['bold', 'italic', 'strike'];
    for (let run = 0; run < 400; run++) {
        const content = [];
        for (let part = 0; part < 1 + random(4); part++) {
            let value = '';
            for (let i = 0; i < 1 + random(6); i++) value += alphabet[random(alphabet.length)];
            const chosen = random(5) === 0 ? ['code'] : names.filter(() => random(2));
            content.push(text(value, ...chosen));
        }
        const node = doc(paragraph(...content));
        const parsed = docFromMarkdown(markdownFromDoc(node));
        assert.equal(parsed.textContent, node.textContent, markdownFromDoc(node));
        assert.equal(parsed.childCount, 1, markdownFromDoc(node));
    }
});

const stateWith = (node, from, to = from) =>
    EditorState.create({
        doc: node,
        plugins: createEditorState('').plugins,
        selection: TextSelection.create(node, from, to),
    });
const run = (command, state) => {
    let next = state;
    assert.ok(
        command(state, (tr) => (next = state.apply(tr))),
        'command applies',
    );
    return next;
};
// Simulates typing a character so input rules can react to it.
const type = (state, char) => {
    let next = state;
    const view = {
        state,
        composing: false,
        dispatch: (tr) => (next = state.apply(tr)),
    };
    const { from, to } = state.selection;
    const handled = state.plugins.some((plugin) =>
        plugin.props.handleTextInput?.call(plugin, view, from, to, char, () => state.tr),
    );
    return handled ? next : state.apply(state.tr.insertText(char));
};
const typeAll = (state, value) => [...value].reduce(type, state);

test('typing Markdown shortcuts applies formatting live', () => {
    const typed = (value) => markdownFromDoc(typeAll(createEditorState(''), value).doc);
    assert.equal(typed('say **hi** now'), 'say **hi** now');
    assert.equal(
        typeAll(createEditorState(''), 'say **hi**').doc.firstChild.child(1).marks[0].type,
        marks.bold,
    );
    assert.equal(typed('*soft* and _also_'), '_soft_ and _also_');
    assert.equal(typed('~gone~ ~~too~~'), '~~gone~~ ~~too~~');
    assert.equal(typed('run `npm test` ok'), 'run `npm test` ok');
    assert.equal(
        typed('snake_case_name and 2*3*4'),
        `snake_case_name and 2${backslash}*3${backslash}*4`,
    );
    assert.equal(typeAll(createEditorState(''), '- a').doc.firstChild.type, nodes.bullet_list);
    assert.equal(typeAll(createEditorState(''), '7. a').doc.firstChild.attrs.order, 7);
    assert.equal(typeAll(createEditorState(''), '> a').doc.firstChild.type, nodes.blockquote);
    assert.equal(typeAll(createEditorState(''), '```').doc.firstChild.type, nodes.code_block);
    // Delimiters typed inside code stay literal.
    const code = typeAll(createEditorState(''), '```');
    assert.equal(markdownFromDoc(typeAll(code, '**x**').doc), '```\n**x**\n```');
});

test('toolbar commands toggle code blocks, lists and quotes', () => {
    const lines = doc(paragraph(text('one')), paragraph(text('two')));
    const coded = run(formatting.codeBlock, stateWith(lines, 2, 7));
    assert.equal(markdownFromDoc(coded.doc), '```\none\ntwo\n```');
    const back = run(formatting.codeBlock, coded);
    assert.ok(back.doc.eq(lines));
    const listed = run(formatting.bullets, stateWith(lines, 2));
    assert.equal(markdownFromDoc(listed.doc), '- one\ntwo');
    const renumbered = run(formatting.numbers, listed);
    assert.equal(markdownFromDoc(renumbered.doc), '1. one\ntwo');
    assert.equal(markdownFromDoc(run(formatting.numbers, renumbered).doc), 'one\ntwo');
    const quoted = run(formatting.quote, stateWith(lines, 2));
    assert.equal(markdownFromDoc(quoted.doc), '> one\ntwo');
    assert.equal(markdownFromDoc(run(formatting.quote, quoted).doc), 'one\ntwo');
    assert.equal(markdownFromDoc(run(formatting.bold, stateWith(lines, 1, 4)).doc), '**one**\ntwo');
    assert.equal(formatting.bold(coded), false, 'marks are unavailable in code blocks');
});

test('Shift+Enter continues lists and quotes, and leaves them on an empty line', () => {
    const shift = shortcuts['Shift-Enter'];
    const list = doc(nodes.bullet_list.create(null, [item(text('a'))]));
    const next = run(shift, stateWith(list, 4));
    assert.equal(next.doc.firstChild.childCount, 2);
    const left = run(shift, next);
    assert.equal(markdownFromDoc(left.doc), '- a');
    assert.equal(left.doc.lastChild.type, nodes.paragraph);
    const quote = doc(nodes.blockquote.create(null, [paragraph(text('q'))]));
    const out = run(shift, run(shift, stateWith(quote, 3)));
    assert.equal(out.doc.lastChild.type, nodes.paragraph);
    assert.equal(markdownFromDoc(out.doc), '> q');
});

test('Enter in a code block adds lines and leaves after an empty last line', () => {
    const enter = shortcuts.Enter;
    const code = doc(nodes.code_block.create(null, schema.text('x')));
    const once = run(enter, stateWith(code, 2));
    assert.equal(once.doc.firstChild.textContent, 'x\n');
    const twice = run(enter, once);
    assert.equal(twice.doc.firstChild.textContent, 'x');
    assert.equal(twice.doc.lastChild.type, nodes.paragraph);
    assert.equal(enter(stateWith(doc(paragraph(text('x'))), 2)), false);
});

test('pasted text keeps its lines and length limits reject oversized edits', () => {
    const state = createEditorState('start');
    const pasted = state.apply(insertPlainText(state, ' one\n\n**two**'));
    assert.equal(
        markdownFromDoc(pasted.doc),
        `start one\n\n${backslash}*${backslash}*two${backslash}*${backslash}*`,
    );
    const full = createEditorState('x'.repeat(maxMessageLength));
    assert.equal(full.apply(full.tr.insertText('y')).doc, full.doc);
    assert.equal(appendText('```\ncode\n```', '😄'), '```\ncode\n```\n😄');
    assert.equal(appendText('**hi**', '!'), '**hi!**');
    assert.equal(appendText('x'.repeat(maxMessageLength), '!'), 'x'.repeat(maxMessageLength));
});

// Describes lists compactly, e.g. "bullets[a[bullets[b]],c]".
const outline = (blocks) =>
    blocks
        .map((block) =>
            block.type === 'bullets' || block.type === 'numbers'
                ? `${block.type}${block.start ? block.start : ''}[${block.items
                      .map(
                          (entry) =>
                              entry.content.map((part) => part.text).join('') +
                              (entry.children.length ? `[${outline(entry.children)}]` : ''),
                      )
                      .join(',')}]`
                : block.type,
        )
        .join(' ');
const nested = (value, ...lists) =>
    nodes.list_item.create(null, [paragraph(text(value)), ...lists]);
const bullets = (...items) => nodes.bullet_list.create(null, items);
const numbers = (order, ...items) => nodes.ordered_list.create({ order }, items);
// Position just after the first occurrence of a text.
const after = (node, value) => {
    let found = -1;
    node.descendants((child, pos) => {
        if (found < 0 && child.isText && child.text.includes(value))
            found = pos + child.text.indexOf(value) + value.length;
    });
    return found;
};

test('indented list lines nest, with mixed markers and loosely indented typing', () => {
    assert.equal(
        outline(parseMessage('- a\n  - b\n    1. c\n    2. d\n- e\n1. f')),
        'bullets[a[bullets[b[numbers1[c,d]]]],e] numbers1[f]',
    );
    assert.equal(outline(parseMessage('1. a\n  - b\n2. c')), 'numbers1[a[bullets[b]],c]');
    assert.equal(outline(parseMessage('- a\n - b')), 'bullets[a,b]');
    assert.equal(outline(parseMessage('- a\n    - b\n  - c\n- d')), 'bullets[a[bullets[b,c]],d]');
    assert.equal(outline(parseMessage('- a\n  - b\n  3. c')), 'bullets[a[bullets[b] numbers3[c]]]');
    assert.equal(outline(parseMessage('  - a\n- b')), 'bullets[a,b]');
    assert.equal(outline(parseMessage('- a\ntext\n  - b')), 'bullets[a] paragraph bullets[b]');
    assert.deepEqual(messageTexts('- @alice\n  - `@bob` @carol'), ['@alice', ' @carol']);
});

test('nested lists round-trip with indentation matching each marker', () => {
    assert.equal(
        roundTrip(
            doc(
                bullets(
                    nested('a', bullets(nested('b', numbers(3, item(text('c')), item(text('d')))))),
                    item(text('e')),
                ),
                paragraph(text('after')),
            ),
        ),
        '- a\n  - b\n    3. c\n    4. d\n- e\nafter',
    );
    assert.equal(
        roundTrip(
            doc(
                numbers(
                    9,
                    nested('nine', bullets(item(text('x')))),
                    nested('ten', bullets(item(text('y')))),
                ),
            ),
        ),
        '9. nine\n   - x\n10. ten\n    - y',
    );
    roundTrip(doc(bullets(nested('a', bullets(item(text('b'))), numbers(1, item(text('c')))))));
    assert.equal(
        roundTrip(doc(paragraph(text('  - not a list')), paragraph(text('   1. nor this')))),
        String.raw`  \- not a list` + '\n' + String.raw`   1\. nor this`,
    );
});

test('Tab and Shift+Tab indent and outdent list items, and stay in the editor', () => {
    const list = doc(bullets(item(text('a')), item(text('b'))));
    const indented = run(shortcuts.Tab, stateWith(list, after(list, 'b')));
    assert.equal(markdownFromDoc(indented.doc), '- a\n  - b');
    assert.equal(markdownFromDoc(run(shortcuts['Shift-Tab'], indented).doc), '- a\n- b');
    const first = stateWith(list, after(list, 'a'));
    assert.equal(
        shortcuts.Tab(first, () => assert.fail('nothing to nest under')),
        true,
    );
    assert.equal(shortcuts.Tab(stateWith(doc(paragraph(text('x'))), 2)), false);
    assert.equal(markdownFromDoc(run(shortcuts['Shift-Tab'], first).doc), 'a\n- b');
});

test('nested items step out with Shift+Enter or Backspace, and lists toggle innermost first', () => {
    const list = doc(bullets(nested('a', bullets(item(text('b'))))));
    const start = stateWith(list, after(list, 'b'));
    const blank = run(shortcuts['Shift-Enter'], start);
    const outer = run(shortcuts['Shift-Enter'], blank);
    assert.equal(markdownFromDoc(outer.doc), '- a\n  - b');
    assert.equal(outer.selection.$from.depth, 3, 'cursor is back in a top-level item');
    assert.equal(
        markdownFromDoc(run(shortcuts.Backspace, stateWith(list, after(list, 'b') - 1)).doc),
        '- a\n- b',
    );
    const renumbered = run(formatting.numbers, start);
    assert.equal(markdownFromDoc(renumbered.doc), '- a\n  1. b');
    assert.equal(listActive(renumbered, nodes.ordered_list), true);
    assert.equal(listActive(renumbered, nodes.bullet_list), false);
});

test('lists of one kind that end up adjacent are joined, matching how they are stored', () => {
    const split = doc(bullets(item(text('a'))), paragraph(text('x')), bullets(item(text('b'))));
    const state = EditorState.create({ doc: split, plugins: createEditorState('').plugins });
    const paragraphStart = split.child(0).nodeSize;
    const joined = state.apply(
        state.tr.delete(paragraphStart, paragraphStart + split.child(1).nodeSize),
    );
    assert.equal(joined.doc.childCount, 1);
    assert.equal(joined.doc.firstChild.childCount, 2);
    assert.equal(markdownFromDoc(joined.doc), '- a\n- b');
});
