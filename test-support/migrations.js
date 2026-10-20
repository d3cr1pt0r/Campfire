import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { migrate } from '../server/database.js';

// Legacy upgrades must reach the same migrations as a fresh database.
export function currentMigrationVersions() {
    const db = new DatabaseSync(':memory:');
    try {
        db.exec(readFileSync(new URL('../server/schema.sql', import.meta.url), 'utf8'));
        migrate(db);
        return db
            .prepare('SELECT version FROM migrations ORDER BY version')
            .all()
            .map((row) => row.version);
    } finally {
        db.close();
    }
}
