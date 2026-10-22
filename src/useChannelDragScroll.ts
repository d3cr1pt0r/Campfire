import { useEffect, type RefObject } from 'react';

// Native HTML dragging can consume wheel input. Keep the organizer reachable by
// scrolling while the pointer is held near either edge, including between rows.
export function useChannelDragScroll(tree: RefObject<HTMLDivElement | null>, active: boolean) {
    useEffect(() => {
        if (!active) return;
        const outline = tree.current?.closest<HTMLElement>('.organizer-outline');
        if (!outline) return;

        let pointer: { x: number; y: number } | null = null;
        let frame = 0;
        let lastTime = 0;
        const inside = (x: number, y: number) => {
            const rect = outline.getBoundingClientRect();
            return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
        };
        const scroll = (time: number) => {
            const elapsed = lastTime ? Math.min(time - lastTime, 50) : 0;
            lastTime = time;
            if (pointer && inside(pointer.x, pointer.y)) {
                const rect = outline.getBoundingClientRect();
                const edge = Math.min(64, rect.height / 4);
                const top = Math.max(0, Math.min(1, (rect.top + edge - pointer.y) / edge));
                const bottom = Math.max(0, Math.min(1, (pointer.y - rect.bottom + edge) / edge));
                outline.scrollTop += ((bottom - top) * 700 * elapsed) / 1000;
            }
            frame = requestAnimationFrame(scroll);
        };
        const move = (event: DragEvent) => {
            pointer = { x: event.clientX, y: event.clientY };
        };
        const leave = (event: DragEvent) => {
            // Scrolling can fire dragleave on a row without leaving the list.
            if (!event.relatedTarget && event.target === document.documentElement) pointer = null;
        };
        const wheel = (event: WheelEvent) => {
            if (!inside(event.clientX, event.clientY)) return;
            event.preventDefault();
            const unit =
                event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? outline.clientHeight : 1;
            outline.scrollTop += event.deltaY * unit;
        };
        const stop = () => {
            cancelAnimationFrame(frame);
            pointer = null;
        };
        document.addEventListener('dragover', move, true);
        document.addEventListener('dragleave', leave, true);
        document.addEventListener('wheel', wheel, { capture: true, passive: false });
        document.addEventListener('drop', stop, true);
        document.addEventListener('dragend', stop, true);
        window.addEventListener('blur', stop);
        frame = requestAnimationFrame(scroll);
        return () => {
            stop();
            document.removeEventListener('dragover', move, true);
            document.removeEventListener('dragleave', leave, true);
            document.removeEventListener('wheel', wheel, true);
            document.removeEventListener('drop', stop, true);
            document.removeEventListener('dragend', stop, true);
            window.removeEventListener('blur', stop);
        };
    }, [active, tree]);
}
