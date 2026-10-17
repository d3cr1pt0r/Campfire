import { useCallback, useEffect, useState } from 'react';
import type { ApiClient } from './api';
type Invitation = {
    id: string;
    label: string;
    created: number;
    expires: number;
    usedBy: string | null;
    revoked: number;
};
type Registration = { mode: 'open' | 'invite'; invitations: Invitation[] };
export function RegistrationSettings({ api, url }: { api: ApiClient; url: string }) {
    const [data, setData] = useState<Registration | null>(null);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const [label, setLabel] = useState('');
    const [code, setCode] = useState('');
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [copied, setCopied] = useState('');
    const load = useCallback(async () => setData(await api<Registration>('/registration')), [api]);
    useEffect(() => {
        void load().catch((e) => setError(e.message));
    }, [load]);
    const act = async (action: () => Promise<void>) => {
        setError('');
        setBusy(true);
        try {
            await action();
            await load();
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setBusy(false);
        }
    };
    const changeMode = (mode: 'open' | 'invite') =>
        void act(async () => {
            await api('/registration', 'PATCH', { mode });
            setConfirmOpen(false);
            setCode('');
            setCopied('');
        });
    const copy = async (value: string, message: string) => {
        try {
            await navigator.clipboard.writeText(value);
            setCopied(message);
        } catch {
            setError('Could not copy. Select and copy the invitation code below.');
        }
    };
    return (
        <section className="registration-settings" aria-label="Who can join">
            <h3>Who can join</h3>
            <p className="muted">
                Only the owner can change registration or manage invitations. Existing members can
                always sign in.
            </p>
            {error && <p role="alert">{error}</p>}
            {!data ? (
                <p>Loading registration settings…</p>
            ) : (
                <>
                    <label>
                        Registration
                        <select
                            value={data.mode}
                            disabled={busy}
                            onChange={(e) => {
                                if (e.target.value === 'open') setConfirmOpen(true);
                                else changeMode('invite');
                            }}
                        >
                            <option value="open">Free for all</option>
                            <option value="invite">Invite only</option>
                        </select>
                    </label>
                    {confirmOpen && (
                        <div
                            className="settings-card"
                            role="group"
                            aria-label="Confirm open registration"
                        >
                            <p>
                                Anyone with the server address will be able to create an account and
                                read Member-visible history. All unused invitations will be revoked.
                            </p>
                            <button
                                type="button"
                                disabled={busy}
                                onClick={() => changeMode('open')}
                            >
                                Enable Free for all
                            </button>
                            <button
                                type="button"
                                disabled={busy}
                                onClick={() => setConfirmOpen(false)}
                            >
                                Cancel
                            </button>
                        </div>
                    )}
                    {data.mode === 'invite' && (
                        <>
                            <p className="muted">
                                Each invitation allows one new account and expires after 7 days.
                                Anyone holding the code can use it.
                            </p>
                            <form
                                onSubmit={(e) => {
                                    e.preventDefault();
                                    void act(async () => {
                                        const result = await api<{ code: string }>(
                                            '/invitations',
                                            'POST',
                                            { label },
                                        );
                                        setCode(result.code);
                                        setLabel('');
                                        setCopied('');
                                    });
                                }}
                            >
                                <label>
                                    Invitation label (optional)
                                    <input
                                        value={label}
                                        maxLength={64}
                                        onChange={(e) => setLabel(e.target.value)}
                                        placeholder="Who is this for?"
                                    />
                                </label>
                                <button type="submit" disabled={busy}>
                                    Create invitation
                                </button>
                            </form>
                        </>
                    )}
                    {code && (
                        <div className="settings-card">
                            <label>
                                New invitation code
                                <input
                                    readOnly
                                    value={code}
                                    onFocus={(e) => e.currentTarget.select()}
                                />
                            </label>
                            <p className="muted">
                                Copy this now. The full code is shown only here. Share it with the
                                server address.
                            </p>
                            <button
                                type="button"
                                onClick={() => void copy(code, 'Invitation code copied.')}
                            >
                                Copy code
                            </button>
                            <button
                                type="button"
                                onClick={() =>
                                    void copy(
                                        `${url.replace(/\/$/, '')}/#invite=${code}`,
                                        'Browser invitation link copied.',
                                    )
                                }
                            >
                                Copy browser link
                            </button>
                            <button type="button" onClick={() => setCode('')}>
                                Dismiss code
                            </button>
                        </div>
                    )}
                    {copied && <p role="status">{copied}</p>}
                    <h4>Invitations</h4>
                    {!data.invitations.length && <p className="muted">No invitations yet.</p>}
                    <p className="muted">Showing up to 200 invitations, newest first.</p>
                    {data.invitations.map((invite) => {
                        const status = invite.usedBy
                            ? 'Used'
                            : invite.revoked
                              ? 'Revoked'
                              : invite.expires <= Date.now()
                                ? 'Expired'
                                : 'Available';
                        return (
                            <div className="settings-card" key={invite.id}>
                                <strong>{invite.label || 'Invitation'}</strong> — {status}
                                <p className="muted">
                                    Created {new Date(invite.created).toLocaleString()} · Expires{' '}
                                    {new Date(invite.expires).toLocaleString()}
                                </p>
                                {status === 'Available' && (
                                    <button
                                        type="button"
                                        disabled={busy}
                                        onClick={() =>
                                            void act(async () => {
                                                await api(`/invitations/${invite.id}`, 'DELETE');
                                            })
                                        }
                                    >
                                        Revoke invitation
                                    </button>
                                )}
                            </div>
                        );
                    })}
                </>
            )}
        </section>
    );
}
