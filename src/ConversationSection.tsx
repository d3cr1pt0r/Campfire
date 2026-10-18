import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

export function ConversationSection({
    activeCall,
    header,
    children,
}: {
    activeCall: boolean;
    header: ReactNode;
    children: ReactNode;
}) {
    const section = useRef<HTMLElement>(null);
    const [size, setSize] = useState({ height: Infinity, minimum: 76 });
    useLayoutEffect(() => {
        const element = section.current;
        if (!element) return;
        const serverHeading = element.closest('.app-shell')?.querySelector('.server-heading');
        const update = () => {
            const height = element.getBoundingClientRect().height;
            const minimum = serverHeading?.getBoundingClientRect().height || 76;
            setSize((previous) =>
                previous.height === height && previous.minimum === minimum
                    ? previous
                    : { height, minimum },
            );
        };
        update();
        const observer = new ResizeObserver(update);
        observer.observe(element);
        if (serverHeading) observer.observe(serverHeading);
        return () => observer.disconnect();
    }, []);
    const room = size.height - size.minimum;
    const actionsOpacity = activeCall ? Math.max(0, Math.min(1, (room - 24) / 96)) : 1;
    const contentOpacity = activeCall ? Math.max(0, Math.min(1, (room - 100) / 100)) : 1;
    return (
        <section
            id="conversation-section"
            ref={section}
            className={`conversation-section ${actionsOpacity === 0 ? 'compact' : ''}`}
            aria-label="Conversation"
            style={
                {
                    '--conversation-minimum': `${size.minimum}px`,
                    '--conversation-actions-opacity': actionsOpacity,
                } as CSSProperties
            }
        >
            {header}
            <div
                className="conversation-content"
                inert={contentOpacity === 0}
                aria-hidden={contentOpacity === 0}
                style={{
                    opacity: contentOpacity,
                    visibility: contentOpacity === 0 ? 'hidden' : 'visible',
                }}
            >
                {children}
            </div>
        </section>
    );
}
