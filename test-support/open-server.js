import { createApp as createProductionApp } from '../server/app.js';
// Existing feature suites intentionally exercise an open community. Registration
// security is tested against production defaults in registration.test.js.
export function createApp(options) {
    // Tests never fetch real websites; link-preview tests enable previews with a fake fetcher.
    const service = createProductionApp({
        linkPreviews: false,
        ...options,
        setupCode: 'test-owner-setup',
    });
    service.db.prepare("UPDATE settings SET value='open' WHERE key='registrationMode'").run();
    return service;
}
