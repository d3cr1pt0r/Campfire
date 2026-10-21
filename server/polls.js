import { randomUUID } from 'node:crypto';
import { check, route } from './policies.js';
import { transaction } from './database.js';
import { forViewer } from './poll-view.js';

// Poll lengths offered when creating one: 1 hour, 4 hours, 1 day, 3 days and 1 week.
export const pollHours = [1, 4, 24, 72, 168];

export function registerPolls({
    app,
    db,
    get,
    all,
    run,
    hasRoom,
    canInRoom,
    messageView,
    emitRoom,
}) {
    const timers = new Map();
    const announce = (id) => {
        const message = get('SELECT * FROM messages WHERE id=?', id);
        if (message) emitRoom(message.room, 'message:update', messageView(message));
    };
    // When voting closes, everyone in the conversation receives the final results.
    const schedule = (id, ends) => {
        clearTimeout(timers.get(id));
        const timer = setTimeout(
            () => {
                timers.delete(id);
                announce(id);
            },
            Math.max(0, ends - Date.now()) + 50,
        );
        timer.unref();
        timers.set(id, timer);
    };
    for (const poll of all('SELECT message,ends FROM polls WHERE ends>?', Date.now()))
        schedule(poll.message, poll.ends);

    const text = (value, max, message) => {
        check(typeof value === 'string', message);
        const trimmed = value.trim();
        check(
            trimmed.length > 0 && trimmed.length <= max && !/[\u0000-\u001f\u007f]/.test(trimmed),
            message,
        );
        return trimmed;
    };
    const validate = (input) => {
        check(input && typeof input === 'object' && !Array.isArray(input), 'Invalid poll');
        const question = text(input.question, 300, 'Poll questions need 1–300 characters');
        check(
            Array.isArray(input.answers) && input.answers.length >= 2 && input.answers.length <= 10,
            'Polls need 2–10 answers',
        );
        const answers = input.answers.map((answer) =>
            text(answer, 80, 'Answers need 1–80 characters without line breaks'),
        );
        check(
            new Set(answers.map((answer) => answer.toLowerCase())).size === answers.length,
            'Each answer must be different',
        );
        for (const flag of [input.multiple, input.anonymous])
            check(flag === undefined || typeof flag === 'boolean', 'Invalid poll');
        check(
            pollHours.includes(input.hours),
            'Choose a poll length of 1 hour, 4 hours, 1 day, 3 days or 1 week',
        );
        return {
            question,
            answers,
            multiple: Boolean(input.multiple),
            anonymous: Boolean(input.anonymous),
            ends: Date.now() + input.hours * 3600000,
        };
    };
    // Runs inside the message's own transaction.
    const insert = (message, poll) => {
        run(
            'INSERT INTO polls(message,multiple,anonymous,ends) VALUES(?,?,?,?)',
            message,
            Number(poll.multiple),
            Number(poll.anonymous),
            poll.ends,
        );
        poll.answers.forEach((answer, position) =>
            run(
                'INSERT INTO poll_answers(id,poll,position,text) VALUES(?,?,?,?)',
                randomUUID(),
                message,
                position,
                answer,
            ),
        );
    };
    const pollMessage = (req) => {
        const message = get('SELECT * FROM messages WHERE id=?', req.params.id);
        check(message && hasRoom(req.user, message.room), 'Message not found', 404);
        const poll = get('SELECT * FROM polls WHERE message=?', message.id);
        check(poll, 'This message is not a poll', 404);
        return { message, poll };
    };

    // Replaces the member's whole selection; an empty list removes their vote.
    app.post(
        '/api/messages/:id/vote',
        route((req, res) => {
            const { message, poll } = pollMessage(req);
            check(
                canInRoom(req.user, message.room, 'reactions.add'),
                'Permission denied in this conversation',
                403,
            );
            check(poll.ends > Date.now(), 'This poll has ended', 409);
            const chosen = req.body.answers;
            check(
                Array.isArray(chosen) &&
                    chosen.every((answer) => typeof answer === 'string') &&
                    new Set(chosen).size === chosen.length,
                'Invalid vote',
            );
            check(poll.multiple || chosen.length <= 1, 'This poll allows one answer');
            const answers = new Set(
                all('SELECT id FROM poll_answers WHERE poll=?', message.id).map((a) => a.id),
            );
            check(
                chosen.every((answer) => answers.has(answer)),
                'That answer is not part of this poll',
            );
            transaction(db, () => {
                run(
                    'DELETE FROM poll_votes WHERE user=? AND answer IN (SELECT id FROM poll_answers WHERE poll=?)',
                    req.user.id,
                    message.id,
                );
                for (const answer of chosen)
                    run('INSERT INTO poll_votes(answer,user) VALUES(?,?)', answer, req.user.id);
            });
            const view = messageView(message);
            emitRoom(message.room, 'message:update', view);
            res.json(forViewer(view, req.user.id));
        }),
    );
    app.post(
        '/api/messages/:id/poll/end',
        route((req, res) => {
            const { message, poll } = pollMessage(req);
            if (message.author !== req.user.id) {
                check(
                    !message.room.startsWith('dm:'),
                    'Only the author can end a poll in a direct message',
                    403,
                );
                check(
                    canInRoom(req.user, message.room, 'messages.deleteOthers'),
                    'Permission denied in this conversation',
                    403,
                );
            }
            if (poll.ends > Date.now()) {
                run('UPDATE polls SET ends=? WHERE message=?', Date.now(), message.id);
                clearTimeout(timers.get(message.id));
                timers.delete(message.id);
                announce(message.id);
            }
            res.json({ ok: true });
        }),
    );
    return {
        validate,
        insert,
        schedule,
        close() {
            timers.forEach(clearTimeout);
            timers.clear();
        },
    };
}
