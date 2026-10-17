import { test } from 'node:test';
import assert from 'node:assert/strict';
import { themePreference, watchTheme } from '../src/theme.ts';
function environment(dark) {
    const root = { dataset: {} };
    const events = new EventTarget();
    const query = {
        matches: dark,
        addEventListener: events.addEventListener.bind(events),
        removeEventListener: events.removeEventListener.bind(events),
    };
    return {
        root,
        query,
        change(value) {
            query.matches = value;
            events.dispatchEvent(new Event('change'));
        },
    };
}
test('new and legacy clients follow the OS, including live changes and cleanup', () => {
    const env = environment(false);
    const stop = watchTheme(undefined, env.root, env.query);
    assert.equal(env.root.dataset.theme, 'canvas');
    env.change(true);
    assert.equal(env.root.dataset.theme, 'ember');
    env.change(false);
    assert.equal(env.root.dataset.theme, 'canvas');
    stop();
    env.change(true);
    assert.equal(env.root.dataset.theme, 'canvas');
});
test('explicit dark and light choices ignore OS changes; returning to System resumes them', () => {
    const env = environment(false);
    let stop = watchTheme('dark', env.root, env.query);
    assert.equal(env.root.dataset.theme, 'ember');
    env.change(true);
    env.change(false);
    assert.equal(env.root.dataset.theme, 'ember');
    stop();
    stop = watchTheme('light', env.root, env.query);
    env.change(true);
    assert.equal(env.root.dataset.theme, 'canvas');
    stop();
    stop = watchTheme('system', env.root, env.query);
    assert.equal(env.root.dataset.theme, 'ember');
    env.change(false);
    assert.equal(env.root.dataset.theme, 'canvas');
    stop();
});
test('unsupported or corrupt stored theme values fall back to System', () => {
    for (const value of [undefined, null, 'forest', 'canvas', '', {}, 1])
        assert.equal(themePreference(value), 'system');
    assert.equal(themePreference('dark'), 'dark');
    assert.equal(themePreference('light'), 'light');
});
