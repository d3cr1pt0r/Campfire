import { useImperativeHandle, useLayoutEffect, useRef, useState, type Ref } from 'react';
import { TextSelection, type Command, type EditorState } from 'prosemirror-state';
import { Decoration, DecorationSet, EditorView } from 'prosemirror-view';
import 'prosemirror-view/style/prosemirror.css';
import {
    Bold,
    Code,
    Italic,
    List,
    ListOrdered,
    SquareCode,
    Strikethrough,
    TextQuote,
    type LucideIcon,
} from 'lucide-react';
import {
    blockActive,
    listActive,
    createEditorState,
    formatting,
    insertPlainText,
    markActive,
    markdownFromDoc,
    maxMessageLength,
    schema,
} from './richText';

export type RichEditorHandle = {
    focus: () => void;
    insertText: (text: string) => void;
    replace: (from: number, to: number, text: string) => void;
    run: (command: Command) => void;
};

type Props = {
    value: string;
    onChange: (markdown: string) => void;
    label: string;
    placeholder?: string;
    disabled?: boolean;
    autoFocus?: boolean;
    toolbar?: boolean;
    className?: string;
    // Extra ARIA attributes, such as the composer's suggestion list wiring.
    attributes?: Record<string, string | undefined>;
    // Runs before the editor's own key handling; return true when handled.
    onKey?: (event: KeyboardEvent, state: EditorState) => boolean;
    onState?: (state: EditorState) => void;
    onFocusChange?: (focused: boolean) => void;
    onCompositionChange?: (composing: boolean) => void;
    onFiles?: (files: File[]) => void;
    ref?: Ref<RichEditorHandle>;
};

const mod = typeof navigator !== 'undefined' && /Mac/.test(navigator.userAgent) ? '⌘' : 'Ctrl';
const tools: ({
    label: string;
    keys: string;
    icon: LucideIcon;
    command: Command;
    active: (state: EditorState) => boolean;
} | null)[] = [
    {
        label: 'Bold',
        keys: `${mod}+B`,
        icon: Bold,
        command: formatting.bold,
        active: (state) => markActive(state, schema.marks.bold),
    },
    {
        label: 'Italic',
        keys: `${mod}+I`,
        icon: Italic,
        command: formatting.italic,
        active: (state) => markActive(state, schema.marks.italic),
    },
    {
        label: 'Strikethrough',
        keys: `${mod}+Shift+X`,
        icon: Strikethrough,
        command: formatting.strike,
        active: (state) => markActive(state, schema.marks.strike),
    },
    null,
    {
        label: 'Code',
        keys: `${mod}+Shift+C`,
        icon: Code,
        command: formatting.code,
        active: (state) => markActive(state, schema.marks.code),
    },
    {
        label: 'Code block',
        keys: '```',
        icon: SquareCode,
        command: formatting.codeBlock,
        active: (state) => blockActive(state, schema.nodes.code_block),
    },
    null,
    {
        label: 'Bulleted list',
        keys: `${mod}+Shift+8; Tab indents`,
        icon: List,
        command: formatting.bullets,
        active: (state) => listActive(state, schema.nodes.bullet_list),
    },
    {
        label: 'Numbered list',
        keys: `${mod}+Shift+7; Tab indents`,
        icon: ListOrdered,
        command: formatting.numbers,
        active: (state) => listActive(state, schema.nodes.ordered_list),
    },
    {
        label: 'Quote',
        keys: `${mod}+Shift+9`,
        icon: TextQuote,
        command: formatting.quote,
        active: (state) => blockActive(state, schema.nodes.blockquote),
    },
];

// One tab stop; arrow keys move between the enabled buttons.
export function FormattingToolbar({
    state,
    disabled,
    run,
}: {
    state: EditorState;
    disabled: boolean;
    run: (command: Command) => void;
}) {
    const [current, setCurrent] = useState(0);
    const enabled = tools.map((tool) => !!tool && !disabled && tool.command(state));
    const stop = enabled[current] ? current : enabled.indexOf(true);
    return (
        <div
            className="format-toolbar"
            role="toolbar"
            aria-label="Formatting"
            onKeyDown={(event) => {
                if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
                event.preventDefault();
                const buttons = [
                    ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
                        'button:not(:disabled)',
                    ),
                ];
                const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
                const step = event.key === 'ArrowRight' ? 1 : -1;
                buttons[(index + step + buttons.length) % buttons.length]?.focus();
            }}
        >
            {tools.map((tool, index) =>
                tool ? (
                    <button
                        key={tool.label}
                        type="button"
                        tabIndex={index === stop ? 0 : -1}
                        title={`${tool.label} (${tool.keys})`}
                        aria-label={tool.label}
                        aria-pressed={tool.active(state)}
                        disabled={!enabled[index]}
                        onFocus={() => setCurrent(index)}
                        // Keep the editor's selection while clicking.
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => run(tool.command)}
                    >
                        <tool.icon size={16} />
                    </button>
                ) : (
                    <span
                        key={`separator-${index}`}
                        className="format-separator"
                        aria-hidden="true"
                    />
                ),
            )}
        </div>
    );
}

const placeholderDecorations = (state: EditorState, text: string) => {
    const first = state.doc.firstChild;
    if (
        !text ||
        state.doc.childCount !== 1 ||
        first?.type !== schema.nodes.paragraph ||
        first.content.size
    )
        return DecorationSet.empty;
    return DecorationSet.create(state.doc, [
        Decoration.node(0, first.nodeSize, { class: 'is-empty', 'data-placeholder': text }),
    ]);
};

// A WYSIWYG editor whose value is the stored Markdown subset of a message.
export function RichEditor({
    value,
    onChange,
    label,
    placeholder = '',
    disabled = false,
    autoFocus = false,
    toolbar = false,
    className = '',
    attributes = {},
    onKey,
    onState,
    onFocusChange,
    onCompositionChange,
    onFiles,
    ref,
}: Props) {
    const mount = useRef<HTMLDivElement>(null);
    const view = useRef<EditorView | null>(null);
    const emitted = useRef(value);
    const latest = useRef({
        onChange,
        onKey,
        onState,
        onFocusChange,
        onCompositionChange,
        onFiles,
        placeholder,
    });
    latest.current = {
        onChange,
        onKey,
        onState,
        onFocusChange,
        onCompositionChange,
        onFiles,
        placeholder,
    };
    const [state, setState] = useState<EditorState | null>(null);
    const show = (next: EditorState) => {
        setState(next);
        latest.current.onState?.(next);
    };
    const insert = (editor: EditorView, text: string) => {
        const room = maxMessageLength - markdownFromDoc(editor.state.doc).length;
        const selected = editor.state.doc.textBetween(
            editor.state.selection.from,
            editor.state.selection.to,
            '\n',
        ).length;
        editor.dispatch(insertPlainText(editor.state, text.slice(0, Math.max(0, room + selected))));
    };
    useLayoutEffect(() => {
        const editor = new EditorView(mount.current, {
            state: createEditorState(value),
            dispatchTransaction(tr) {
                const previous = editor.state;
                const next = previous.apply(tr);
                editor.updateState(next);
                // Transactions over the length limit are filtered out and leave the doc as it was.
                if (next.doc !== previous.doc) {
                    emitted.current = markdownFromDoc(next.doc);
                    latest.current.onChange(emitted.current);
                }
                show(next);
            },
            handleKeyDown: (_, event) => latest.current.onKey?.(event, editor.state) ?? false,
            handlePaste: (_, event) => {
                const files = Array.from(event.clipboardData?.files || []);
                if (files.length) {
                    latest.current.onFiles?.(files);
                    return true;
                }
                // Copies from a Campfire editor keep their formatting; other sources paste as text.
                if (event.clipboardData?.getData('text/html').includes('data-pm-slice'))
                    return false;
                const text = event.clipboardData?.getData('text/plain');
                if (!text) return false;
                insert(editor, text);
                return true;
            },
            // Dropped files are attached by the conversation's drop handler.
            handleDrop: (_, event) => !!event.dataTransfer?.files.length,
            handleDOMEvents: {
                focus: () => (latest.current.onFocusChange?.(true), false),
                blur: () => (latest.current.onFocusChange?.(false), false),
                compositionstart: () => (latest.current.onCompositionChange?.(true), false),
                compositionend: () => (latest.current.onCompositionChange?.(false), false),
            },
            decorations: (current) => placeholderDecorations(current, latest.current.placeholder),
        });
        view.current = editor;
        show(editor.state);
        if (autoFocus) editor.focus();
        return () => {
            editor.destroy();
            view.current = null;
        };
    }, []);
    // Outside changes (sending, the emoji picker, switching rooms) replace the content.
    useLayoutEffect(() => {
        const editor = view.current;
        if (!editor || value === emitted.current) return;
        emitted.current = value;
        const next = createEditorState(value);
        editor.updateState(next);
        show(next);
    }, [value]);
    const attributeKey = JSON.stringify(attributes);
    useLayoutEffect(() => {
        view.current?.setProps({
            editable: () => !disabled,
            attributes: Object.fromEntries(
                Object.entries({
                    class: 'rich-input rich-text',
                    role: 'textbox',
                    'aria-multiline': 'true',
                    'aria-label': label,
                    'aria-placeholder': placeholder || undefined,
                    'aria-disabled': disabled ? 'true' : undefined,
                    ...attributes,
                }).filter((entry): entry is [string, string] => entry[1] !== undefined),
            ),
        });
    }, [disabled, label, placeholder, attributeKey]);
    const run = (command: Command) => {
        const editor = view.current;
        if (!editor) return;
        command(editor.state, editor.dispatch, editor);
        editor.focus();
    };
    useImperativeHandle(
        ref,
        () => ({
            focus: () => view.current?.focus(),
            insertText: (text) => {
                if (view.current) insert(view.current, text);
            },
            replace: (from, to, text) => {
                const editor = view.current;
                if (!editor) return;
                const tr = editor.state.tr.insertText(text, from, to);
                editor.dispatch(tr.setSelection(TextSelection.create(tr.doc, from + text.length)));
                editor.focus();
            },
            run,
        }),
        [],
    );
    return (
        <div className={`rich-editor ${className}`.trim()}>
            {toolbar && state && <FormattingToolbar state={state} disabled={disabled} run={run} />}
            <div ref={mount} className="rich-editor-mount" />
        </div>
    );
}
