import {
    useEffect,
    useLayoutEffect,
    useRef,
    useState,
    type HTMLAttributes,
    type KeyboardEvent,
    type MouseEvent,
} from 'react';
import { createPortal } from 'react-dom';

export function useNotificationContextMenu(
    unread: Record<string, number>,
    latest: Record<string, number>,
    clear: (room: string, through: number) => void,
) {
    const [menu, setMenu] = useState<{
        room: string;
        through: number;
        x: number;
        y: number;
        trigger: HTMLElement;
    } | null>(null);
    const popup = useRef<HTMLDivElement>(null);
    const visible = menu && unread[menu.room] > 0 ? menu : null;
    const close = (restore = false) => {
        if (restore) menu?.trigger.focus();
        setMenu(null);
    };
    useLayoutEffect(() => {
        if (!visible || !popup.current) return;
        const node = popup.current;
        node.style.left = `${Math.max(8, Math.min(visible.x, innerWidth - node.offsetWidth - 8))}px`;
        node.style.top = `${Math.max(8, Math.min(visible.y, innerHeight - node.offsetHeight - 8))}px`;
        node.querySelector('button')?.focus();
    }, [visible]);
    useEffect(() => {
        if (!visible) return;
        const outside = (event: PointerEvent) => {
            if (!popup.current?.contains(event.target as Node)) setMenu(null);
        };
        const dismiss = () => setMenu(null);
        document.addEventListener('pointerdown', outside, true);
        window.addEventListener('resize', dismiss);
        window.addEventListener('scroll', dismiss, true);
        window.addEventListener('blur', dismiss);
        return () => {
            document.removeEventListener('pointerdown', outside, true);
            window.removeEventListener('resize', dismiss);
            window.removeEventListener('scroll', dismiss, true);
            window.removeEventListener('blur', dismiss);
        };
    }, [visible]);
    const handlers = (room: string): HTMLAttributes<HTMLElement> => {
        const open = (
            event: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>,
            x: number,
            y: number,
        ) => {
            if (!(unread[room] > 0)) return;
            event.preventDefault();
            event.stopPropagation();
            setMenu({ room, through: latest[room], x, y, trigger: event.currentTarget });
        };
        return {
            onContextMenu: (event) => open(event, event.clientX, event.clientY),
            onKeyDown: (event) => {
                if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
                    const rect = event.currentTarget.getBoundingClientRect();
                    open(event, rect.left, rect.bottom);
                }
            },
        };
    };
    return {
        handlers,
        menu:
            visible &&
            createPortal(
                <div
                    ref={popup}
                    className="notification-context-menu"
                    role="menu"
                    aria-label="Conversation notifications"
                    style={{ left: visible.x, top: visible.y }}
                    onKeyDown={(event) => {
                        if (event.key === 'Escape' || event.key === 'Tab') {
                            event.preventDefault();
                            event.stopPropagation();
                            close(true);
                        }
                    }}
                >
                    <button
                        role="menuitem"
                        onClick={() => {
                            clear(visible.room, visible.through);
                            close(true);
                        }}
                    >
                        Clear notifications
                    </button>
                </div>,
                document.body,
            ),
    };
}
