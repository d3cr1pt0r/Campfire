import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { MemberIdentity } from './MemberIdentity';
import type { User } from './types';

// A list of people that opens on hover or keyboard focus of a button, such as who
// reacted with an emoji or who chose a poll answer.
export function usePeoplePopup(enabled: boolean, count: number) {
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
    const close = () => {
        setOpen(false);
        setPosition(null);
    };
    const show = () => {
        cancelHide();
        if (enabled) setOpen(true);
    };
    const hideSoon = () => {
        cancelHide();
        if (!focused.current) timer.current = setTimeout(close, 120);
    };
    useEffect(
        () => () => {
            if (timer.current) clearTimeout(timer.current);
        },
        [],
    );
    useLayoutEffect(() => {
        if (!open || !enabled || !trigger.current || !popup.current) return;
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
            close();
        };
        window.addEventListener('scroll', dismiss, true);
        window.addEventListener('resize', dismiss);
        window.addEventListener('blur', dismiss);
        return () => {
            window.removeEventListener('scroll', dismiss, true);
            window.removeEventListener('resize', dismiss);
            window.removeEventListener('blur', dismiss);
        };
    }, [open, enabled, count]);
    const triggerProps = {
        ref: trigger,
        'aria-describedby': open && enabled ? id : undefined,
        onMouseEnter: show,
        onMouseLeave: hideSoon,
        onFocus: () => {
            focused.current = true;
            show();
        },
        onBlur: () => {
            focused.current = false;
            hideSoon();
        },
        onKeyDown: (event: React.KeyboardEvent) => {
            if (event.key === 'Escape' && open) {
                event.stopPropagation();
                cancelHide();
                close();
            }
        },
    };
    const render = (heading: ReactNode, people: { id: string; user?: User }[]) =>
        open &&
        enabled &&
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
                <div className="reaction-popup-heading">{heading}</div>
                <ul>
                    {people.map((person) => (
                        <li key={person.id}>
                            <MemberIdentity user={person.user} />
                        </li>
                    ))}
                </ul>
            </div>,
            document.body,
        );
    return { triggerProps, render };
}
