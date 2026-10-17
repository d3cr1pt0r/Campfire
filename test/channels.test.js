import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { createApp } from '../server/app.js';
import { migrate } from '../server/database.js';
import { request } from '../test-support/http.js';

async function fixture(t) {
    const directory = mkdtempSync(path.join(tmpdir(), 'driskord-channels-'));
    let service = createApp({ dataDir: directory });
    t.after(async () => {
        await service.close();
        rmSync(directory, { recursive: true, force: true });
    });
    const signup = async (username) => {
        const response = await request(service.app, '/auth/register', null, 'POST', {
            username,
            password: 'test-password-123',
        });
        assert.equal(response.status, 200);
        return response.data;
    };
    const owner = await signup('Owner'),
        member = await signup('Member');
    const api = async (account, endpoint, method = 'GET', body, status = 200) => {
        const response = await request(service.app, endpoint, account.token, method, body);
        assert.equal(response.status, status, JSON.stringify(response.data));
        return response.data;
    };
    const access = (channel, mode, role = 'member') =>
        api(owner, `/channels/${channel}/access`, 'PUT', { permissions: [{ role, mode }] });
    return {
        owner,
        member,
        api,
        access,
        get service() {
            return service;
        },
        async restart() {
            await service.close();
            service = createApp({ dataDir: directory });
        },
    };
}

test('protected channels can be renamed; additional channel deletion cascades and survives restart', async (t) => {
    const f = await fixture(t),
        { owner, member, api } = f;
    let state = await api(owner, '/state');
    assert.deepEqual(
        state.channels
            .filter((c) => c.protected)
            .map((c) => c.kind)
            .sort(),
        ['text', 'voice'],
    );
    await api(owner, '/channels/general', 'PATCH', { name: 'New General' });
    await api(owner, '/channels/lounge', 'PATCH', { name: 'The Voice Room' });
    await api(owner, '/channels/general', 'DELETE', undefined, 409);
    await api(owner, '/channels/lounge', 'DELETE', undefined, 409);
    assert.throws(
        () => f.service.db.prepare('DELETE FROM channels WHERE id=?').run('general'),
        /protected/,
    );
    assert.throws(
        () => f.service.db.prepare("UPDATE channels SET protected=0 WHERE id='lounge'").run(),
        /cannot change/,
    );
    assert.throws(
        () => f.service.db.prepare("UPDATE channels SET kind=NULL WHERE id='general'").run(),
        /cannot change/,
    );
    const text = await api(owner, '/channels', 'POST', { name: 'Temporary', kind: 'text' });
    const voice = await api(owner, '/channels', 'POST', { name: 'Temporary Voice', kind: 'voice' });
    const msg = await api(member, '/messages', 'POST', {
        room: text.id,
        body: 'temporary',
        attachment: { name: 'file', data: 'aGVsbG8=' },
    });
    await api(member, `/messages/${msg.id}/reaction`, 'POST', { emoji: '👍' });
    await api(member, `/channels/${voice.id}`, 'DELETE', undefined, 403);
    await api(owner, `/channels/${text.id}`, 'DELETE');
    await api(owner, `/channels/${voice.id}`, 'DELETE');
    await api(owner, '/channels/introductions', 'DELETE');
    assert.equal(f.service.db.prepare('SELECT COUNT(*) n FROM attachments').get().n, 0);
    assert.equal(f.service.db.prepare('SELECT COUNT(*) n FROM reactions').get().n, 0);
    assert.equal(f.service.db.prepare('SELECT bytes FROM storage_usage').get().bytes, 0);
    await f.restart();
    state = await api(owner, '/state');
    assert.equal(state.channels.length, 2);
    assert.equal(state.channels.find((c) => c.id === 'general').name, 'new-general');
    assert.equal(state.channels.find((c) => c.id === 'lounge').name, 'The Voice Room');
    await api(owner, `/messages?room=${text.id}`, 'GET', undefined, 403);
    await api(member, `/attachments/${msg.attachments[0].id}`, 'GET', undefined, 404);
});

test('read-only channels enforce every message mutation even for a manager; hidden denies history and files', async (t) => {
    const f = await fixture(t);
    const { owner, member, api, access } = f;
    const managerRole = await api(owner, '/roles', 'POST', {
        name: 'Managers',
        color: '#abcdef',
        permissions: ['send', 'voice', 'manage'],
    });
    await api(owner, `/users/${member.user.id}/role`, 'PATCH', { role: managerRole.id });
    const msg = await api(member, '/messages', 'POST', {
        room: 'general',
        body: 'Original',
        attachment: { name: 'file', data: 'aGVsbG8=' },
    });
    await access('general', 'read-only', managerRole.id);
    assert.equal(
        (await api(member, '/state')).channels.find((c) => c.id === 'general').access,
        'read-only',
    );
    assert.equal((await api(member, '/messages?room=general'))[0].id, msg.id);
    assert.equal((await api(member, `/attachments/${msg.attachments[0].id}`)).toString(), 'hello');
    for (const [endpoint, method, body] of [
        ['/messages', 'POST', { room: 'general', body: 'blocked' }],
        [`/messages/${msg.id}/reaction`, 'POST', { emoji: '👍' }],
        [`/messages/${msg.id}`, 'PATCH', { body: 'blocked' }],
        [`/messages/${msg.id}`, 'PATCH', { pinned: true }],
        [`/messages/${msg.id}`, 'DELETE', undefined],
    ])
        await api(member, endpoint, method, body, 403);
    await api(owner, `/messages/${msg.id}`, 'PATCH', { pinned: true });
    await access('general', 'hidden', managerRole.id);
    const hidden = await api(member, '/state');
    assert.equal(
        hidden.channels.some((c) => c.id === 'general'),
        false,
    );
    assert.equal(
        hidden.channelPermissions.some((c) => c.channel === 'general'),
        false,
    );
    await api(member, '/messages?room=general', 'GET', undefined, 403);
    await api(member, `/attachments/${msg.attachments[0].id}`, 'GET', undefined, 404);
    await api(member, '/channels/general', 'PATCH', { name: 'discovered' }, 404);
    const dm = `dm:${[owner.user.id, member.user.id].sort().join(':')}`;
    await api(member, '/messages', 'POST', { room: dm, body: 'DM unaffected' });
    await access('general', 'full', managerRole.id);
    await api(member, `/messages/${msg.id}`, 'PATCH', { body: 'Restored' });
    await access('general', 'read-only', managerRole.id);
    await f.restart();
    assert.equal(
        (await api(member, '/state')).channels.find((channel) => channel.id === 'general').access,
        'read-only',
    );
    await api(member, `/messages/${msg.id}`, 'PATCH', { body: 'Still denied after restart' }, 403);
});

test('channel permissions validate roles/modes atomically and do not override global permissions', async (t) => {
    const { owner, member, api, access } = await fixture(t);
    await access('lounge', 'hidden');
    assert.equal(
        (await api(member, '/state')).channels.some((c) => c.id === 'lounge'),
        false,
    );
    await api(
        owner,
        '/channels/lounge/access',
        'PUT',
        { permissions: [{ role: 'member', mode: 'read-only' }] },
        400,
    );
    await api(
        owner,
        '/channels/lounge/access',
        'PUT',
        { permissions: [{ role: 'owner', mode: 'hidden' }] },
        400,
    );
    await api(
        owner,
        '/channels/lounge/access',
        'PUT',
        { permissions: [{ role: 'missing', mode: 'full' }] },
        400,
    );
    await api(
        owner,
        '/channels/lounge/access',
        'PUT',
        {
            permissions: [
                { role: 'member', mode: 'full' },
                { role: 'member', mode: 'hidden' },
            ],
        },
        400,
    );
    assert.equal(
        (await api(member, '/state')).channels.some((c) => c.id === 'lounge'),
        false,
    );
    await api(member, '/channels/general/access', 'PUT', { permissions: [] }, 403);
    const role = await api(owner, '/roles', 'POST', {
        name: 'No writing',
        color: '#abcdef',
        permissions: [],
    });
    await api(owner, `/users/${member.user.id}/role`, 'PATCH', { role: role.id });
    const state = await api(member, '/state');
    assert.equal(
        state.channels.some((c) => c.kind === 'voice'),
        false,
    );
    assert.equal(state.channels.find((c) => c.id === 'general').access, 'read-only');
    await api(member, '/messages', 'POST', { room: 'general', body: 'denied' }, 403);
});

test('legacy custom channel names are retained and one channel of each type becomes permanent', () => {
    const db = new DatabaseSync(':memory:');
    try {
        db.exec(readFileSync(new URL('../server/schema.sql', import.meta.url), 'utf8'));
        db.exec(
            "INSERT INTO channels VALUES('custom-text','Our Chat','text'),('custom-voice','Our Voice','voice')",
        );
        migrate(db);
        migrate(db);
        const channels = db.prepare('SELECT * FROM channels').all();
        assert.equal(channels.length, 2);
        assert.equal(
            channels.every((c) => c.protected === 1),
            true,
        );
        assert.deepEqual(
            channels.map((c) => c.name),
            ['Our Chat', 'Our Voice'],
        );
    } finally {
        db.close();
    }
});
