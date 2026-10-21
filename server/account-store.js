import { randomUUID } from 'node:crypto';
import { check } from './policies.js';

export function checkUsername(username) {
    check(
        typeof username === 'string' && /^[a-zA-Z0-9_ -]{2,32}$/.test(username),
        'Username must be 2–32 letters, numbers, spaces, underscores or hyphens',
    );
}

// Call inside the caller's transaction, after registration/restore authorization.
// Both registration and setup restore use this account creation operation.
export function createAccount({ get, run }, { username, passwordHash, owner }) {
    checkUsername(username);
    check(
        typeof passwordHash === 'string' && /^[a-f0-9]{32}:[a-f0-9]{128}$/.test(passwordHash),
        'Unsupported password hash format',
    );
    check(typeof owner === 'boolean', 'Invalid ownership setting');
    check(
        !get('SELECT id FROM users WHERE username=?', username),
        'That username is already taken',
        409,
    );
    const id = randomUUID();
    run(
        'INSERT INTO users(id,username,password,role,owner) VALUES(?,?,?,?,?)',
        id,
        username,
        passwordHash,
        'everyone',
        Number(owner),
    );
    run('INSERT INTO profiles(user,nickname) VALUES(?,?)', id, username);
    return get('SELECT * FROM users WHERE id=?', id);
}
