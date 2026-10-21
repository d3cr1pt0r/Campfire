// Poll data rides on message views under a symbol, which JSON never serializes. A view only
// carries its poll once shaped for one member, so an unshaped view can't leak votes.
export const pollData = Symbol('poll');

// Loads polls for a page of messages: one query when none are polls, three when some are.
export function loadPolls(all, ids) {
    const placeholders = ids.map(() => '?').join(',');
    const polls = new Map(
        all(`SELECT * FROM polls WHERE message IN (${placeholders})`, ...ids).map((poll) => [
            poll.message,
            {
                multiple: Boolean(poll.multiple),
                anonymous: Boolean(poll.anonymous),
                ends: poll.ends,
                answers: [],
            },
        ]),
    );
    if (!polls.size) return polls;
    const keys = [...polls.keys()],
        marks = keys.map(() => '?').join(',');
    const answers = new Map();
    for (const { id, poll, text } of all(
        `SELECT id,poll,text FROM poll_answers WHERE poll IN (${marks}) ORDER BY position`,
        ...keys,
    )) {
        const answer = { id, text, voters: [] };
        polls.get(poll).answers.push(answer);
        answers.set(id, answer);
    }
    for (const { answer, user } of all(
        `SELECT v.answer,v.user FROM poll_votes v JOIN poll_answers a ON a.id=v.answer WHERE a.poll IN (${marks}) ORDER BY v.rowid`,
        ...keys,
    ))
        answers.get(answer)?.voters.push(user);
    return polls;
}

export function forViewer(view, viewer) {
    if (!view?.[pollData]) return view;
    // The shaped copy leaves the raw data behind, so nothing downstream can send it.
    const { [pollData]: poll, ...message } = view;
    const mine = poll.answers.filter((answer) => answer.voters.includes(viewer)).map((a) => a.id);
    const ended = poll.ends <= Date.now();
    // Results stay hidden until this member has voted or voting has closed.
    const revealed = ended || mine.length > 0;
    return {
        ...message,
        poll: {
            multiple: poll.multiple,
            anonymous: poll.anonymous,
            ends: poll.ends,
            ended,
            total: new Set(poll.answers.flatMap((answer) => answer.voters)).size,
            mine,
            answers: poll.answers.map(({ id, text, voters }) => ({
                id,
                text,
                ...(revealed && { count: voters.length }),
                // Anonymous polls never send who voted for what, to anyone.
                ...(revealed && !poll.anonymous && { voters }),
            })),
        },
    };
}
