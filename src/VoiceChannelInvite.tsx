import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Search, UserPlus, X, Check } from 'lucide-react';
import type { ApiClient } from './api';
import type { Channel, State, User } from './types';
import { Avatar } from './Avatar';
import { displayName } from './profiles';
import { useDialog } from './useDialog';

export function VoiceChannelInvite({
    channel,
    state,
    api,
    disabled,
    children,
    color,
}: {
    channel: Channel;
    state: State;
    api: ApiClient;
    disabled: boolean;
    children: ReactNode;
    color: (user?: User) => string | undefined;
}) {
    const [open, setOpen] = useState(false),
        [query, setQuery] = useState('');
    const [eligible, setEligible] = useState<string[] | null>(null);
    const [sent, setSent] = useState<Set<string>>(() => new Set());
    const [sending, setSending] = useState<Set<string>>(() => new Set());
    const [error, setError] = useState('');
    const inFlight = useRef(new Set<string>());
    const trigger = useRef<HTMLButtonElement>(null),
        popup = useRef<HTMLDivElement>(null),
        search = useRef<HTMLInputElement>(null);
    const id = useId();
    const close = () => setOpen(false);
    useDialog(popup, close, open, search);
    useEffect(() => {
        if (disabled) setOpen(false);
    }, [disabled]);
    useEffect(() => {
        if (!open) return;
        const controller = new AbortController();
        setQuery('');
        setEligible(null);
        setError('');
        void api<{ users: string[]; sent: string[] }>(
            `/voice-channels/${encodeURIComponent(channel.id)}/invitees`,
            'GET',
            undefined,
            controller.signal,
        )
            .then((result) => {
                if (!controller.signal.aborted) {
                    setEligible(result.users);
                    setSent((previous) => new Set([...previous, ...result.sent]));
                }
            })
            .catch((reason) => {
                if (!controller.signal.aborted)
                    setError(reason.message || 'Could not load members.');
            });
        const outside = (event: PointerEvent) => {
            if (
                !popup.current?.contains(event.target as Node) &&
                !trigger.current?.contains(event.target as Node)
            )
                close();
        };
        document.addEventListener('pointerdown', outside, true);
        return () => {
            controller.abort();
            document.removeEventListener('pointerdown', outside, true);
        };
    }, [open, channel.id, api]);
    useLayoutEffect(() => {
        if (!open || !popup.current || !trigger.current) return;
        const place = () => {
            const anchor = trigger.current!.getBoundingClientRect(),
                node = popup.current!;
            node.style.left = `${Math.max(8, Math.min(anchor.right + 8, innerWidth - node.offsetWidth - 8))}px`;
            node.style.top = `${Math.max(8, Math.min(anchor.top, innerHeight - node.offsetHeight - 8))}px`;
        };
        place();
        const observer = new ResizeObserver(place);
        observer.observe(popup.current);
        const scroll = (event: Event) => {
            if (!popup.current?.contains(event.target as Node)) close();
        };
        window.addEventListener('resize', place);
        window.addEventListener('scroll', scroll, true);
        return () => {
            observer.disconnect();
            window.removeEventListener('resize', place);
            window.removeEventListener('scroll', scroll, true);
        };
    }, [open]);
    const invite = async (user: string) => {
        if (inFlight.current.has(user) || sent.has(user)) return;
        inFlight.current.add(user);
        setSending(new Set(inFlight.current));
        setError('');
        try {
            await api(`/voice-channels/${encodeURIComponent(channel.id)}/invite`, 'POST', { user });
            setSent((previous) => new Set([...previous, user]));
        } catch (reason) {
            setError(
                reason instanceof Error
                    ? reason.message
                    : 'Invitation could not be sent. Try again.',
            );
        } finally {
            inFlight.current.delete(user);
            setSending(new Set(inFlight.current));
        }
    };
    const term = query.trim().toLocaleLowerCase();
    const users = state.users
        .filter(
            (user) =>
                eligible?.includes(user.id) &&
                `${displayName(user)} ${user.username}`.toLocaleLowerCase().includes(term),
        )
        .sort(
            (a, b) =>
                Number(state.online.includes(b.id)) - Number(state.online.includes(a.id)) ||
                displayName(a).localeCompare(displayName(b)),
        );
    return (
        <div className={`voice-channel-row ${open ? 'invite-open' : ''}`}>
            {children}
            <button
                type="button"
                className="voice-channel-invite"
                ref={trigger}
                disabled={disabled}
                title={`Invite to ${channel.name}`}
                aria-label={`Invite to ${channel.name}`}
                aria-haspopup="dialog"
                aria-expanded={open}
                aria-controls={open ? id : undefined}
                onClick={(event) => {
                    event.currentTarget.focus();
                    setOpen((previous) => !previous);
                }}
            >
                <UserPlus size={16} />
            </button>
            {open &&
                createPortal(
                    <div
                        className="voice-invite-popup"
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby={`${id}-title`}
                        id={id}
                        ref={popup}
                    >
                        <header>
                            <div>
                                <strong id={`${id}-title`}>Invite to {channel.name}</strong>
                                <p>Send an invitation in a direct message.</p>
                            </div>
                            <button type="button" aria-label="Close invitations" onClick={close}>
                                <X size={17} />
                            </button>
                        </header>
                        <label className="voice-invite-search">
                            <Search size={16} />
                            <input
                                ref={search}
                                type="search"
                                value={query}
                                placeholder="Search members"
                                aria-label="Search members to invite"
                                onChange={(event) => setQuery(event.target.value)}
                            />
                        </label>
                        {error && (
                            <p className="voice-invite-error" role="alert">
                                {error}
                            </p>
                        )}
                        <div className="voice-invite-list" aria-label="Members to invite">
                            {eligible === null && !error ? (
                                <p role="status">Loading members…</p>
                            ) : !users.length ? (
                                <p role="status">
                                    {term
                                        ? 'No matching members.'
                                        : 'No members available to invite.'}
                                </p>
                            ) : (
                                users.map((member) => {
                                    const delivered = sent.has(member.id),
                                        pending = sending.has(member.id),
                                        joined = state.calls.some(
                                            (call) =>
                                                call.user === member.id &&
                                                call.channel === channel.id,
                                        );
                                    return (
                                        <div className="voice-invite-member" key={member.id}>
                                            <Avatar user={member} color={color(member)} small />
                                            <div className="voice-invite-identity">
                                                <strong>{displayName(member)}</strong>
                                                <small>
                                                    @{member.username} ·{' '}
                                                    {state.online.includes(member.id)
                                                        ? 'Online'
                                                        : 'Offline'}
                                                </small>
                                            </div>
                                            <button
                                                type="button"
                                                className={`secondary ${delivered ? 'invite-sent' : ''}`}
                                                aria-label={`${delivered ? 'Invitation sent to' : 'Invite'} ${displayName(member)}`}
                                                disabled={delivered || pending || joined}
                                                onClick={() => void invite(member.id)}
                                            >
                                                {delivered ? (
                                                    <>
                                                        <Check size={13} />
                                                        Sent
                                                    </>
                                                ) : pending ? (
                                                    'Sending…'
                                                ) : joined ? (
                                                    'In channel'
                                                ) : (
                                                    'Invite'
                                                )}
                                            </button>
                                        </div>
                                    );
                                })
                            )}
                        </div>
                    </div>,
                    document.body,
                )}
        </div>
    );
}
