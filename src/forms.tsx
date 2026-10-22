import { useRef, useState, type Ref } from 'react';
import { RichEditor } from './RichEditor';
import { inCodeBlock } from './richText';
import { permissionGroups, hasPermission } from '../shared/permissions.js';
import type { State } from './types';
export function Toggle({
    title,
    value,
    set,
    disabled = false,
}: {
    title: string;
    value: boolean;
    set: (v: boolean) => void;
    disabled?: boolean;
}) {
    return (
        <label className="toggle-label">
            <span>{title}</span>
            <button
                type="button"
                role="switch"
                disabled={disabled}
                aria-checked={value}
                aria-label={title}
                className={`toggle ${value ? 'on' : ''}`}
                onClick={() => set(!value)}
            >
                <i />
            </button>
        </label>
    );
}
export function SimpleForm({
    label,
    initialValue,
    submit,
    busy,
    onSubmit,
    inputRef,
}: {
    label: string;
    initialValue?: string;
    submit: string;
    busy: boolean;
    onSubmit: (v: string) => unknown;
    inputRef?: Ref<HTMLInputElement>;
}) {
    return (
        <form
            onSubmit={(e) => {
                e.preventDefault();
                void onSubmit(String(new FormData(e.currentTarget).get('value')));
            }}
        >
            <label>
                {label}
                <input
                    ref={inputRef}
                    name="value"
                    autoFocus
                    defaultValue={initialValue}
                    required
                    maxLength={32}
                />
            </label>
            <button className="primary" disabled={busy}>
                {busy ? 'Working…' : submit}
            </button>
        </form>
    );
}
// Edits a message with the same formatting editor as the composer; Enter saves.
export function MessageForm({
    initialValue,
    busy,
    formattingToolbar,
    onSubmit,
}: {
    initialValue: string;
    busy: boolean;
    formattingToolbar: boolean;
    onSubmit: (value: string) => unknown;
}) {
    const [value, setValue] = useState(initialValue);
    const form = useRef<HTMLFormElement>(null);
    return (
        <form
            ref={form}
            onSubmit={(e) => {
                e.preventDefault();
                if (value.trim() && !busy) void onSubmit(value);
            }}
        >
            <div className="message-form-field">
                <span>Message</span>
                <RichEditor
                    className="message-form-input"
                    value={value}
                    onChange={setValue}
                    label="Message"
                    autoFocus
                    toolbar={formattingToolbar}
                    onKey={(event, state) => {
                        if (event.key !== 'Enter' || event.shiftKey || event.altKey) return false;
                        if (!event.ctrlKey && !event.metaKey && inCodeBlock(state)) return false;
                        form.current?.requestSubmit();
                        return true;
                    }}
                />
            </div>
            <button className="primary" disabled={busy || !value.trim()}>
                {busy ? 'Working…' : 'Save message'}
            </button>
        </form>
    );
}
export function RoleForm({
    role,
    busy,
    canEditRole,
    state,
    onSave,
}: {
    role?: State['roles'][number];
    busy: boolean;
    canEditRole: boolean;
    state: State;
    onSave: (value: unknown) => unknown;
}) {
    const initialRole = role ?? state.roles.find((entry) => entry.id === 'everyone');
    const [permissions, setPermissions] = useState<string[]>([...(initialRole?.permissions || [])]);
    const [colored, setColored] = useState(!!initialRole?.color);
    return (
        <>
            <h2 id="action-dialog-title">{role ? `Edit role: ${role.name}` : 'Create a role'}</h2>
            <form
                className="role-editor"
                onSubmit={(event) => {
                    event.preventDefault();
                    const data = new FormData(event.currentTarget);
                    void onSave({
                        name: canEditRole ? String(data.get('name')) : role?.name,
                        color: canEditRole
                            ? colored
                                ? String(data.get('color'))
                                : null
                            : role?.color,
                        permissions,
                    });
                }}
            >
                <label>
                    Role name
                    <input
                        name="name"
                        defaultValue={role?.name}
                        required
                        maxLength={32}
                        disabled={busy || !canEditRole}
                    />
                </label>
                <div className="role-color-control">
                    <label className="checkbox-label">
                        <input
                            type="checkbox"
                            checked={colored}
                            disabled={busy || !canEditRole}
                            onChange={(event) => setColored(event.target.checked)}
                        />
                        Use a name color
                    </label>
                    {colored && (
                        <label>
                            Color
                            <input
                                type="color"
                                name="color"
                                defaultValue={initialRole?.color || '#d9a466'}
                                disabled={busy || !canEditRole}
                            />
                        </label>
                    )}
                    <p className="muted">
                        The highest colored role determines a member’s name color.
                    </p>
                </div>
                <div>
                    <h3>Server permissions</h3>
                    <p className="muted">
                        Default applies only when no roles are assigned. Assigning this role
                        replaces Default. Multiple selected roles combine their grants; an unchecked
                        box does not remove a grant from another selected role. Ownership always
                        retains access.
                    </p>
                    {permissionGroups.map((group) => (
                        <fieldset
                            className="role-permission-group"
                            key={group.name}
                            disabled={busy || !canEditRole}
                        >
                            <legend>{group.name}</legend>
                            {group.permissions.map(([id, label]) => (
                                <label key={id} className="checkbox-label">
                                    <input
                                        type="checkbox"
                                        checked={permissions.includes(id)}
                                        disabled={
                                            !state.me.owner &&
                                            !hasPermission(state.me, state.roles, id)
                                        }
                                        onChange={(event) =>
                                            setPermissions((previous) =>
                                                event.target.checked
                                                    ? [...previous, id]
                                                    : previous.filter((p) => p !== id),
                                            )
                                        }
                                    />
                                    {label}
                                </label>
                            ))}
                        </fieldset>
                    ))}
                </div>
                <button className="primary" disabled={busy || !canEditRole}>
                    {busy ? 'Saving…' : 'Save role'}
                </button>
            </form>
        </>
    );
}
