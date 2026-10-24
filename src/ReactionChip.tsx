import { Emoji } from './ChatContent';
import { usePeoplePopup } from './PeoplePopup';
import { useEffect } from 'react';
import type { State, User } from './types';

export function ReactionChip({
    emoji,
    people,
    mine,
    showNames,
    canReact,
    custom,
    onReact,
    notificationRequest,
}: {
    emoji: string;
    people: { id: string; user?: User }[];
    mine: boolean;
    showNames: boolean;
    canReact: boolean;
    custom: State['emojis'];
    onReact: () => void;
    notificationRequest?: number;
}) {
    const { triggerProps, render } = usePeoplePopup(showNames, people.length);
    useEffect(() => {
        if (
            notificationRequest === undefined ||
            matchMedia('(prefers-reduced-motion: reduce)').matches
        )
            return;
        // Restart for each notification jump without remounting the chip or losing focus.
        const animation = triggerProps.ref.current?.animate(
            [
                { transform: 'scale(1)', offset: 0 },
                { transform: 'scale(1.28)', offset: 0.3 },
                { transform: 'scale(0.94)', offset: 0.55 },
                { transform: 'scale(1.08)', offset: 0.75 },
                { transform: 'scale(1)', offset: 1 },
            ],
            { duration: 500, easing: 'ease-out' },
        );
        return () => animation?.cancel();
    }, [notificationRequest, triggerProps.ref]);
    return (
        <>
            <button
                {...triggerProps}
                className={`${mine ? 'mine' : ''} ${notificationRequest !== undefined ? 'reaction-ping' : ''}`}
                data-reaction-emoji={emoji}
                aria-label={`${emoji}: ${people.length} ${people.length === 1 ? 'reaction' : 'reactions'}`}
                aria-pressed={mine}
                aria-disabled={!canReact}
                onClick={() => {
                    if (canReact) onReact();
                }}
            >
                <Emoji value={emoji} custom={custom} />
                <span>{people.length}</span>
            </button>
            {render(
                <>
                    <Emoji value={emoji} custom={custom} />
                    <strong>
                        {people.length} {people.length === 1 ? 'reaction' : 'reactions'}
                    </strong>
                </>,
                people,
            )}
        </>
    );
}
