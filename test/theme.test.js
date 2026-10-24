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
test('clients without a saved theme use Graphite and ignore OS changes', () => {
    const env = environment(false);
    const stop = watchTheme(undefined, env.root, env.query);
    assert.equal(env.root.dataset.theme, 'graphite');
    env.change(true);
    env.change(false);
    assert.equal(env.root.dataset.theme, 'graphite');
    stop();
});
test('explicit dark and light choices ignore OS changes; System follows them live', () => {
    const env = environment(false);
    let stop = watchTheme('dark', env.root, env.query);
    assert.equal(env.root.dataset.theme, 'graphite');
    env.change(true);
    env.change(false);
    assert.equal(env.root.dataset.theme, 'graphite');
    stop();
    stop = watchTheme('light', env.root, env.query);
    env.change(true);
    assert.equal(env.root.dataset.theme, 'paper');
    stop();
    stop = watchTheme('system', env.root, env.query);
    assert.equal(env.root.dataset.theme, 'graphite');
    env.change(false);
    assert.equal(env.root.dataset.theme, 'paper');
    stop();
    env.change(true);
    assert.equal(env.root.dataset.theme, 'paper');
});
test('unsupported or corrupt stored theme values fall back to Dark', () => {
    for (const value of [undefined, null, 'forest', 'canvas', '', {}, 1])
        assert.equal(themePreference(value), 'dark');
    assert.equal(themePreference('system'), 'system');
    assert.equal(themePreference('light'), 'light');
});
