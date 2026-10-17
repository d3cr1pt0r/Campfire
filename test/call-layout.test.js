import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitCallParticipants } from '../src/callLayout.ts';

test('participant cards fit the available width and height for one to eight people', () => {
    for (const width of [300, 600, 1100]) {
        for (const height of [60, 160, 350]) {
            for (let count = 1; count <= 8; count++) {
                const result = fitCallParticipants(width, height, count);
                assert.ok(result.scale > 0 && result.scale <= 1);
                assert.ok(result.width <= width + 0.001);
                const columns = Math.round((result.width + 12) / (290 * result.scale + 12));
                const rows = Math.ceil(count / columns);
                assert.ok(rows * 272 * result.scale + (rows - 1) * 12 <= height + 0.001);
            }
        }
    }
});

test('shrinking the call section progressively scales the cards down', () => {
    for (let count = 1; count <= 8; count++) {
        let previous = 0;
        for (const height of [0, 20, 60, 100, 180, 300, 500]) {
            const { scale } = fitCallParticipants(900, height, count);
            assert.ok(scale >= previous);
            previous = scale;
        }
    }
});

test('a single participant stays at the authored size when there is ample space', () => {
    assert.deepEqual(fitCallParticipants(1200, 800, 1), { scale: 1, width: 290 });
    assert.equal(fitCallParticipants(0, 0, 8).scale, 0);
});
