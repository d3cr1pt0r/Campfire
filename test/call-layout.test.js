import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitCallParticipants } from '../src/callLayout.ts';

test('participant grids fit one to eight people without distorting 16:9 tiles', () => {
    for (const width of [300, 600, 1100]) {
        for (const height of [60, 160, 350, 800]) {
            for (let count = 1; count <= 8; count++) {
                const grid = fitCallParticipants(width, height, count);
                assert.ok(grid.width <= width + 0.001);
                assert.ok(grid.height <= height + 0.001);
                const tileWidth = (grid.width - (grid.columns - 1) * 12) / grid.columns;
                const tileHeight = (grid.height - (grid.rows - 1) * 12) / grid.rows;
                assert.ok(Math.abs(tileWidth / tileHeight - 16 / 9) < 0.00001);
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
        height: 163.6875,
    });
    assert.deepEqual(fitCallParticipants(1200, 800, 4), {
        columns: 2,
        rows: 2,
        width: 1200,
        height: 680.25,
    });
    assert.deepEqual(fitCallParticipants(400, 1000, 4), {
        columns: 1,
        rows: 4,
        width: 400,
        height: 936,
    });
});

test('a single participant uses a wide tile centered inside the stage', () => {
    assert.deepEqual(fitCallParticipants(1200, 800, 1), {
        columns: 1,
        rows: 1,
        width: 1200,
        height: 675,
    });
});

test('empty and collapsed stages have no occupied grid area', () => {
    const empty = { columns: 1, rows: 0, width: 0, height: 0 };
    assert.deepEqual(fitCallParticipants(1200, 800, 0), empty);
    assert.deepEqual(fitCallParticipants(0, 0, 8), empty);
    assert.deepEqual(fitCallParticipants(300, 0, 8), empty);
});
