import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Avatar } from './Avatar';
import { Emoji } from './ChatContent';
import { displayName } from './profiles';
import type { State, User } from './types';

export function ReactionChip({
    emoji,
    people,
    mine,
    showNames,
    canReact,
    custom,
    onReact,
}: {
    emoji: string;
    people: { id: string; user?: User }[];
    mine: boolean;
    showNames: boolean;
    canReact: boolean;
    custom: State['emojis'];
    onReact: () => void;
}) {
    const trigger = useRef<HTMLButtonElement>(null);
    const popup = useRef<HTMLDivElement>(null);
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const focused = useRef(false);
    const id = useId();
    const [open, setOpen] = useState(false);
    const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
    const cancelHide = () => {
        if (timer.current) clearTimeout(timer.current);
        timer.current = null;
    };
    const show = () => {
        cancelHide();
        if (showNames) setOpen(true);
    };
    const hideSoon = () => {
        cancelHide();
        if (!focused.current)
            timer.current = setTimeout(() => {
                setOpen(false);
                setPosition(null);
            }, 120);
    };
    useEffect(
        () => () => {
            if (timer.current) clearTimeout(timer.current);
        },
        [],
    );
    useLayoutEffect(() => {
        if (!open || !showNames || !trigger.current || !popup.current) return;
        const anchor = trigger.current.getBoundingClientRect();
        const box = popup.current.getBoundingClientRect();
        const above = anchor.top - box.height - 8;
        setPosition({
            left: Math.max(
                8,
                Math.min(
                    anchor.left + anchor.width / 2 - box.width / 2,
                    window.innerWidth - box.width - 8,
                ),
            ),
            top: Math.max(
                8,
                Math.min(
                    above >= 8 ? above : anchor.bottom + 8,
                    window.innerHeight - box.height - 8,
                ),
            ),
        });
        const dismiss = (event: Event) => {
            if (event.type === 'scroll' && popup.current?.contains(event.target as Node)) return;
            setOpen(false);
            setPosition(null);
        };
        window.addEventListener('scroll', dismiss, true);
        window.addEventListener('resize', dismiss);
        window.addEventListener('blur', dismiss);
        return () => {
            window.removeEventListener('scroll', dismiss, true);
            window.removeEventListener('resize', dismiss);
            window.removeEventListener('blur', dismiss);
        };
    }, [open, showNames, people.length]);
    return (
        <>
            <button
                ref={trigger}
                className={mine ? 'mine' : ''}
                aria-label={`${emoji}: ${people.length} ${people.length === 1 ? 'reaction' : 'reactions'}`}
                aria-pressed={mine}
                aria-disabled={!canReact}
                aria-describedby={open && showNames ? id : undefined}
                onMouseEnter={show}
                onMouseLeave={hideSoon}
                onFocus={() => {
                    focused.current = true;
                    show();
                }}
                onBlur={() => {
                    focused.current = false;
                    hideSoon();
                }}
                onKeyDown={(event) => {
                    if (event.key === 'Escape' && open) {
                        event.stopPropagation();
                        cancelHide();
                        setOpen(false);
                        setPosition(null);
                    }
                }}
                onClick={() => {
                    if (canReact) onReact();
                }}
            >
                <Emoji value={emoji} custom={custom} />
                <span>{people.length}</span>
            </button>
            {open &&
                showNames &&
                createPortal(
                    <div
                        ref={popup}
                        id={id}
                        role="tooltip"
                        className="reaction-popup"
                        style={{
                            left: position?.left ?? 0,
                            top: position?.top ?? 0,
                            visibility: position ? 'visible' : 'hidden',
                        }}
                        onMouseEnter={cancelHide}
                        onMouseLeave={hideSoon}
                    >
                        <div className="reaction-popup-heading">
                            <Emoji value={emoji} custom={custom} />
                            <strong>
                                {people.length} {people.length === 1 ? 'reaction' : 'reactions'}
                            </strong>
                        </div>
                        <ul>
                            {people.map((person) => (
                                <li key={person.id}>
                                    <Avatar user={person.user} small />
                                    <span>{displayName(person.user)}</span>
                                </li>
                            ))}
                        </ul>
                    </div>,
                    document.body,
                )}
        </>
    );
}
