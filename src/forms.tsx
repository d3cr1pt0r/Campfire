import { useState } from 'react';
import { permissionGroups, permissionIds, memberPermissions } from '../shared/permissions.js';
import type { State } from './types';
export function Toggle({
    title,
    value,
    set,
}: {
    title: string;
    value: boolean;
    set: (v: boolean) => void;
}) {
    return (
        <label className="toggle-label">
            <span>{title}</span>
            <button
                type="button"
                role="switch"
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
}: {
    label: string;
    initialValue?: string;
    submit: string;
    busy: boolean;
    onSubmit: (v: string) => unknown;
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
                {label === 'Message' ? (
                    <textarea
                        name="value"
                        autoFocus
                        defaultValue={initialValue}
                        required
                        maxLength={4000}
                        rows={5}
                    />
                ) : (
                    <input
                        name="value"
                        autoFocus
                        defaultValue={initialValue}
                        required
                        maxLength={32}
                    />
                )}
            </label>
            <button className="primary" disabled={busy}>
                {busy ? 'Working…' : submit}
            </button>
        </form>
    );
}
export function RoleForm({
    role,
    busy,
    owner,
    state,
    canEditAccess,
    onSave,
}: {
    role?: State['roles'][number];
    busy: boolean;
    owner: boolean;
    state: State;
    canEditAccess: boolean;
    onSave: (v: unknown) => unknown;
}) {
    const [permissions, setPermissions] = useState<string[]>(
        role?.id === 'owner' ? permissionIds : role?.permissions || memberPermissions,
    );
    const [access, setAccess] = useState<Record<string, string>>(() =>
        Object.fromEntries(
            state.channelPermissions
                .filter((entry) => entry.role === role?.id)
                .map((entry) => [entry.channel, entry.mode]),
        ),
    );
    return (
        <>
            <h2 id="action-dialog-title">{role ? `Edit role: ${role.name}` : 'Create a role'}</h2>
            <form
                className="role-editor"
                onSubmit={(e) => {
                    e.preventDefault();
                    const form = new FormData(e.currentTarget);
                    void onSave({
                        name: owner ? form.get('name') : role?.name,
                        color: owner ? form.get('color') : role?.color,
                        permissions,
                        channelAccess:
                            role?.id === 'owner'
                                ? []
                                : state.channels.map((channel) => ({
                                      channel: channel.id,
                                      mode: access[channel.id] || 'full',
                                  })),
                    });
                }}
            >
                <label>
                    Role name
                    <input
                        name="name"
                        defaultValue={role?.name}
                        maxLength={32}
                        required
                        disabled={!owner || busy}
                    />
                </label>
                <label>
                    Name color
                    <input
                        name="color"
                        type="color"
                        defaultValue={role?.color || '#d9a466'}
                        disabled={!owner || busy}
                    />
                </label>
                <h3>General permissions</h3>
                {!owner && (
                    <p className="muted">
                        Only the owner can change general permissions. You can change access to
                        channels you can see.
                    </p>
                )}
                {role?.id === 'owner' && (
                    <p className="muted">
                        The owner always retains every permission and full access to every channel.
                    </p>
                )}
                <p className="field-help">
                    Files and thread replies also require Send messages. Creating a thread also
                    requires Reply in threads. Camera, speaking, sharing, and direct calls require
                    Join calls.
                </p>
                {permissionGroups.map((group) => (
                    <fieldset
                        className="role-permission-group"
                        key={group.name}
                        disabled={busy || !owner || role?.id === 'owner'}
                    >
                        <legend>{group.name}</legend>
                        {group.permissions.map(([id, label]) => (
                            <label className="checkbox-label" key={id}>
                                <input
                                    type="checkbox"
                                    checked={permissions.includes(id)}
                                    onChange={(e) =>
                                        setPermissions((previous) =>
                                            e.target.checked
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
                <h3>Channel access</h3>
                <p className="muted">
                    Full access allows only the actions enabled above. Read only blocks posting,
                    uploads, reactions, and thread replies. Hidden channels cannot be read or
                    moderated.
                </p>
                {role?.id === 'owner' ? (
                    <p>Owner: full access to every channel.</p>
                ) : (
                    <div className="role-channel-access">
                        <table>
                            <thead>
                                <tr>
                                    <th>Channel</th>
                                    <th>Access</th>
                                </tr>
                            </thead>
                            <tbody>
                                {state.channels.map((channel) => (
                                    <tr key={channel.id}>
                                        <th scope="row">
                                            {channel.kind === 'text' ? '#' : '🔊'} {channel.name}
                                        </th>
                                        <td>
                                            <select
                                                aria-label={`${role?.name || 'New role'} access to ${channel.name}`}
                                                disabled={busy || !canEditAccess}
                                                value={access[channel.id] || 'full'}
                                                onChange={(e) =>
                                                    setAccess({
                                                        ...access,
                                                        [channel.id]: e.target.value,
                                                    })
                                                }
                                            >
                                                <option value="full">
                                                    {channel.kind === 'text'
                                                        ? 'Full access'
                                                        : 'Visible'}
                                                </option>
                                                {channel.kind === 'text' && (
                                                    <option value="read-only">Read only</option>
                                                )}
                                                <option value="hidden">Hidden</option>
                                            </select>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
                <button className="primary" disabled={busy || (!owner && !canEditAccess)}>
                    {busy ? 'Saving…' : owner ? 'Save role' : 'Save channel access'}
                </button>
            </form>
        </>
    );
}
