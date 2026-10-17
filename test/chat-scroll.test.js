import { test } from 'node:test';
import assert from 'node:assert/strict';
import { needsScrollHistory, restoredScrollOffset } from '../src/chatScroll.ts';

const message = (id, created) => ({ id, created, attachments: [] });
const position = {
    offset: 291,
    atEnd: false,
    anchor: { id: 'reading', created: 20, offset: 19 },
    measurements: [
        { key: 'history-header', size: 72 },
        { key: 'older', size: 200 },
        { key: 'reading', size: 150 },
    ],
};

test('restores the same message and row offset after history changes', () => {
    assert.equal(
        restoredScrollOffset(position, [message('older', 10), message('reading', 20)]),
        291,
    );
    assert.equal(restoredScrollOffset(position, [message('reading', 20), message('new', 30)]), 91);
    assert.equal(
        restoredScrollOffset(position, [
            message('extra', 5),
            message('older', 10),
            message('reading', 20),
        ]),
        391,
    );
});

test('loads past the newest page to recover an older reading position', () => {
    assert.equal(needsScrollHistory(position, []), true);
    assert.equal(needsScrollHistory(position, [message('newer', 30)]), true);
    assert.equal(needsScrollHistory(position, [message('reading', 20)]), false);
    assert.equal(needsScrollHistory(position, [message('older', 10)]), false);
    assert.equal(needsScrollHistory({ ...position, atEnd: true }, []), false);
});

test('a deleted anchor falls forward to the next message without loading all history', () => {
    const messages = [message('older', 10), message('next', 30)];
    assert.equal(needsScrollHistory(position, messages), false);
    assert.equal(restoredScrollOffset(position, messages), 291);
});

test('messages sharing a timestamp use the same id ordering as history', () => {
    assert.equal(needsScrollHistory(position, [message('zzz', 20)]), true);
    assert.equal(needsScrollHistory(position, [message('aaa', 20)]), false);
    assert.equal(restoredScrollOffset(position, [message('aaa', 20), message('zzz', 20)]), 191);
});
