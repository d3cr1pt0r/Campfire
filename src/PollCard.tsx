import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { usePeoplePopup } from './PeoplePopup';
import { leaders, percent, timeLeft } from './polls';
import type { Message, Poll, User } from './types';

// Re-renders while a poll is open, so its countdown and closing stay current.
function useNow(active: boolean) {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        if (!active) return;
        const timer = setInterval(() => setNow(Date.now()), 30000);
        return () => clearInterval(timer);
    }, [active]);
    return now;
}

export function PollCard({
    message,
    canVote,
    user,
    vote,
}: {
    message: Message & { poll: Poll };
    canVote: boolean;
    user: (id: string) => User | undefined;
    vote: (answers: string[]) => void;
}) {
    const { poll } = message;
    const now = useNow(!poll.ended);
    const ended = poll.ended || poll.ends <= now;
    // The server only sends counts once this member has voted or voting has closed.
    const revealed = poll.answers.some((answer) => answer.count !== undefined);
    const winners = ended && revealed ? leaders(poll) : [];
    const open = !ended && canVote;
    const choose = (id: string) => {
        if (!open) return;
        if (poll.multiple)
            vote(
                poll.mine.includes(id)
                    ? poll.mine.filter((answer) => answer !== id)
                    : [...poll.mine, id],
            );
        else if (!poll.mine.includes(id)) vote([id]);
    };
    const heading = `poll-${message.id}`;
    return (
        <div className={`poll ${ended ? 'ended' : ''}`} role="group" aria-labelledby={heading}>
            <p className="poll-question" id={heading}>
                {message.body}
            </p>
            <div className="poll-answers">
                {poll.answers.map((answer) => (
                    <PollAnswer
                        key={answer.id}
                        answer={answer}
                        total={poll.total}
                        mine={poll.mine.includes(answer.id)}
                        winner={winners.includes(answer.id)}
                        revealed={revealed}
                        open={open}
                        multiple={poll.multiple}
                        user={user}
                        onChoose={() => choose(answer.id)}
                    />
                ))}
            </div>
            {!revealed && !ended && (
                <p className="poll-hint">
                    {canVote
                        ? 'Results appear after you vote.'
                        : 'You can’t vote in this conversation. Results appear when the poll ends.'}
                </p>
            )}
            <p className="poll-footer">
                <span>
                    {poll.total} {poll.total === 1 ? 'vote' : 'votes'}
                </span>
                <span>
                    {ended
                        ? winners.length > 1
                            ? 'Final results · Tie'
                            : 'Final results'
                        : poll.multiple
                          ? 'Choose any'
                          : 'Choose one'}
                </span>
                {!ended && <span>{timeLeft(poll.ends, now)}</span>}
                {poll.anonymous && <span>Anonymous</span>}
                {open && poll.mine.length > 0 && (
                    <button type="button" className="poll-remove" onClick={() => vote([])}>
                        Remove vote
                    </button>
                )}
            </p>
        </div>
    );
}

function PollAnswer({
    answer,
    total,
    mine,
    winner,
    revealed,
    open,
    multiple,
    user,
    onChoose,
}: {
    answer: Poll['answers'][number];
    total: number;
    mine: boolean;
    winner: boolean;
    revealed: boolean;
    open: boolean;
    multiple: boolean;
    user: (id: string) => User | undefined;
    onChoose: () => void;
}) {
    // Public polls name the voters on hover or focus, like reactions do.
    const voters = answer.voters ?? [];
    const { triggerProps, render } = usePeoplePopup(voters.length > 0, voters.length);
    const count = answer.count ?? 0;
    const share = percent(count, total);
    return (
        <>
            <button
                {...triggerProps}
                type="button"
                className={`poll-answer ${mine ? 'mine' : ''} ${winner ? 'winner' : ''}`}
                aria-pressed={mine}
                aria-disabled={!open}
                onClick={onChoose}
            >
                {revealed && (
                    <span className="poll-bar" style={{ width: `${share}%` }} aria-hidden="true" />
                )}
                <span className={`poll-mark ${multiple ? 'square' : ''}`} aria-hidden="true">
                    {mine && <Check size={12} strokeWidth={3} />}
                </span>
                <span className="poll-text">{answer.text}</span>
                {revealed && (
                    <span className="poll-count">
                        {count} · {share}%
                    </span>
                )}
            </button>
            {render(
                <strong>
                    {answer.text} · {count} {count === 1 ? 'vote' : 'votes'}
                </strong>,
                voters.map((id) => ({ id, user: user(id) })),
            )}
        </>
    );
}
