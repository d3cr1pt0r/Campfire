import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../server/app.js';
import { request } from '../test-support/http.js';
import { permissionIds } from '../shared/permissions.js';
import { captureSetup, populateSetup, resetSetup } from '../scripts/server-setup.mjs';

const token = 'a'.repeat(64);
const password = 'test-password-123';

async function fixture(t) {
    const root = mkdtempSync(path.join(tmpdir(), 'campfire-setup-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const data = path.join(root, 'data');
    const snapshot = path.join(root, 'private', 'setup.json');
    const service = createApp({ dataDir: data, setupCode: 'owner-code', linkPreviews: false });
    const api = async (endpoint, auth, method = 'GET', body) => {
        const result = await request(service.app, endpoint, auth, method, body);
        assert.equal(result.status, 200, JSON.stringify(result.data));
        return result.data;
    };
    try {
        const owner = await api('/auth/register', null, 'POST', {
            username: 'Alice',
            password,
            setupCode: 'owner-code',
        });
        await api('/registration', owner.token, 'PATCH', { mode: 'open' });
        const member = await api('/auth/register', null, 'POST', { username: 'Bob', password });
        const banned = await api('/auth/register', null, 'POST', { username: 'Eve', password });
        const role = await api('/roles', owner.token, 'POST', {
            name: 'Moderator',
            color: '#112233',
            permissions: ['messages.send', 'roles.assign'],
        });
        await api(`/users/${member.user.id}/roles`, owner.token, 'PATCH', { roles: [role.id] });
        await api(`/users/${owner.user.id}/roles`, owner.token, 'PATCH', { roles: [role.id] });
        await api('/profile', member.token, 'PATCH', { nickname: 'Bob display', frame: 'ember' });
        await api('/presence', member.token, 'PATCH', { status: 'dnd' });
        await api(`/users/${banned.user.id}/access`, owner.token, 'POST', { enabled: false });
        await api('/settings', owner.token, 'PATCH', {
            name: 'Saved community',
            profileFrames: false,
            reactionAuthors: false,
        });
        await api('/messages', owner.token, 'POST', {
            room: 'general',
            body: 'discard this message',
        });
        // The supplied real database has retired permissions in the legacy Owner row.
        service.db
            .prepare("UPDATE roles SET permissions=? WHERE id='owner'")
            .run(JSON.stringify([...permissionIds, 'messages.editOwn', 'messages.deleteOwn']));
        const baseline = captureSetup(data, snapshot);
        return { root, data, snapshot, baseline, owner, member, banned };
    } finally {
        await service.close();
    }
}

test('reset uses real HTTP APIs, regenerates IDs, retains account setup and backs up old data', async (t) => {
    const f = await fixture(t);
    const identityFile = path.join(f.data, 'identity-fixture');
    writeFileSync(identityFile, 'keep the identity files');
    assert.throws(() => captureSetup(f.data, f.snapshot), /EEXIST/);
    const result = await resetSetup(f.data, f.snapshot);
    assert.ok(existsSync(result.backup));
    assert.equal(readFileSync(identityFile, 'utf8'), 'keep the identity files');
    const old = new DatabaseSync(result.backup, { readOnly: true });
    assert.equal(old.prepare('SELECT COUNT(*) n FROM messages').get().n, 1);
    old.close();
    const service = createApp({ dataDir: f.data, linkPreviews: false });
    try {
        const counts = (table) => service.db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n;
        for (const table of [
            'messages',
            'attachments',
            'sessions',
            'password_resets',
            'invitations',
            'channel_overrides',
            'avatars',
        ])
            assert.equal(counts(table), 0, table);
        assert.equal(counts('users'), 3);
        assert.equal(counts('roles'), 3);
        assert.equal(service.setupCode, null);
        const login = await request(service.app, '/auth/login', null, 'POST', {
            username: 'Bob',
            password,
        });
        assert.equal(login.status, 200);
        assert.notEqual(login.data.user.id, f.member.user.id);
        assert.equal(login.data.user.nickname, 'Bob display');
        assert.equal(login.data.user.status, 'dnd');
        assert.equal(login.data.user.frame, null); // Saved frame is hidden while frames are off.
        const state = await request(service.app, '/state', login.data.token);
        assert.equal(state.status, 200);
        assert.equal(state.data.name, 'Saved community');
        assert.equal(state.data.reactionAuthors, false);
        assert.equal(
            state.data.roles.find((role) => role.id === login.data.user.roles[0]).name,
            'Moderator',
        );
        const owner = await request(service.app, '/auth/login', null, 'POST', {
            username: 'Alice',
            password,
        });
        assert.equal(owner.status, 200);
        assert.equal(owner.data.user.owner, true);
        const banned = await request(service.app, '/auth/login', null, 'POST', {
            username: 'Eve',
            password,
        });
        assert.equal(banned.status, 401);
        const exported = captureSetup(f.data, path.join(f.root, 'roundtrip.json'));
        const semantics = (s) => ({
            server: s.server,
            roles: s.roles.map(({ key, ...role }) => ({
                ...role,
                permissions: key === 'owner' ? permissionIds : role.permissions,
            })),
            users: s.users.map((user) => ({
                ...user,
                roles: user.roles.map((key) => s.roles.find((role) => role.key === key).name),
            })),
        });
        assert.deepEqual(semantics(exported), semantics(f.baseline));
    } finally {
        await service.close();
    }
    // A saved baseline can be restored repeatedly without recapturing.
    assert.ok((await resetSetup(f.data, f.snapshot)).backup);
});

test('a rejected API request leaves the original database and snapshot unchanged', async (t) => {
    const f = await fixture(t);
    const before = readFileSync(path.join(f.data, 'campfire.sqlite'));
    f.baseline.users[1].passwordHash = 'invalid hash';
    writeFileSync(f.snapshot, JSON.stringify(f.baseline));
    await assert.rejects(resetSetup(f.data, f.snapshot), /Unsupported password hash/);
    assert.deepEqual(readFileSync(path.join(f.data, 'campfire.sqlite')), before);
    assert.equal(
        readdirSync(f.data).some((name) => name.startsWith('.setup-reset-')),
        false,
    );
    f.baseline.roles[0].permissions.push('removed.permission');
    writeFileSync(f.snapshot, JSON.stringify(f.baseline));
    await assert.rejects(resetSetup(f.data, f.snapshot), /Invalid role/);
    assert.deepEqual(readFileSync(path.join(f.data, 'campfire.sqlite')), before);
});

test('restore endpoints require explicit fresh-server mode and a private loopback token', async (t) => {
    const root = mkdtempSync(path.join(tmpdir(), 'campfire-restore-auth-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const normal = createApp({ dataDir: path.join(root, 'normal'), linkPreviews: false });
    try {
        assert.equal((await request(normal.app, '/setup/users', token, 'POST', {})).status, 401);
    } finally {
        await normal.close();
    }
    const service = createApp({
        dataDir: path.join(root, 'restore'),
        setupRestoreToken: token,
        linkPreviews: false,
    });
    try {
        assert.equal(
            (await request(service.app, '/setup/users', 'b'.repeat(64), 'POST', {})).status,
            403,
        );
        assert.equal(
            (await request(service.app, '/setup/users', 'é'.repeat(64), 'POST', {})).status,
            403,
        );
        assert.equal((await request(service.app, '/auth/register', token, 'POST', {})).status, 403);
        assert.equal(
            (
                await request(service.app, '/setup/users', token, 'POST', {
                    username: 'Alice',
                    passwordHash: 'plain text',
                })
            ).status,
            400,
        );
        assert.equal(service.db.prepare('SELECT COUNT(*) n FROM users').get().n, 0);
    } finally {
        await service.close();
    }
    const f = await fixture(t);
    assert.throws(() => createApp({ dataDir: f.data, setupRestoreToken: token }), /fresh database/);
});

test('reset refuses an open original WAL connection without losing committed messages', async (t) => {
    const f = await fixture(t);
    const original = createApp({ dataDir: f.data, linkPreviews: false });
    try {
        await assert.rejects(resetSetup(f.data, f.snapshot), /locked|busy/i);
        assert.equal(original.db.prepare('SELECT COUNT(*) n FROM messages').get().n, 1);
    } finally {
        await original.close();
    }
});
