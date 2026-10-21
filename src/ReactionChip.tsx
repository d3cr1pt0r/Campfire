import { Emoji } from './ChatContent';
import { usePeoplePopup } from './PeoplePopup';
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
    const { triggerProps, render } = usePeoplePopup(showNames, people.length);
    return (
        <>
            <button
                {...triggerProps}
                className={mine ? 'mine' : ''}
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
