import { useEffect, useRef, useState, type RefObject } from 'react';
import { Check, Search } from 'lucide-react';
import type { State, User } from './types';
import { MemberIdentity } from './MemberIdentity';
import { displayName } from './profiles';
import { inviteMembers } from './inviteCandidates';

// Mount once per open dialog: delivery feedback belongs to that opening only.
export function InviteMembers({
    state,
    users,
    color,
    onInvite,
    unavailable,
    loading = false,
    error = '',
    disabled = false,
    searchRef,
}: {
    state: State;
    users: User[];
    color: (user?: User) => string | undefined;
    onInvite: (user: string, requestId: string) => Promise<unknown>;
    unavailable: (user: User) => string | undefined;
    loading?: boolean;
    error?: string;
    disabled?: boolean;
    searchRef?: RefObject<HTMLInputElement | null>;
}) {
    const [query, setQuery] = useState('');
    const [sent, setSent] = useState(new Set<string>());
    const [sending, setSending] = useState(new Set<string>());
    const [sendError, setSendError] = useState('');
    const pending = useRef(new Set<string>());
    const requests = useRef(new Map<string, string>());
    const active = useRef(true);
    useEffect(() => {
        active.current = true;
        return () => {
            active.current = false;
        };
    }, []);
    const invite = async (member: User) => {
        if (
            disabled ||
            sent.has(member.id) ||
            pending.current.has(member.id) ||
            unavailable(member)
        )
            return;
        pending.current.add(member.id);
        setSending(new Set(pending.current));
        setSendError('');
        // Keep the same ID on a failed/ambiguous retry, but use fresh IDs when
        // the dialog is reopened for a deliberate new invitation.
        const requestId = requests.current.get(member.id) || crypto.randomUUID();
        requests.current.set(member.id, requestId);
        try {
            await onInvite(member.id, requestId);
            if (active.current) setSent((previous) => new Set([...previous, member.id]));
        } catch (reason) {
            if (active.current)
                setSendError(
                    reason instanceof Error
                        ? reason.message
                        : 'Invitation could not be sent. Try again.',
                );
        } finally {
            pending.current.delete(member.id);
            if (active.current) setSending(new Set(pending.current));
        }
    };
    const members = inviteMembers(state, users, query);
    return (
        <>
            <label className="voice-invite-search">
                <Search size={16} />
                <input
                    ref={searchRef}
                    type="search"
                    value={query}
                    placeholder="Search members"
                    aria-label="Search members to invite"
                    onChange={(event) => setQuery(event.target.value)}
                />
            </label>
            {(error || sendError) && (
                <p className="voice-invite-error" role="alert">
                    {error || sendError}
                </p>
            )}
            <div className="voice-invite-list" aria-label="Members to invite" aria-busy={loading}>
                {loading ? (
                    <p role="status">Loading members…</p>
                ) : !members.length ? (
                    <p role="status">
                        {query.trim() ? 'No matching members.' : 'No members available to invite.'}
                    </p>
                ) : (
                    members.map((member) => {
                        const delivered = sent.has(member.id),
                            pending = sending.has(member.id),
                            reason = unavailable(member);
                        return (
                            <div className="voice-invite-member" key={member.id}>
                                <MemberIdentity
                                    user={member}
                                    state={state}
                                    color={color(member)}
                                    textClassName="voice-invite-identity"
                                />
                                <button
                                    type="button"
                                    className={`secondary ${delivered ? 'invite-sent' : ''}`}
                                    aria-label={`${delivered ? 'Invitation sent to' : 'Invite'} ${displayName(member)}`}
                                    title={reason}
                                    disabled={disabled || delivered || pending || !!reason}
                                    onClick={() => void invite(member)}
                                >
                                    {delivered ? (
                                        <>
                                            <Check size={13} />
                                            Sent
                                        </>
                                    ) : pending ? (
                                        'Sending…'
                                    ) : (
                                        reason || 'Invite'
                                    )}
                                </button>
                            </div>
                        );
                    })
                )}
            </div>
        </>
    );
}
