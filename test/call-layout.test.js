import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitCallParticipants } from '../src/callLayout.ts';

test('participant grids fill the available stage for one to eight people', () => {
    for (const width of [300, 600, 1100]) {
        for (const height of [60, 160, 350, 800]) {
            for (let count = 1; count <= 8; count++) {
                const grid = fitCallParticipants(width, height, count);
                assert.equal(grid.width, width);
                assert.equal(grid.height, height);
                assert.ok(grid.columns >= 1 && grid.columns <= count);
                assert.equal(grid.rows, Math.ceil(count / grid.columns));
                assert.ok((width - (grid.columns - 1) * 12) / grid.columns > 0);
                assert.ok((height - (grid.rows - 1) * 12) / grid.rows > 0);
            }
        }
    }
});

test('grids adapt to wide, balanced, and tall stages', () => {
    assert.deepEqual(fitCallParticipants(1200, 240, 4), {
        columns: 4,
        rows: 1,
        width: 1200,
        height: 240,
    });
    assert.deepEqual(fitCallParticipants(1200, 800, 4), {
        columns: 2,
        rows: 2,
        width: 1200,
        height: 800,
    });
    assert.deepEqual(fitCallParticipants(400, 1000, 4), {
        columns: 1,
        rows: 4,
        width: 400,
        height: 1000,
    });
});

test('a single participant fills the stage beyond the previous authored size', () => {
    assert.deepEqual(fitCallParticipants(1200, 800, 1), {
        columns: 1,
        rows: 1,
        width: 1200,
        height: 800,
    });
});

test('empty and collapsed stages have no occupied grid area', () => {
    const empty = { columns: 1, rows: 0, width: 0, height: 0 };
    assert.deepEqual(fitCallParticipants(1200, 800, 0), empty);
    assert.deepEqual(fitCallParticipants(0, 0, 8), empty);
    assert.deepEqual(fitCallParticipants(300, 0, 8), empty);
});
