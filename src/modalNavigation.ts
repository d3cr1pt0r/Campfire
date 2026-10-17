import { useCallback, useState, type SetStateAction } from 'react';

export function navigateModals(stack: readonly string[], next: string | null): string[] {
    if (next === null) return stack.slice(0, -1);
    const index = stack.lastIndexOf(next);
    // Returning to an existing dialog must not add another copy of it.
    return index >= 0 ? stack.slice(0, index + 1) : [...stack, next];
}

export function useModalNavigation() {
    const [stack, setStack] = useState<string[]>([]);
    const setModal = useCallback((next: SetStateAction<string | null>) => {
        setStack((previous) =>
            navigateModals(
                previous,
                typeof next === 'function' ? next(previous.at(-1) ?? null) : next,
            ),
        );
    }, []);
    const resetModals = useCallback(() => setStack([]), []);
    return { modal: stack.at(-1) ?? null, setModal, resetModals };
}
