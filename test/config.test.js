import { test } from 'node:test';
import assert from 'node:assert/strict';
import { publicAddress, serverConfig } from '../server/config.js';

test('servers use their own TLS identity unless configured otherwise', () => {
    const config = serverConfig({});
    assert.deepEqual(config.tls, { mode: 'self' });
    assert.equal(config.host, '0.0.0.0');
    assert.equal(config.port, 3001);
    assert.deepEqual(config.warnings, []);
    assert.deepEqual(serverConfig({ TLS: 'on' }).tls, { mode: 'self' });
});

test('plain HTTP is limited to loopback development or a trusted HTTPS proxy', () => {
    const dev = serverConfig({ HOST: '0.0.0.0' }, ['--dev-http']);
    assert.deepEqual(dev.tls, { mode: 'off' });
    assert.equal(dev.host, '127.0.0.1');
    assert.deepEqual(serverConfig({ TLS: 'off', HOST: '127.0.0.1' }).tls, { mode: 'off' });
    assert.deepEqual(serverConfig({ TLS: 'off', HOST: '::1' }).warnings, []);
    assert.throws(() => serverConfig({ TLS: 'off' }), /TLS=off is only allowed/);
    assert.throws(() => serverConfig({ TLS: 'off', HOST: '192.168.1.5' }), /TLS=off/);
    const proxied = serverConfig({ TLS: 'off', TRUST_PROXY: '172.18.0.2' });
    assert.deepEqual(proxied.tls, { mode: 'off' });
    assert.deepEqual(proxied.trustProxy, ['172.18.0.2']);
    assert.match(proxied.warnings[0], /reverse proxy/);
    assert.throws(() => serverConfig({ TLS: 'maybe' }), /TLS must be/);
});

test('host certificate files must be configured together', () => {
    assert.deepEqual(serverConfig({ TLS_CERT_FILE: 'cert.pem', TLS_KEY_FILE: 'key.pem' }).tls, {
        mode: 'files',
        certFile: 'cert.pem',
        keyFile: 'key.pem',
    });
    assert.throws(() => serverConfig({ TLS_CERT_FILE: 'cert.pem' }), /both/);
    assert.throws(() => serverConfig({ TLS_KEY_FILE: 'key.pem' }), /both/);
});

test('direct remote HTTP requires both TLS=off and ALLOW_INSECURE_HTTP=1', () => {
    const config = serverConfig({ TLS: 'off', ALLOW_INSECURE_HTTP: '1' });
    assert.deepEqual(config.tls, { mode: 'off' });
    assert.equal(config.host, '0.0.0.0');
    assert.equal(config.trustProxy, false);
    assert.match(config.warnings[0], /credentials.*unencrypted/);
    assert.deepEqual(serverConfig({ ALLOW_INSECURE_HTTP: '1' }).tls, { mode: 'self' });
    for (const value of ['', 'true', '0'])
        assert.throws(() => serverConfig({ TLS: 'off', ALLOW_INSECURE_HTTP: value }), /TLS=off/);
});

test('terminal transport flags override environment settings and reject conflicts', () => {
    const http = serverConfig({ TLS: 'on' }, ['--http']);
    assert.deepEqual(http.tls, { mode: 'off' });
    assert.equal(http.host, '0.0.0.0');
    assert.equal(http.trustProxy, false);
    assert.match(http.warnings[0], /Insecure HTTP enabled/);
    assert.deepEqual(serverConfig({ TLS: 'off' }, ['--https']).tls, { mode: 'self' });
    assert.deepEqual(
        serverConfig({ TLS: 'off', TLS_CERT_FILE: 'cert.pem', TLS_KEY_FILE: 'key.pem' }, [
            '--https',
        ]).tls,
        { mode: 'files', certFile: 'cert.pem', keyFile: 'key.pem' },
    );
    assert.equal(serverConfig({ HOST: '192.168.1.5' }, ['--http']).host, '192.168.1.5');
    for (const args of [
        ['--http', '--https'],
        ['--dev-http', '--https'],
        ['--http', '--dev-http'],
    ])
        assert.throws(() => serverConfig({}, args), /only one transport option/);
});

test('public addresses are plain hostnames or IPs and new identities need an explicit opt-in', () => {
    assert.equal(publicAddress(' Chat.Example.com '), 'chat.example.com');
    assert.equal(publicAddress('203.0.113.5'), '203.0.113.5');
    assert.equal(publicAddress('[2001:db8::1]'), '2001:db8::1');
    assert.equal(publicAddress(''), '');
    for (const invalid of ['https://chat.example.com', 'chat.example.com:3001', 'a b', '-bad.com'])
        assert.throws(() => publicAddress(invalid), /PUBLIC_ADDRESS/);
    assert.equal(serverConfig({}).allowNewIdentity, false);
    assert.equal(serverConfig({ CAMPFIRE_NEW_IDENTITY: '1' }).allowNewIdentity, true);
    assert.throws(() => serverConfig({ PORT: '70000' }), /PORT/);
});
