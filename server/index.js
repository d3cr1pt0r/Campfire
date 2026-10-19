import path from 'node:path';
import { createApp } from './app.js';
import { serverConfig } from './config.js';
import { formatFingerprint } from './identity.js';
// Database, identity key and certificate files are private to the server account.
process.umask(0o077);
let config;
try {
    config = serverConfig(process.env, process.argv.slice(2));
} catch (error) {
    console.error(`Invalid configuration: ${error.message}`);
    process.exit(1);
}
for (const warning of config.warnings) console.warn(`Warning: ${warning}`);
let service;
try {
    service = createApp({
        ...config,
        tls:
            config.tls.mode === 'self'
                ? {
                      directory: path.join(config.dataDir, 'identity'),
                      address: config.publicAddress,
                      allowNew: config.allowNewIdentity,
                  }
                : config.tls.mode === 'files'
                  ? config.tls
                  : null,
    });
} catch (error) {
    console.error(`Campfire could not start: ${error.message}`);
    process.exit(1);
}
const scheme = config.tls.mode === 'off' ? 'http' : 'https';
const address = config.publicAddress
    ? config.publicAddress.includes(':')
        ? `[${config.publicAddress}]`
        : config.publicAddress
    : 'YOUR-SERVER-ADDRESS';
const origin = `${scheme}://${address}${config.port === (scheme === 'https' ? 443 : 80) ? '' : `:${config.port}`}`;
const pin = service.identity?.fingerprint && formatFingerprint(service.identity.fingerprint);
if (pin) {
    console.log(`Server fingerprint: ${pin}`);
    console.log(`Server link (share it so members can verify this server): ${origin}/#pin=${pin}`);
} else if (service.identity)
    console.log(`TLS certificate SHA-256: ${service.identity.certificateSha256}`);
if (service.setupCode) {
    console.log(`Owner setup code (required for the first account): ${service.setupCode}`);
    if (pin)
        console.log(
            `Owner setup link (paste into the Campfire desktop app): ${origin}/#pin=${pin}&setup=${service.setupCode}`,
        );
}
service.http.listen(config.port, config.host, () =>
    console.log(`Campfire server listening on ${scheme}://${config.host}:${config.port}`),
);
let stopping = false;
const shutdown = () => {
    if (stopping) return;
    stopping = true;
    void service.close().then(
        () => process.exit(0),
        (error) => {
            console.error('Server shutdown failed:', error);
            process.exit(1);
        },
    );
};
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, shutdown);
