import { useRef, useState } from 'react';
import { X } from 'lucide-react';
import { maxAnswers, pollLengths, pollProblem } from './polls';

// Where a poll will be posted: a conversation, or a thread inside one.
export type PollTarget = { room: string; thread?: string; question: string };
export type NewPoll = {
    question: string;
    answers: string[];
    multiple: boolean;
    anonymous: boolean;
    hours: number;
};

export function PollDialog({
    initialQuestion,
    busy,
    onSubmit,
    onCancel,
}: {
    initialQuestion: string;
    busy: boolean;
    onSubmit: (poll: NewPoll) => void;
    onCancel: () => void;
}) {
    const [question, setQuestion] = useState(initialQuestion);
    const [answers, setAnswers] = useState(['', '']);
    const [hours, setHours] = useState(24);
    const [multiple, setMultiple] = useState(false);
    const [anonymous, setAnonymous] = useState(false);
    const [attempted, setAttempted] = useState(false);
    const fields = useRef<(HTMLInputElement | null)[]>([]);
    // A blank row for the next answer appears once every row has text.
    const rows =
        answers.length < maxAnswers && answers.every((answer) => answer.trim())
            ? [...answers, '']
            : answers;
    const normalized = answers.map((answer) => answer.trim().toLowerCase());
    const duplicate = (index: number) =>
        !!normalized[index] && normalized.indexOf(normalized[index]) !== index;
    const problem = pollProblem(question, answers);
    // Duplicates show while typing; missing text only after trying to post.
    const shown = attempted || problem === 'Each answer must be different.' ? problem : null;
    const focus = (index: number) =>
        requestAnimationFrame(() => fields.current[index]?.focus({ preventScroll: false }));
    const update = (index: number, value: string) =>
        setAnswers((current) =>
            index < current.length
                ? current.map((answer, i) => (i === index ? value : answer))
                : [...current, value],
        );
    const remove = (index: number) => {
        setAnswers((current) => current.filter((_, i) => i !== index));
        focus(Math.max(0, index - 1));
    };
    const submit = (event: React.SyntheticEvent) => {
        event.preventDefault();
        setAttempted(true);
        if (problem || busy) return;
        onSubmit({
            question: question.trim(),
            answers: answers.map((answer) => answer.trim()).filter(Boolean),
            multiple,
            anonymous,
            hours,
        });
    };
    return (
        <form className="poll-dialog" onSubmit={submit} noValidate>
            <h2 id="action-dialog-title">Create a poll</h2>
            <label>
                Question
                <input
                    autoFocus={!initialQuestion}
                    value={question}
                    maxLength={300}
                    placeholder="What should we decide?"
                    aria-invalid={attempted && !question.trim()}
                    onChange={(event) => setQuestion(event.target.value)}
                    onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                            event.preventDefault();
                            focus(0);
                        }
                    }}
                />
            </label>
            <fieldset className="poll-dialog-answers">
                <legend>Answers</legend>
                {rows.map((value, index) => (
                    <div className="poll-dialog-answer" key={index}>
                        <input
                            ref={(element) => {
                                fields.current[index] = element;
                            }}
                            autoFocus={!!initialQuestion && index === 0}
                            value={value}
                            maxLength={80}
                            placeholder={index < 2 ? `Answer ${index + 1}` : 'Add an answer'}
                            aria-label={`Answer ${index + 1}`}
                            aria-invalid={duplicate(index)}
                            onChange={(event) => update(index, event.target.value)}
                            onKeyDown={(event) => {
                                if (event.key === 'Enter') {
                                    event.preventDefault();
                                    if (index + 1 < rows.length) focus(index + 1);
                                    else submit(event);
                                }
                                if (
                                    event.key === 'Backspace' &&
                                    !value &&
                                    index >= 2 &&
                                    index < answers.length
                                ) {
                                    event.preventDefault();
                                    remove(index);
                                }
                            }}
                        />
                        {rows.length > 2 && index < answers.length && (
                            <button
                                type="button"
                                aria-label={`Remove answer ${index + 1}`}
                                title="Remove answer"
                                onClick={() => remove(index)}
                            >
                                <X size={16} />
                            </button>
                        )}
                    </div>
                ))}
                <p className="field-help">Up to {maxAnswers} answers.</p>
            </fieldset>
            <div className="poll-dialog-options">
                <label>
                    Ends after
                    <select
                        value={hours}
                        onChange={(event) => setHours(Number(event.target.value))}
                    >
                        {pollLengths.map(([value, label]) => (
                            <option key={value} value={value}>
                                {label}
                            </option>
                        ))}
                    </select>
                </label>
                <label className="checkbox-label">
                    <input
                        type="checkbox"
                        checked={multiple}
                        onChange={(event) => setMultiple(event.target.checked)}
                    />
                    Allow multiple answers
                </label>
            </div>
            <fieldset className="poll-dialog-modes">
                <legend>Who can see votes</legend>
                {(
                    [
                        [false, 'Public', 'Everyone can see who voted for what.'],
                        [true, 'Anonymous', 'Nobody can see who voted for what, including you.'],
                    ] as const
                ).map(([value, title, description]) => (
                    <label className="poll-dialog-mode" key={title}>
                        <input
                            type="radio"
                            name="poll-visibility"
                            checked={anonymous === value}
                            onChange={() => setAnonymous(value)}
                        />
                        <span>
                            <strong>{title}</strong>
                            <small>{description}</small>
                        </span>
                    </label>
                ))}
            </fieldset>
            {shown && (
                <p className="poll-dialog-error" role="alert">
                    {shown}
                </p>
            )}
            <div className="dialog-actions">
                <button type="button" className="secondary" disabled={busy} onClick={onCancel}>
                    Cancel
                </button>
                <button className="primary" disabled={busy}>
                    {busy ? 'Posting…' : 'Post poll'}
                </button>
            </div>
        </form>
    );
}
