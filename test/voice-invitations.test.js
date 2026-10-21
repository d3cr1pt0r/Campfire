import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createApp } from '../test-support/open-server.js';
import { request } from '../test-support/http.js';

async function fixture(t) {
    const directory = mkdtempSync(path.join(tmpdir(), 'campfire-voice-invites-'));
    let service = createApp({ dataDir: directory });
    t.after(async () => {
        await service.close();
        rmSync(directory, { recursive: true, force: true });
    });
    const api = async (account, route, method = 'GET', body, status = 200) => {
        const result = await request(service.app, route, account?.token, method, body);
        assert.equal(result.status, status, JSON.stringify(result.data));
        return result.data;
    };
    const signup = (username) =>
        api(null, '/auth/register', 'POST', {
            username,
            password: 'voice-invite-password',
            setupCode: 'test-owner-setup',
        });
    const owner = await signup('Owner'),
        member = await signup('Member'),
        other = await signup('Other');
    return {
        api,
        owner,
        member,
        other,
        get service() {
            return service;
        },
        async restart() {
            await service.close();
            service = createApp({ dataDir: directory });
        },
    };
}

test('voice invitations are persisted DM messages with searchable text, normal actions and no duplicates', async (t) => {
    const f = await fixture(t),
        { api, owner, member, other } = f;
    const sent = await api(owner, '/voice-channels/lounge/invite', 'POST', {
        user: member.user.id,
    });
    const room = `dm:${[owner.user.id, member.user.id].sort().join(':')}`;
    assert.equal(sent.room, room);
    assert.equal(sent.author, owner.user.id);
    assert.deepEqual(sent.voiceInvite, { channel: 'lounge', name: 'lounge' });
    assert.match(sent.body, /lounge/);
    const repeat = await api(owner, '/voice-channels/lounge/invite', 'POST', {
        user: member.user.id,
    });
    assert.equal(repeat.id, sent.id);
    assert.equal((await api(member, `/messages?room=${encodeURIComponent(room)}`)).length, 1);
    assert.deepEqual((await api(member, `/messages/${sent.id}`)).voiceInvite, sent.voiceInvite);
    await api(other, `/messages/${sent.id}`, 'GET', undefined, 404);
    const candidates = await api(owner, '/voice-channels/lounge/invitees');
    assert.ok(candidates.users.includes(member.user.id));
    assert.ok(!candidates.users.includes(owner.user.id));
    assert.ok(candidates.sent.includes(member.user.id));
    await api(owner, `/messages/${sent.id}`, 'PATCH', { body: 'Spoof a channel' }, 400);
    await api(member, `/messages/${sent.id}/reaction`, 'POST', { emoji: '👍' });
    await api(owner, `/messages/${sent.id}`, 'PATCH', { pinned: true });
    await f.restart();
    const history = await api(member, `/messages?room=${encodeURIComponent(room)}&search=lounge`);
    assert.equal(history.length, 1);
    assert.deepEqual(history[0].voiceInvite, sent.voiceInvite);
    assert.equal(history[0].pinned, 1);
    assert.equal(history[0].reactions.length, 1);
    await api(owner, `/messages/${sent.id}`, 'DELETE');
    assert.equal(
        f.service.db.prepare('SELECT COUNT(*) n FROM voice_channel_invitations').get().n,
        0,
    );
});

test('invite lists and sends enforce each target channel permission without granting access', async (t) => {
    const f = await fixture(t),
        { api, owner, member, other } = f;
    const channel = await api(owner, '/channels', 'POST', {
        name: 'Restricted',
        kind: 'voice',
        private: true,
    });
    assert.deepEqual((await api(owner, `/voice-channels/${channel.id}/invitees`)).users, []);
    await api(owner, `/voice-channels/${channel.id}/invite`, 'POST', { user: member.user.id }, 403);
    await api(member, `/voice-channels/${channel.id}/invitees`, 'GET', undefined, 403);
    const role = await api(owner, '/roles', 'POST', {
        name: 'Channel member',
        color: '#abcdef',
        permissions: ['calls.join', 'calls.start'],
    });
    await api(owner, `/users/${member.user.id}/roles`, 'PATCH', { roles: [role.id] });
    await api(owner, `/roles/${role.id}/access`, 'PUT', {
        overrides: [{ channel: channel.id, permission: 'channels.view', effect: 'allow' }],
    });
    assert.deepEqual((await api(owner, `/voice-channels/${channel.id}/invitees`)).users, [
        member.user.id,
    ]);
    const invite = await api(owner, `/voice-channels/${channel.id}/invite`, 'POST', {
        user: member.user.id,
    });
    assert.equal(invite.voiceInvite.channel, channel.id);
    await api(other, `/voice-channels/${channel.id}/invite`, 'POST', { user: member.user.id }, 403);
    await api(owner, '/voice-channels/general/invite', 'POST', { user: member.user.id }, 403);
    await api(owner, '/voice-channels/lounge/invite', 'POST', { user: owner.user.id }, 403);
    await api(owner, '/voice-channels/lounge/invite', 'POST', { user: 'missing' }, 403);
    await api(owner, '/voice-channels/lounge/invite', 'POST', { user: 42 }, 400);
    await api(owner, '/roles/everyone', 'PATCH', {
        name: 'Default',
        color: null,
        permissions: ['channels.view', 'calls.join'],
    });
    await api(other, '/voice-channels/lounge/invite', 'POST', { user: member.user.id }, 403);
    await api(owner, `/channels/${channel.id}`, 'DELETE');
    assert.equal((await api(member, `/messages/${invite.id}`)).voiceInvite.name, 'Restricted');
    await api(owner, `/voice-channels/${channel.id}/invitees`, 'GET', undefined, 403);
});

test('new invitation actions can resend immediately while retries remain idempotent', async (t) => {
    const { api, owner, member, other } = await fixture(t);
    const requestId = randomUUID();
    const first = await api(owner, '/voice-channels/lounge/invite', 'POST', {
        user: member.user.id,
        requestId,
    });
    const retry = await api(owner, '/voice-channels/lounge/invite', 'POST', {
        user: member.user.id,
        requestId,
    });
    assert.equal(retry.id, first.id);
    const second = await api(owner, '/voice-channels/lounge/invite', 'POST', {
        user: member.user.id,
        requestId: randomUUID(),
    });
    assert.notEqual(second.id, first.id);
    const room = `dm:${[owner.user.id, member.user.id].sort().join(':')}`;
    assert.equal((await api(member, `/messages?room=${encodeURIComponent(room)}`)).length, 2);
    await api(
        owner,
        '/voice-channels/lounge/invite',
        'POST',
        { user: other.user.id, requestId },
        409,
    );
    await api(
        other,
        '/voice-channels/lounge/invite',
        'POST',
        { user: member.user.id, requestId },
        409,
    );
    await api(
        owner,
        '/voice-channels/lounge/invite',
        'POST',
        { user: member.user.id, requestId: 'invalid' },
        400,
    );
});
