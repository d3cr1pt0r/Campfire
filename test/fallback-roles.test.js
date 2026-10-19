import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { roleFixture } from '../test-support/role-fixture.js';
import { hasPermission, roleColor } from '../shared/permissions.js';
import { openDatabase, migrate } from '../server/database.js';

test('new members use Default alone; assigning roles replaces its grants, overrides and color', async (t) => {
    const f = await roleFixture(t),
        newcomer = await f.signup('Newcomer');
    assert.deepEqual(newcomer.user.roles, []);
    await f.api(f.owner, '/roles/everyone', 'PATCH', {
        name: 'Default',
        color: '#22aa88',
        permissions: ['channels.view', 'messages.send', 'emojis.upload'],
    });
    const privateChannel = await f.api(f.owner, '/channels', 'POST', {
        name: 'default-space',
        kind: 'text',
        private: true,
    });
    await f.override('everyone', [
        { channel: 'general', permission: 'reactions.add', effect: 'allow' },
        { channel: privateChannel.id, permission: 'channels.view', effect: 'allow' },
    ]);
    const root = await f.api(f.owner, '/messages', 'POST', {
        room: 'general',
        body: 'An announcement',
    });
    let state = await f.api(newcomer, '/state');
    assert.equal(state.roles.find((role) => role.id === 'everyone').name, 'Default');
    assert.equal(roleColor(state.me, state.roles), '#22aa88');
    assert.equal(
        state.channels.some((channel) => channel.id === privateChannel.id),
        true,
    );
    await f.api(newcomer, '/messages', 'POST', { room: 'general', body: 'Default can send' });
    await f.api(newcomer, `/messages/${root.id}/reaction`, 'POST', { emoji: '👍' });
    const restricted = await f.role('Restricted', ['channels.view']);
    await f.assign(newcomer, [restricted.id]);
    state = await f.api(newcomer, '/state');
    assert.equal(roleColor(state.me, state.roles), undefined);
    assert.equal(hasPermission(state.me, state.roles, 'messages.send'), false);
    assert.equal(hasPermission(state.me, state.roles, 'emojis.upload'), false);
    assert.equal(
        state.channels.some((channel) => channel.id === privateChannel.id),
        false,
    );
    await f.api(newcomer, '/messages', 'POST', { room: 'general', body: 'Blocked' }, 403);
    await f.api(newcomer, `/messages/${root.id}/reaction`, 'POST', { emoji: '👍' }, 403);
    const sender = await f.role('Sender', ['messages.send']);
    await f.assign(newcomer, [restricted.id, sender.id]);
    await f.api(newcomer, '/messages', 'POST', { room: 'general', body: 'Explicit roles combine' });
    state = await f.api(newcomer, '/state');
    assert.equal(hasPermission(state.me, state.roles, 'emojis.upload'), false);
    await f.assign(newcomer, []);
    await f.restart();
    state = await f.api(newcomer, '/state');
    assert.deepEqual(state.me.roles, []);
    assert.equal(hasPermission(state.me, state.roles, 'emojis.upload'), true);
    assert.equal(roleColor(state.me, state.roles), '#22aa88');
    assert.equal(
        state.channels.some((channel) => channel.id === privateChannel.id),
        true,
    );
    await f.api(newcomer, '/messages', 'POST', { room: 'general', body: 'Fallback restored' });
});
test('Default channel denies do not affect members with explicit roles', async (t) => {
    const f = await roleFixture(t),
        account = await f.signup('FallbackUser');
    await f.override('everyone', [
        { channel: 'general', permission: 'messages.send', effect: 'deny' },
    ]);
    await f.api(account, '/messages', 'POST', { room: 'general', body: 'Default deny' }, 403);
    const sender = await f.role('Sender', ['messages.send']);
    await f.assign(account, [sender.id]);
    await f.api(account, '/messages', 'POST', { room: 'general', body: 'Explicit sender' });
    await f.api(f.owner, `/roles/${sender.id}`, 'DELETE');
    await f.api(
        account,
        '/messages',
        'POST',
        { room: 'general', body: 'Default deny restored' },
        403,
    );
});
test('fallback migration preserves configured defaults, explicit memberships, overrides and sessions', () => {
    const db = new DatabaseSync(':memory:');
    try {
        db.exec(readFileSync(new URL('../server/schema.sql', import.meta.url), 'utf8'));
        db.exec(`INSERT INTO roles VALUES('member','Member','#abcdef','["send"]');
            INSERT INTO users(id,username,password,role) VALUES('u','User','hash','member');`);
        migrate(db, 13);
        db.prepare("UPDATE roles SET color=?,permissions=? WHERE id='everyone'").run(
            '#22aa88',
            '["channels.view","files.attach"]',
        );
        db.exec(
            "INSERT INTO channel_overrides VALUES('general','everyone','messages.send','deny'); INSERT INTO sessions VALUES('keep-session','u',9999999999999)",
        );
        migrate(db, 14);
        migrate(db, 14);
        const fallback = db.prepare("SELECT * FROM roles WHERE id='everyone'").get();
        assert.equal(fallback.name, 'Default');
        assert.equal(fallback.color, '#22aa88');
        assert.equal(fallback.permissions, '["channels.view","files.attach"]');
        assert.deepEqual(
            db
                .prepare("SELECT role FROM user_roles WHERE user='u'")
                .all()
                .map((row) => row.role),
            ['member'],
        );
        assert.equal(
            db.prepare("SELECT effect FROM channel_overrides WHERE role='everyone'").get().effect,
            'deny',
        );
        assert.equal(db.prepare('SELECT COUNT(*) n FROM sessions').get().n, 1);
        assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0);
    } finally {
        db.close();
    }
});

test('delegation cannot activate stronger Default privileges by clearing or deleting the last role', async (t) => {
    const f = await roleFixture(t),
        low = await f.role('Limited'),
        manager = await f.role('Manager', ['roles.assign', 'roles.manage']);
    await f.api(f.owner, '/roles/everyone', 'PATCH', {
        name: 'Default',
        color: null,
        permissions: ['server.edit'],
    });
    await f.assign(f.member, [low.id]);
    await f.assign(f.other, [manager.id]);
    await f.assign(f.member, [], f.other, 403);
    await f.api(f.other, `/roles/${low.id}`, 'DELETE', undefined, 403);
    assert.deepEqual((await f.api(f.member, '/state')).me.roles, [low.id]);
    await f.api(f.owner, `/roles/${low.id}`, 'DELETE');
    const state = await f.api(f.member, '/state');
    assert.deepEqual(state.me.roles, []);
    assert.equal(hasPermission(state.me, state.roles, 'server.edit'), true);
});

test('Member removal preserves other roles, Default settings and ownership across restart', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'campfire-retire-member-'));
    const db = new DatabaseSync(path.join(directory, 'campfire.sqlite'));
    let reopened;
    try {
        db.exec(readFileSync(new URL('../server/schema.sql', import.meta.url), 'utf8'));
        db.exec(`INSERT INTO roles VALUES('owner','Owner',NULL,'[]'),('member','Member','#abcdef','["send"]'),('moderator','Moderator',NULL,'["manage"]');
            INSERT INTO users(id,username,password,role) VALUES('o','Owner','hash','owner'),('a','OnlyMember','hash','member'),('b','Moderator','hash','member');
            INSERT INTO channels VALUES('general','general','text');`);
        migrate(db, 14);
        db.exec(`INSERT INTO user_roles VALUES('b','moderator');
            UPDATE roles SET color='#22aa88',permissions='["channels.view","files.attach"]' WHERE id='everyone';
            INSERT INTO channel_overrides VALUES('general','member','messages.send','deny'),('general','moderator','messages.send','allow'),('general','everyone','files.attach','deny');
            INSERT INTO sessions VALUES('keep-session','a',9999999999999);`);
        migrate(db);
        migrate(db);
        assert.equal(db.prepare("SELECT * FROM roles WHERE id='member'").get(), undefined);
        assert.equal(db.prepare("SELECT COUNT(*) n FROM user_roles WHERE user='a'").get().n, 0);
        assert.deepEqual(
            db
                .prepare("SELECT role FROM user_roles WHERE user='b'")
                .all()
                .map((r) => r.role),
            ['moderator'],
        );
        assert.equal(db.prepare("SELECT COUNT(*) n FROM users WHERE role='member'").get().n, 0);
        assert.equal(
            db.prepare("SELECT COUNT(*) n FROM channel_overrides WHERE role='member'").get().n,
            0,
        );
        assert.equal(db.prepare('SELECT COUNT(*) n FROM channel_overrides').get().n, 2);
        assert.equal(
            db.prepare("SELECT permissions FROM roles WHERE id='everyone'").get().permissions,
            '["channels.view","files.attach"]',
        );
        assert.equal(
            db.prepare("SELECT color FROM roles WHERE id='everyone'").get().color,
            '#22aa88',
        );
        assert.equal(db.prepare("SELECT owner FROM users WHERE id='o'").get().owner, 1);
        assert.equal(db.prepare('SELECT COUNT(*) n FROM sessions').get().n, 1);
        assert.throws(() => db.exec("DELETE FROM roles WHERE id='everyone'"), /cannot be deleted/);
        assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0);
        db.close();
        reopened = openDatabase(directory, 'Test');
        assert.equal(reopened.get("SELECT * FROM roles WHERE id='member'"), undefined);
        assert.equal(reopened.get("SELECT COUNT(*) n FROM user_roles WHERE user='a'").n, 0);
        assert.equal(reopened.db.prepare('PRAGMA quick_check').get().quick_check, 'ok');
    } finally {
        if (db.isOpen) db.close();
        reopened?.db.close();
        rmSync(directory, { recursive: true, force: true });
    }
});
