import { test } from 'node:test';
import assert from 'node:assert/strict';
import { roleFixture } from '../test-support/role-fixture.js';
import { messageForm } from '../test-support/http.js';

const endpoint = (account) => `/users/${account.user.id}`;
const confirm = (account) => ({ username: account.user.username });

test('account deletion requires its own permission, hierarchy and explicit username confirmation', async (t) => {
    const f = await roleFixture(t);
    await f.api(null, endpoint(f.member), 'DELETE', confirm(f.member), 401);
    await f.api(f.other, endpoint(f.member), 'DELETE', confirm(f.member), 403);
    const moderator = await f.role('Moderator', ['members.ban', 'members.restore']);
    await f.assign(f.other, [moderator.id]);
    await f.api(f.other, endpoint(f.member), 'DELETE', confirm(f.member), 403);
    const administrator = await f.role('Administrator', ['members.delete']);
    await f.assign(f.other, [administrator.id]);
    for (const target of [f.other, f.owner])
        await f.api(f.other, endpoint(target), 'DELETE', confirm(target), 403);
    await f.assign(f.member, [administrator.id]);
    await f.api(f.other, endpoint(f.member), 'DELETE', confirm(f.member), 403);
    await f.api(f.owner, endpoint(f.owner), 'DELETE', confirm(f.owner), 403);
    await f.assign(f.member, []);
    await f.api(f.other, endpoint(f.member), 'DELETE', undefined, 400);
    await f.api(f.other, endpoint(f.member), 'DELETE', { username: 'wrong' }, 400);
    await f.api(f.other, endpoint(f.member), 'DELETE', confirm(f.member));
    await f.api(f.member, '/state', 'GET', undefined, 401);
    await f.api(f.owner, endpoint(f.member), 'DELETE', confirm(f.member), 404);
});

test('deletion erases the account, retains threads and uploads, revokes used invitations and survives restart', async (t) => {
    const f = await roleFixture(t);
    const id = f.member.user.id;
    const message = await f.api(
        f.member,
        '/messages',
        'POST',
        messageForm({ room: 'general', body: 'Keep this history' }, [
            { name: 'file.txt', data: 'hello' },
        ]),
    );
    const reply = await f.api(f.other, '/messages', 'POST', {
        room: 'general',
        thread: message.id,
        body: 'Keep this reply',
    });
    await f.api(f.member, `/messages/${message.id}/reaction`, 'POST', { emoji: '👍' });
    await f.api(f.other, `/messages/${message.id}/reaction`, 'POST', { emoji: '🔥' });
    await f.api(f.owner, `${endpoint(f.member)}/password-reset`, 'POST');
    f.db.prepare("INSERT INTO avatars VALUES('avatar',?,'image')").run(id);
    f.db.prepare("INSERT INTO emojis VALUES('emoji','retained',?,'image')").run(id);
    f.db.prepare("INSERT INTO presence_preferences VALUES(?,'idle')").run(id);
    f.db
        .prepare("INSERT INTO invitations VALUES('used','hash','Used',1,9999999999999,?,0)")
        .run(id);
    const uploadBytes = f.db.prepare('SELECT bytes FROM storage_usage').get().bytes;
    assert.ok(uploadBytes > 0);
    await f.api(f.owner, endpoint(f.member), 'DELETE', confirm(f.member));
    for (const table of [
        'users',
        'sessions',
        'profiles',
        'avatars',
        'presence_preferences',
        'password_resets',
        'user_roles',
        'reactions',
    ]) {
        const column = table === 'users' ? 'id' : 'user';
        assert.equal(
            f.db.prepare(`SELECT COUNT(*) n FROM ${table} WHERE ${column}=?`).get(id).n,
            0,
            table,
        );
    }
    assert.equal(f.db.prepare('SELECT author FROM emojis').get().author, null);
    assert.equal(f.db.prepare('SELECT revoked FROM invitations').get().revoked, 1);
    assert.equal(f.db.prepare('SELECT usedBy FROM invitations').get().usedBy, null);
    assert.equal(f.db.prepare('SELECT bytes FROM storage_usage').get().bytes, uploadBytes);
    assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(), []);
    const retained = await f.api(f.owner, `/messages/${message.id}`);
    assert.equal(retained.author, null);
    assert.equal(retained.replyCount, 1);
    assert.equal(retained.attachments.length, 1);
    assert.deepEqual(
        retained.reactions.map((r) => r.user),
        [f.other.user.id],
    );
    assert.equal((await f.api(f.owner, `/messages/${reply.id}`)).body, 'Keep this reply');
    await f.api(
        null,
        '/auth/login',
        'POST',
        { username: 'Member', password: 'test-password-123' },
        401,
    );
    await f.restart();
    const state = await f.api(f.owner, '/state');
    assert.ok(![...state.users, ...state.removedUsers].some((user) => user.id === id));
    await f.api(f.owner, `${endpoint(f.member)}/access`, 'POST', { enabled: true }, 403);
    const replacement = await f.signup('Member');
    assert.notEqual(replacement.user.id, id);
    assert.equal((await f.api(f.owner, `/messages/${message.id}`)).author, null);
});

test('deletion removes the member’s direct messages and notes, keeping other conversations', async (t) => {
    const f = await roleFixture(t);
    const room = (a, b) => `dm:${[a.user.id, b.user.id].sort().join(':')}`;
    const file = (fields, name) =>
        messageForm(fields, [{ name, data: Buffer.from(`contents of ${name}`) }]);
    const direct = await f.api(
        f.member,
        '/messages',
        'POST',
        file({ room: room(f.member, f.owner), body: 'Private' }, 'direct.txt'),
    );
    await f.api(f.owner, '/messages', 'POST', {
        room: direct.room,
        thread: direct.id,
        body: 'Owner reply',
    });
    await f.api(f.owner, `/messages/${direct.id}/reaction`, 'POST', { emoji: '👍' });
    await f.api(
        f.member,
        '/messages',
        'POST',
        file({ room: room(f.member, f.member), body: 'Note' }, 'note.txt'),
    );
    const unrelated = await f.api(f.owner, '/messages', 'POST', {
        room: room(f.owner, f.other),
        body: 'Not theirs',
    });
    const channel = await f.api(
        f.member,
        '/messages',
        'POST',
        file({ room: 'general', body: 'Public' }, 'public.txt'),
    );
    await f.api(f.owner, endpoint(f.member), 'DELETE', confirm(f.member));
    for (const gone of [room(f.member, f.owner), room(f.member, f.member)])
        assert.equal(
            f.db.prepare('SELECT COUNT(*) n FROM messages WHERE room=?').get(gone).n,
            0,
            gone,
        );
    assert.equal((await f.api(f.owner, `/messages/${unrelated.id}`)).body, 'Not theirs');
    const kept = await f.api(f.owner, `/messages/${channel.id}`);
    assert.equal(kept.author, null);
    assert.equal(kept.attachments.length, 1);
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM attachments').get().n, 1);
    assert.equal(
        f.db.prepare('SELECT bytes FROM storage_usage').get().bytes,
        'contents of public.txt'.length,
    );
    assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(), []);
});

test('disabled accounts can be deleted and failed deletion rolls back all changes', async (t) => {
    const f = await roleFixture(t);
    const kept = await f.api(f.other, '/messages', 'POST', {
        room: `dm:${[f.other.user.id, f.owner.user.id].sort().join(':')}`,
        body: 'Survives the failed deletion',
    });
    await f.api(f.owner, `${endpoint(f.member)}/access`, 'POST', { enabled: false });
    await f.api(f.owner, endpoint(f.member), 'DELETE', confirm(f.member));
    f.db.exec(
        "CREATE TRIGGER fail_deletion BEFORE DELETE ON users BEGIN SELECT RAISE(ABORT,'test rollback'); END",
    );
    await f.api(f.owner, endpoint(f.other), 'DELETE', confirm(f.other), 500);
    assert.equal((await f.api(f.other, '/state')).me.id, f.other.user.id);
    assert.equal(
        f.db.prepare('SELECT COUNT(*) n FROM profiles WHERE user=?').get(f.other.user.id).n,
        1,
    );
    assert.equal((await f.api(f.other, `/messages/${kept.id}`)).body, kept.body);
    assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(), []);
});
