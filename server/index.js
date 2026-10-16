import { createApp } from './app.js';
const port = Number(process.env.PORT || 3001);
const service = createApp({ dataDir: process.env.DATA_DIR || 'data', name: process.env.SERVER_NAME || 'My Driskord server', origins: (process.env.CLIENT_ORIGINS || '').split(',').filter(Boolean), iceServers: JSON.parse(process.env.ICE_SERVERS || '[]') });
service.http.listen(port, process.env.HOST || '0.0.0.0', () => console.log(`Driskord server listening on port ${port}`));
for (const signal of ['SIGINT', 'SIGTERM'])
    process.on(signal, async () => { await service.close(); process.exit(0); });
