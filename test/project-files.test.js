import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';

test('renderer modules have unambiguous names on case-insensitive filesystems', () => {
    const modules = new Map();
    for (const file of readdirSync(new URL('../src/', import.meta.url), { recursive: true })) {
        if (!/\.(?:[cm]?[jt]sx?)$/.test(file) || /\.d\.[cm]?ts$/.test(file)) continue;
        // Extensionless imports try .ts before .tsx, so differing extensions
        // don't disambiguate InviteMembers.tsx from inviteMembers.ts on Windows.
        const name = file.replace(/\.[^.]+$/, '').toLowerCase();
        assert.ok(!modules.has(name), `Ambiguous module names: ${modules.get(name)} and ${file}`);
        modules.set(name, file);
    }
});
