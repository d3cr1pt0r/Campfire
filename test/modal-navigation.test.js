import { test } from 'node:test';
import assert from 'node:assert/strict';
import { navigateModals } from '../src/modalNavigation.ts';

test('closing an edit or create role dialog returns to Settings, then closes Settings', () => {
    for (const role of ['role:member', 'role:new', 'role:custom']) {
        const settings = navigateModals([], 'settings');
        const editing = navigateModals(settings, role);
        assert.deepEqual(editing, ['settings', role]);
        const closed = navigateModals(editing, null);
        assert.deepEqual(closed, ['settings']);
        assert.deepEqual(navigateModals(closed, null), []);
        assert.deepEqual(settings, ['settings']);
    }
});

test('closing the server switch dialog returns to its actual opening context', () => {
    assert.deepEqual(navigateModals(['settings', 'switch'], null), ['settings']);
    assert.deepEqual(navigateModals(['switch'], null), []);
});

test('saving a role returns to the existing Settings entry without a reopen loop', () => {
    const saved = navigateModals(['settings', 'role:custom'], 'settings');
    assert.deepEqual(saved, ['settings']);
    assert.deepEqual(navigateModals(saved, null), []);
    assert.deepEqual(navigateModals(saved, 'settings'), ['settings']);
});

test('emoji upload settings return to the picker and multiple nested dialogs close one at a time', () => {
    const upload = navigateModals(['reaction:message'], 'settings');
    const edit = navigateModals(upload, 'role:new');
    assert.deepEqual(navigateModals(edit, null), ['reaction:message', 'settings']);
    assert.deepEqual(navigateModals(upload, null), ['reaction:message']);
    assert.deepEqual(navigateModals(['reaction:message'], null), []);
    assert.deepEqual(navigateModals([], null), []);
});
