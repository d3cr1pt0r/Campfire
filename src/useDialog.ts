import { useEffect, useRef, type RefObject } from 'react';

const dialogs: HTMLElement[] = [];
const selector =
    'button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],[tabindex="0"]';

export function useDialog(
    container: RefObject<HTMLElement | null>,
    onClose: () => void,
    enabled = true,
    initialFocus?: RefObject<HTMLElement | null>,
) {
    const close = useRef(onClose);
    close.current = onClose;
    useEffect(() => {
        const element = container.current;
        if (!enabled || !element) return;
        const previous = document.activeElement as HTMLElement | null;
        dialogs.push(element);
        (initialFocus?.current || element.querySelector<HTMLElement>(selector) || element).focus({
            preventScroll: true,
        });
        const key = (event: KeyboardEvent) => {
            if (dialogs.at(-1) !== element) return;
            if (event.key === 'Escape') {
                event.preventDefault();
                event.stopImmediatePropagation();
                if (document.fullscreenElement === element)
                    void document.exitFullscreen().catch(() => {});
                else close.current();
            }
            if (event.key === 'Tab') {
                const elements = [...element.querySelectorAll<HTMLElement>(selector)].filter(
                    (item) => item.getClientRects().length > 0,
                );
                const first = elements[0],
                    last = elements.at(-1);
                if (!first) {
                    event.preventDefault();
                    element.focus();
                } else if (
                    event.shiftKey &&
                    (document.activeElement === first || !element.contains(document.activeElement))
                ) {
                    event.preventDefault();
                    last?.focus();
                } else if (
                    !event.shiftKey &&
                    (document.activeElement === last || !element.contains(document.activeElement))
                ) {
                    event.preventDefault();
                    first.focus();
                }
            }
        };
        document.addEventListener('keydown', key, true);
        return () => {
            document.removeEventListener('keydown', key, true);
            const index = dialogs.indexOf(element);
            if (index >= 0) dialogs.splice(index, 1);
            if (document.fullscreenElement === element)
                void document.exitFullscreen().catch(() => {});
            if (previous?.isConnected) previous.focus({ preventScroll: true });
        };
    }, [container, enabled, initialFocus]);
}
