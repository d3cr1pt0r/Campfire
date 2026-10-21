import { test } from 'node:test';
import assert from 'node:assert/strict';
import { leaders, percent, pollCommand, pollProblem, timeLeft } from '../src/polls.ts';

test('time left reads naturally and never rounds up', () => {
    const now = 1_000_000;
    const minutes = (n) => now + n * 60000;
    assert.equal(timeLeft(minutes(0.5), now), 'Less than a minute left');
    assert.equal(timeLeft(minutes(1), now), '1 minute left');
    assert.equal(timeLeft(minutes(59.9), now), '59 minutes left');
    assert.equal(timeLeft(minutes(60), now), '1 hour left');
    assert.equal(timeLeft(minutes(24 * 60 - 1), now), '23 hours left');
    assert.equal(timeLeft(minutes(47 * 60 + 59), now), '47 hours left');
    assert.equal(timeLeft(minutes(7 * 24 * 60), now), '7 days left');
});

test('percentages share out the people who voted, and leaders handle ties', () => {
    assert.equal(percent(1, 3), 33);
    assert.equal(percent(0, 0), 0);
    const poll = (counts) => ({
        multiple: true,
        anonymous: false,
        ends: 0,
        ended: true,
        total: 3,
        mine: [],
        answers: counts.map((count, i) => ({ id: String(i), text: String(i), count })),
    });
    assert.deepEqual(leaders(poll([2, 1, 0])), ['0']);
    assert.deepEqual(leaders(poll([2, 2, 0])), ['0', '1']);
    assert.deepEqual(leaders(poll([0, 0])), []);
    assert.deepEqual(leaders({ ...poll([0]), answers: [{ id: 'a', text: 'a' }] }), []);
});

test('the /poll command and dialog checks', () => {
    assert.equal(pollCommand('/poll Game night?'), 'Game night?');
    assert.equal(pollCommand('  /POLL  '), '');
    assert.equal(pollCommand('/poll\nTwo\nlines'), 'Two\nlines');
    assert.equal(pollCommand('/polls'), null);
    assert.equal(pollCommand('hello /poll'), null);
    assert.equal(pollProblem(' ', ['a', 'b']), 'Write a question.');
    assert.equal(pollProblem('Q', ['a', ' ', '']), 'Add at least two answers.');
    assert.equal(pollProblem('Q', ['Friday', ' friday']), 'Each answer must be different.');
    assert.equal(pollProblem('Q', ['Friday', 'Saturday', '']), null);
});
