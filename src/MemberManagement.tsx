import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { highestPosition } from '../shared/permissions.js';
import { Avatar } from './Avatar';
import { displayName } from './profiles';
import type { ApiClient } from './api';
import type { State } from './types';

export function MemberManagement({
    state,
    permission,
    busy,
    act,
    api,
    refresh,
    notify,
}: {
    state: State;
    permission: (id: string) => boolean;
    busy: boolean;
    act: (action: () => Promise<unknown>) => Promise<void>;
    api: ApiClient;
    refresh: () => Promise<void>;
    notify: (message: string) => void;
}) {
    const [query, setQuery] = useState('');
    const [confirmation, setConfirmation] = useState<{
        id: string;
        action: 'disable' | 'delete';
    } | null>(null);
    const confirmationRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (!confirmation) return;
        const panel = confirmationRef.current;
        panel?.scrollIntoView({ block: 'nearest' });
        panel?.querySelector<HTMLElement>('input, button')?.focus({ preventScroll: true });
    }, [confirmation]);
    const [username, setUsername] = useState('');
    const [reset, setReset] = useState<{
        id: string;
        username: string;
        token: string;
        expires: number;
    } | null>(null);
    const members = [
        ...state.users.map((user) => ({ user, disabled: false })),
        ...(state.removedUsers || []).map((user) => ({ user, disabled: true })),
    ].filter(
        ({ user }) =>
            !user.owner &&
            user.id !== state.me.id &&
            highestPosition(state.me, state.roles) > highestPosition(user, state.roles),
    );
    const visible = members.filter(({ user }) =>
        `${displayName(user)} ${user.username}`.toLowerCase().includes(query.trim().toLowerCase()),
    );
    return (
        <section className="account-section server-members" aria-label="Manage members">
            <h3>Manage members</h3>
            <p className="field-help">Select a member to manage their account and server access.</p>
            <label>
                Find a member
                <input
                    type="search"
                    placeholder="Name or username"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                />
            </label>
            {!visible.length && (
                <p className="muted">
                    {members.length ? 'No matching members.' : 'No members you can manage.'}
                </p>
            )}
            <div className="server-member-list">
                {visible.map(({ user, disabled }) => {
                    const name = displayName(user);
                    const pending = confirmation?.id === user.id ? confirmation.action : null;
                    return (
                        <details
                            key={user.id}
                            className="server-member-card"
                            name="managed-member"
                            onToggle={(event) => {
                                if (!event.currentTarget.open) {
                                    setConfirmation((current) =>
                                        current?.id === user.id ? null : current,
                                    );
                                    setReset((current) =>
                                        current?.id === user.id ? null : current,
                                    );
                                }
                            }}
                        >
                            <summary>
                                <Avatar user={user} small />
                                <span className="server-member-identity">
                                    <strong>{name}</strong>
                                    <small>@{user.username}</small>
                                </span>
                                <span
                                    className={`server-member-status ${disabled ? 'is-disabled' : ''}`}
                                >
                                    {disabled ? 'Disabled' : 'Active'}
                                </span>
                                <ChevronDown size={16} className="server-member-chevron" />
                            </summary>
                            <div className="server-member-actions">
                                {!disabled && permission('members.resetPassword') && (
                                    <div className="server-member-action">
                                        <div>
                                            <strong>Password recovery</strong>
                                            <p>
                                                Create a one-time token for this member to reset
                                                their password.
                                            </p>
                                        </div>
                                        <button
                                            disabled={busy}
                                            onClick={() =>
                                                void act(async () => {
                                                    const result = await api<{
                                                        token: string;
                                                        expires: number;
                                                    }>(`/users/${user.id}/password-reset`, 'POST');
                                                    setReset({
                                                        id: user.id,
                                                        username: user.username,
                                                        ...result,
                                                    });
                                                })
                                            }
                                        >
                                            Generate token
                                        </button>
                                    </div>
                                )}
                                {reset?.id === user.id && (
                                    <div className="password-reset-result" role="status">
                                        <strong>Password reset token for @{reset.username}</strong>
                                        <input
                                            aria-label="Generated password reset token"
                                            readOnly
                                            value={reset.token}
                                            onFocus={(event) => event.target.select()}
                                        />
                                        <p className="field-help">
                                            Share privately. Works once; expires at{' '}
                                            {new Date(reset.expires).toLocaleTimeString()}.
                                            Generating another token replaces it.
                                        </p>
                                        <div className="server-member-buttons">
                                            <button
                                                disabled={busy}
                                                onClick={() =>
                                                    void act(async () => {
                                                        await navigator.clipboard.writeText(
                                                            reset.token,
                                                        );
                                                        notify('Password reset token copied.');
                                                    })
                                                }
                                            >
                                                Copy token
                                            </button>
                                            <button onClick={() => setReset(null)}>Dismiss</button>
                                        </div>
                                    </div>
                                )}
                                {(disabled
                                    ? permission('members.restore')
                                    : permission('members.ban')) && (
                                    <div className="server-member-action">
                                        <div>
                                            <strong>Server access</strong>
                                            <p>
                                                {disabled
                                                    ? 'Allow this member to sign in again.'
                                                    : 'End all sessions and block sign-in. The account stays and access can be restored.'}
                                            </p>
                                        </div>
                                        <button
                                            disabled={busy}
                                            className={disabled ? '' : 'danger-text'}
                                            onClick={() => {
                                                if (disabled)
                                                    void act(async () => {
                                                        await api(
                                                            `/users/${user.id}/access`,
                                                            'POST',
                                                            { enabled: true },
                                                        );
                                                        await refresh();
                                                    });
                                                else
                                                    setConfirmation({
                                                        id: user.id,
                                                        action: 'disable',
                                                    });
                                            }}
                                        >
                                            {disabled ? 'Restore access' : 'Disable access'}
                                        </button>
                                    </div>
                                )}
                                {permission('members.delete') && (
                                    <div className="server-member-action">
                                        <div>
                                            <strong>Delete account</strong>
                                            <p>
                                                Permanently remove the account and credentials.
                                                Channel messages remain as Former member.
                                            </p>
                                        </div>
                                        <button
                                            className="danger-text"
                                            disabled={busy}
                                            onClick={() => {
                                                setUsername('');
                                                setConfirmation({ id: user.id, action: 'delete' });
                                            }}
                                        >
                                            Delete account
                                        </button>
                                    </div>
                                )}
                                {pending && (
                                    <div
                                        className="server-member-confirmation"
                                        role="alert"
                                        ref={confirmationRef}
                                    >
                                        <strong>
                                            {pending === 'delete'
                                                ? `Permanently delete @${user.username}?`
                                                : `Disable access for ${name}?`}
                                        </strong>
                                        <p>
                                            {pending === 'delete'
                                                ? 'This cannot be undone. Sessions, recovery tokens, profile, avatar and reactions are removed, and so are their direct messages and personal notes with their files. Channel messages, their attachments and shared emojis remain. The username becomes available for a new account.'
                                                : 'All sessions will end. This member cannot sign in until their access is restored.'}
                                        </p>
                                        {pending === 'delete' && (
                                            <label>
                                                Type {user.username} to confirm
                                                <input
                                                    autoComplete="off"
                                                    spellCheck={false}
                                                    value={username}
                                                    onChange={(event) =>
                                                        setUsername(event.target.value)
                                                    }
                                                />
                                            </label>
                                        )}
                                        <div className="server-member-buttons">
                                            <button
                                                disabled={busy}
                                                onClick={() => setConfirmation(null)}
                                            >
                                                Cancel
                                            </button>
                                            <button
                                                className="danger-bg"
                                                disabled={
                                                    busy ||
                                                    (pending === 'delete' &&
                                                        username !== user.username)
                                                }
                                                onClick={() =>
                                                    void act(async () => {
                                                        if (pending === 'delete')
                                                            await api(
                                                                `/users/${user.id}`,
                                                                'DELETE',
                                                                { username },
                                                            );
                                                        else
                                                            await api(
                                                                `/users/${user.id}/access`,
                                                                'POST',
                                                                { enabled: false },
                                                            );
                                                        setConfirmation(null);
                                                        setReset(null);
                                                        await refresh();
                                                        notify(
                                                            pending === 'delete'
                                                                ? 'Account permanently deleted.'
                                                                : 'Member access disabled.',
                                                        );
                                                    })
                                                }
                                            >
                                                {pending === 'delete'
                                                    ? 'Permanently delete account'
                                                    : 'Confirm disable'}
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </details>
                    );
                })}
            </div>
        </section>
    );
}
