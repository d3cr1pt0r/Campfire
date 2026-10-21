import {
    useEffect,
    useId,
    useLayoutEffect,
    useRef,
    useState,
    type ReactNode,
    type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { UserPlus, X } from 'lucide-react';
import type { ApiClient } from './api';
import type { Channel, State, User } from './types';
import { InviteMembers } from './InviteMembers';
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
    const [open, setOpen] = useState(false);
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
        const outside = (event: PointerEvent) => {
            if (
                !popup.current?.contains(event.target as Node) &&
                !trigger.current?.contains(event.target as Node)
            )
                close();
        };
        document.addEventListener('pointerdown', outside, true);
        return () => {
            document.removeEventListener('pointerdown', outside, true);
        };
    }, [open]);
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
                        <VoiceInviteMembers
                            channel={channel}
                            state={state}
                            api={api}
                            color={color}
                            searchRef={search}
                        />
                    </div>,
                    document.body,
                )}
        </div>
    );
}

function VoiceInviteMembers({
    channel,
    state,
    api,
    color,
    searchRef,
}: {
    channel: Channel;
    state: State;
    api: ApiClient;
    color: (user?: User) => string | undefined;
    searchRef: RefObject<HTMLInputElement | null>;
}) {
    const [eligible, setEligible] = useState<string[] | null>(null);
    const [error, setError] = useState('');
    useEffect(() => {
        const controller = new AbortController();
        void api<{ users: string[] }>(
            `/voice-channels/${encodeURIComponent(channel.id)}/invitees`,
            'GET',
            undefined,
            controller.signal,
        )
            .then((result) => {
                if (!controller.signal.aborted) setEligible(result.users);
            })
            .catch((reason) => {
                if (!controller.signal.aborted)
                    setError(reason.message || 'Could not load members.');
            });
        return () => controller.abort();
    }, [channel.id, api]);
    return (
        <InviteMembers
            state={state}
            users={state.users.filter((user) => eligible?.includes(user.id))}
            searchRef={searchRef}
            color={color}
            loading={eligible === null && !error}
            error={error}
            unavailable={(member) =>
                state.calls.some((call) => call.user === member.id && call.channel === channel.id)
                    ? 'In channel'
                    : undefined
            }
            onInvite={(user, requestId) =>
                api(`/voice-channels/${encodeURIComponent(channel.id)}/invite`, 'POST', {
                    user,
                    requestId,
                })
            }
        />
    );
}
