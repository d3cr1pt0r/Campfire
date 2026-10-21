import { useState, useEffect } from 'react';
import { Check, Minus, X, Shield, RotateCcw } from 'lucide-react';
import { canManageRole, channelPermissionIds, permissionGroups } from '../shared/permissions.js';
import type { ApiClient } from './api';
import type { State, Channel, Category } from './types';

type Effect = 'allow' | 'deny' | 'inherit';
export function ScopePermissions({
    state,
    scope,
    category = false,
    api,
    busy,
    act,
    refresh,
    readOnly = false,
    onDirtyChange,
}: {
    state: State;
    scope: Channel | Category;
    category?: boolean;
    api: ApiClient;
    busy: boolean;
    act: (fn: () => Promise<unknown>) => unknown;
    refresh: () => Promise<void>;
    readOnly?: boolean;
    onDirtyChange?: (dirty: boolean) => void;
}) {
    const roles = state.roles;
    const [roleId, setRoleId] = useState(
        roles.find((role) => role.id === 'everyone')?.id || roles[0]?.id || '',
    );
    const role = roles.find((entry) => entry.id === roleId);
    const [drafts, setDrafts] = useState<Record<string, Record<string, Effect>>>({});
    const changes = drafts[roleId] || {};
    const ids = category
        ? [...new Set([...channelPermissionIds('text'), ...channelPermissionIds('voice')])]
        : channelPermissionIds((scope as Channel).kind);
    const existing = category
        ? (state.categoryPermissions || []).filter((entry) => entry.category === scope.id)
        : state.channelPermissions.filter((entry) => entry.channel === scope.id);
    const effect = (id: string) =>
        changes[id] ??
        existing.find((entry) => entry.role === roleId && entry.permission === id)?.effect ??
        'inherit';
    const editable = !readOnly && !!role && canManageRole(state.me, state.roles, role);
    const canEdit = (id: string) =>
        editable && !busy && (state.me.owner || scope.permissions.includes(id));
    const change = (id: string, value: Effect) =>
        setDrafts((previous) => ({ ...previous, [roleId]: { ...previous[roleId], [id]: value } }));
    const changed = Object.values(drafts).reduce(
        (sum, draft) => sum + Object.keys(draft).length,
        0,
    );
    useEffect(() => {
        onDirtyChange?.(changed > 0);
        return () => onDirtyChange?.(false);
    }, [changed, onDirtyChange]);
    return (
        <section className={`permissions-workbench ${readOnly ? 'is-readonly' : ''}`}>
            <h4>Who can do what?</h4>
            <p className="permissions-explainer">
                Choose a role, then set its access here. <strong>Inherit</strong> uses that role’s
                server permissions.
            </p>
            <div className="permissions-layout">
                <div className="permission-role-list" aria-label="Permission roles">
                    {roles.map((entry) => (
                        <button
                            key={entry.id}
                            className={entry.id === roleId ? 'active' : ''}
                            aria-pressed={entry.id === roleId}
                            onClick={() => setRoleId(entry.id)}
                        >
                            <i style={{ background: entry.color || 'var(--muted)' }} />
                            <span>{entry.name}</span>
                            {Object.keys(drafts[entry.id] || {}).length > 0 && (
                                <span title="Unsaved changes">•</span>
                            )}
                        </button>
                    ))}
                </div>
                <div className="permission-role-editor">
                    <div className="permission-role-heading">
                        <Shield size={16} />
                        <strong>{role?.name}</strong>
                        <span>
                            {roleId === 'everyone'
                                ? 'Members without assigned roles'
                                : 'Members with this role'}
                        </span>
                    </div>
                    {!editable && (
                        <p className="permissions-readonly">
                            {readOnly
                                ? 'Inherited from the category. Edit the category to change these permissions.'
                                : 'Your role cannot edit this role’s permissions.'}
                        </p>
                    )}
                    {permissionGroups
                        .filter((group) => group.permissions.some(([id]) => ids.includes(id)))
                        .map((group) => (
                            <fieldset className="permission-section" key={group.name}>
                                <legend>{group.name}</legend>
                                {group.permissions
                                    .filter(([id]) => ids.includes(id))
                                    .map(([id, label]) => (
                                        <div className="permission-choice-row" key={id}>
                                            <div>
                                                <strong>{label}</strong>
                                                <small>
                                                    {scope.private && id === 'channels.view'
                                                        ? 'Private by default · Allow to give access'
                                                        : role?.permissions.includes(id)
                                                          ? 'Server role allows this'
                                                          : 'Server role does not grant this'}
                                                </small>
                                            </div>
                                            <div
                                                className="permission-segments"
                                                role="group"
                                                aria-label={`${label} for ${role?.name}`}
                                            >
                                                {(
                                                    [
                                                        ['deny', X, 'Deny'],
                                                        ['inherit', Minus, 'Inherit'],
                                                        ['allow', Check, 'Allow'],
                                                    ] as const
                                                ).map(([value, Icon, title]) => (
                                                    <button
                                                        type="button"
                                                        key={value}
                                                        className={`${value} ${effect(id) === value ? 'active' : ''}`}
                                                        aria-label={`${title} ${label} for ${role?.name}`}
                                                        aria-pressed={effect(id) === value}
                                                        title={title}
                                                        disabled={!canEdit(id)}
                                                        onClick={() => change(id, value)}
                                                    >
                                                        <Icon size={15} />
                                                        <span>{title}</span>
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    ))}
                            </fieldset>
                        ))}
                    <p className="permission-combination-note">
                        Members with several roles combine their permissions. An explicit Allow wins
                        over another role’s Deny. Server ownership always has access.
                    </p>
                </div>
            </div>
            {changed > 0 && (
                <div className="permission-savebar" role="status">
                    <span>
                        {changed} unsaved {changed === 1 ? 'change' : 'changes'}
                    </span>
                    <button disabled={busy} onClick={() => setDrafts({})}>
                        <RotateCcw size={14} />
                        Reset
                    </button>
                    <button
                        className="primary"
                        disabled={busy}
                        onClick={() =>
                            void act(async () => {
                                try {
                                    for (const [role, changes] of Object.entries(drafts)) {
                                        if (!Object.keys(changes).length) continue;
                                        await api(
                                            category
                                                ? `/categories/${scope.id}/access`
                                                : `/roles/${role}/access`,
                                            'PUT',
                                            {
                                                role,
                                                overrides: Object.entries(changes).map(
                                                    ([permission, effect]) => ({
                                                        permission,
                                                        effect,
                                                        ...(!category ? { channel: scope.id } : {}),
                                                    }),
                                                ),
                                            },
                                        );
                                        setDrafts((previous) => {
                                            const next = { ...previous };
                                            delete next[role];
                                            return next;
                                        });
                                    }
                                } finally {
                                    await refresh();
                                }
                            })
                        }
                    >
                        Save changes
                    </button>
                </div>
            )}
        </section>
    );
}
