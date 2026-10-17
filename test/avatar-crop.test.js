import { test } from 'node:test';
import assert from 'node:assert/strict';
import { avatarCrop, drawAvatar } from '../src/images.ts';

test('avatar crop pans across a landscape image and zooms into a portrait', () => {
    assert.deepEqual(avatarCrop(1200, 600, { x: 0, y: 0.5, zoom: 1 }), { x: 0, y: 0, side: 600 });
    assert.deepEqual(avatarCrop(1200, 600, { x: 1, y: 0.5, zoom: 1 }), { x: 600, y: 0, side: 600 });
    assert.deepEqual(avatarCrop(600, 1200, { x: 0.5, y: 1, zoom: 2 }), {
        x: 150,
        y: 900,
        side: 300,
    });
});

test('fit whole image preserves all pixels with centered background space', () => {
    assert.deepEqual(avatarCrop(1200, 600, { x: 0.5, y: 0.5, zoom: 0.5 }), {
        x: 0,
        y: -300,
        side: 1200,
    });
    assert.deepEqual(avatarCrop(600, 1200, { x: 0.5, y: 0.5, zoom: 0.5 }), {
        x: -300,
        y: 0,
        side: 1200,
    });
});

test('crop positions and zoom are bounded; invalid geometry is rejected', () => {
    assert.deepEqual(avatarCrop(100, 100, { x: -1, y: 2, zoom: 100 }), { x: 0, y: 75, side: 25 });
    for (const width of [0, -1, Infinity, NaN])
        assert.throws(() => avatarCrop(width, 100, { x: 0.5, y: 0.5, zoom: 1 }));
    assert.throws(() => avatarCrop(100, 100, { x: NaN, y: 0.5, zoom: 1 }));
});

test('preview and saved output use the same square transform with a filled background', () => {
    const calls = [],
        context = {
            fillRect(...args) {
                calls.push(['fill', ...args]);
            },
            drawImage(...args) {
                calls.push(['draw', ...args]);
            },
        };
    const bitmap = { width: 1200, height: 600 };
    drawAvatar({ width: 512, height: 512, getContext: () => context }, bitmap, {
        x: 0.5,
        y: 0.5,
        zoom: 1,
    });
    assert.equal(context.fillStyle, '#18191f');
    assert.deepEqual(calls, [
        ['fill', 0, 0, 512, 512],
        ['draw', bitmap, -256, -0, 1024, 512],
    ]);
});
