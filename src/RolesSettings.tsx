import { useEffect, useState } from 'react';
import { ArrowUp, ArrowDown, Pencil, Plus, Trash2 } from 'lucide-react';
import {
    canManageRole,
    highestPosition,
    hasPermission,
    permissionGroups,
    roleColor,
} from '../shared/permissions.js';
import type { State, User } from './types';
import type { ApiClient } from './api';
import { displayName } from './profiles';

type Props = {
    state: State;
    api: ApiClient;
    busy: boolean;
    refresh: () => Promise<void>;
    act: (fn: () => Promise<void>) => unknown;
    edit: (id: string) => void;
};
export function RolesSettings(props: Props) {
    const { state, api, busy, act, refresh, edit } = props;
    const [deleting, setDeleting] = useState<string | null>(null);
    const can = (id: string) => hasPermission(state.me, state.roles, id);
    return (
        <section className="roles-settings">
            <div className="roles-intro">
                <h3>Role hierarchy</h3>
                <p>
                    Default applies only when a member has no assigned roles. Assigning a role
                    replaces Default; multiple assigned roles combine. Higher roles control
                    management authority and name color.
                </p>
                <p className="owner-notice">
                    Server ownership is protected and cannot be assigned, removed or transferred
                    through roles.
                </p>
            </div>
            {state.roles.map((role, index) => (
                <div className="role-card" key={role.id}>
                    <div className="role-card-heading">
                        <i
                            className="role-color-dot"
                            style={{ background: role.color || 'transparent' }}
                        />
                        <div>
                            <strong>{role.name}</strong>
                            <small>
                                {role.id === 'everyone'
                                    ? 'Fallback · Members without assigned roles'
                                    : `${state.users.filter((user) => user.roles.includes(role.id)).length} ${state.users.filter((user) => user.roles.includes(role.id)).length === 1 ? 'member' : 'members'}`}
                            </small>
                        </div>
                        {can('roles.manage') && role.id !== 'everyone' && (
                            <>
                                <button
                                    title={`Move ${role.name} up`}
                                    aria-label={`Move ${role.name} up`}
                                    disabled={
                                        busy ||
                                        index === 0 ||
                                        !canManageRole(state.me, state.roles, role) ||
                                        !canManageRole(
                                            state.me,
                                            state.roles,
                                            state.roles[index - 1],
                                        )
                                    }
                                    onClick={() =>
                                        void act(async () => {
                                            await api(`/roles/${role.id}/move`, 'POST', {
                                                direction: 'up',
                                            });
                                            await refresh();
                                        })
                                    }
                                >
                                    <ArrowUp size={16} />
                                </button>
                                <button
                                    title={`Move ${role.name} down`}
                                    aria-label={`Move ${role.name} down`}
                                    disabled={
                                        busy ||
                                        state.roles[index + 1]?.id === 'everyone' ||
                                        !state.roles[index + 1] ||
                                        !canManageRole(state.me, state.roles, role) ||
                                        !canManageRole(
                                            state.me,
                                            state.roles,
                                            state.roles[index + 1],
                                        )
                                    }
                                    onClick={() =>
                                        void act(async () => {
                                            await api(`/roles/${role.id}/move`, 'POST', {
                                                direction: 'down',
                                            });
                                            await refresh();
                                        })
                                    }
                                >
                                    <ArrowDown size={16} />
                                </button>
                            </>
                        )}
                        <button
                            title={`Edit ${role.name}`}
                            aria-label={`Edit ${role.name} role`}
                            disabled={
                                busy ||
                                !canManageRole(state.me, state.roles, role) ||
                                (!can('roles.manage') && !can('channels.access'))
                            }
                            onClick={() => edit(role.id)}
                        >
                            <Pencil size={16} />
                        </button>
                        {role.id !== 'everyone' &&
                            can('roles.manage') &&
                            canManageRole(state.me, state.roles, role) && (
                                <button
                                    title={`Delete ${role.name}`}
                                    aria-label={`Delete ${role.name} role`}
                                    disabled={busy}
                                    onClick={() => setDeleting(role.id)}
                                >
                                    <Trash2 size={16} />
                                </button>
                            )}
                    </div>
                    <p className="muted">
                        {role.permissions.length}{' '}
                        {role.permissions.length === 1 ? 'permission' : 'permissions'} ·{' '}
                        {role.color || 'No name color'}
                    </p>
                    {deleting === role.id && (
                        <div className="role-delete-confirm" role="alert">
                            <p>
                                Delete {role.name}? Members keep their other roles. Members with no
                                remaining roles use Default.
                            </p>
                            <button onClick={() => setDeleting(null)}>Cancel</button>
                            <button
                                className="danger-bg"
                                disabled={busy}
                                onClick={() =>
                                    void act(async () => {
                                        await api(`/roles/${role.id}`, 'DELETE');
                                        setDeleting(null);
                                        await refresh();
                                    })
                                }
                            >
                                Delete role
                            </button>
                        </div>
                    )}
                </div>
            ))}
            {can('roles.manage') && (
                <button className="secondary" onClick={() => edit('new')}>
                    <Plus size={16} />
                    Create role
                </button>
            )}
            <h3>Member roles</h3>
            <p className="muted">
                Choose one or more roles to replace Default. Their permissions combine. Clear every
                selection to restore Default.
            </p>
            {state.users.map((user) => (
                <MemberRoles key={`${user.id}:${user.roles.join(',')}`} {...props} user={user} />
            ))}
        </section>
    );
}
function MemberRoles({ state, api, busy, refresh, act, user }: Props & { user: User }) {
    const [selected, setSelected] = useState(user.roles);
    const [channel, setChannel] = useState('');
    const [effective, setEffective] = useState<
        { permission: string; allowed: boolean; reason: string }[] | null
    >(null);
    const [error, setError] = useState('');
    const editable =
        hasPermission(state.me, state.roles, 'roles.assign') &&
        ((state.me.owner && user.id === state.me.id) ||
            (!user.owner &&
                user.id !== state.me.id &&
                highestPosition(state.me, state.roles) > highestPosition(user, state.roles)));
    const inspect =
        hasPermission(state.me, state.roles, 'roles.manage') ||
        hasPermission(state.me, state.roles, 'channels.access') ||
        hasPermission(state.me, state.roles, 'roles.assign');
    useEffect(() => {
        if (!inspect || !channel) {
            setEffective(null);
            return;
        }
        const controller = new AbortController();
        setError('');
        void api<{ details: { permission: string; allowed: boolean; reason: string }[] }>(
            `/users/${user.id}/permissions?channel=${encodeURIComponent(channel)}`,
            'GET',
            undefined,
            controller.signal,
        )
            .then((data) => {
                if (!controller.signal.aborted) setEffective(data.details);
            })
            .catch((e) => {
                if (!controller.signal.aborted) setError(e.message);
            });
        return () => controller.abort();
    }, [api, channel, user.id, state]);
    return (
        <details className="member-roles-card">
            <summary>
                <strong style={{ color: roleColor(user, state.roles) }}>{displayName(user)}</strong>
                <span>
                    {user.owner ? 'Owner · ' : ''}
                    {state.roles
                        .filter((role) => selected.includes(role.id))
                        .map((role) => role.name)
                        .join(' · ') ||
                        state.roles.find((role) => role.id === 'everyone')?.name ||
                        'Default'}
                </span>
            </summary>
            {user.owner && !state.me.owner ? (
                <p className="owner-notice">
                    Owner · Always has every permission. Ownership cannot be changed here.
                </p>
            ) : (
                <form
                    onSubmit={(event) => {
                        event.preventDefault();
                        void act(async () => {
                            await api(`/users/${user.id}/roles`, 'PATCH', { roles: selected });
                            await refresh();
                        });
                    }}
                >
                    <div className="member-role-options">
                        <span className="role-badge">
                            {selected.length
                                ? 'Default does not apply while roles are assigned'
                                : `${state.roles.find((role) => role.id === 'everyone')?.name || 'Default'} · Active fallback`}
                        </span>
                        {state.roles
                            .filter((role) => role.id !== 'everyone')
                            .map((role) => (
                                <label className="checkbox-label" key={role.id}>
                                    <input
                                        type="checkbox"
                                        checked={selected.includes(role.id)}
                                        disabled={
                                            busy ||
                                            !editable ||
                                            !canManageRole(state.me, state.roles, role) ||
                                            (!state.me.owner &&
                                                role.permissions.some(
                                                    (p) => !hasPermission(state.me, state.roles, p),
                                                ))
                                        }
                                        onChange={(event) =>
                                            setSelected(
                                                event.target.checked
                                                    ? [...selected, role.id]
                                                    : selected.filter((id) => id !== role.id),
                                            )
                                        }
                                    />
                                    <span style={{ color: role.color || undefined }}>
                                        {role.name}
                                    </span>
                                </label>
                            ))}
                    </div>
                    {editable && (
                        <button
                            className="secondary"
                            disabled={
                                busy ||
                                [...selected].sort().join() === [...user.roles].sort().join()
                            }
                        >
                            Save member roles
                        </button>
                    )}
                </form>
            )}
            {inspect && (
                <div className="permission-inspector">
                    <label>
                        Check effective permissions
                        <select
                            aria-label={`Inspect ${displayName(user)} in channel`}
                            value={channel}
                            onChange={(event) => setChannel(event.target.value)}
                        >
                            <option value="">Choose a channel</option>
                            {state.channels.map((entry) => (
                                <option key={entry.id} value={entry.id}>
                                    {entry.name}
                                </option>
                            ))}
                        </select>
                    </label>
                    {error && <p role="alert">{error}</p>}
                    {effective && (
                        <div className="effective-permission-list">
                            {effective.map((entry) => (
                                <div key={entry.permission}>
                                    <strong>
                                        {
                                            permissionGroups
                                                .flatMap((group) => group.permissions)
                                                .find(([id]) => id === entry.permission)?.[1]
                                        }{' '}
                                        · {entry.allowed ? 'Allowed' : 'Denied'}
                                    </strong>
                                    <small>{entry.reason}</small>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </details>
    );
}
