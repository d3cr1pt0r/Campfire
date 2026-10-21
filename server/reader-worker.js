import { parentPort, workerData } from 'node:worker_threads';
import { DatabaseSync } from 'node:sqlite';
import { addTextSearch } from './database.js';

// Its own read-only connection: in WAL mode it reads while the main thread writes.
const db = new DatabaseSync(workerData.file, { readOnly: true });
addTextSearch(db);
parentPort.on('message', ({ sql, params }) => {
    try {
        parentPort.postMessage({ rows: db.prepare(sql).all(...params) });
    } catch (error) {
        parentPort.postMessage({ error: error.message });
    }
});
