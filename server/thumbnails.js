import sharp from 'sharp';

// Decoding happens off the JS thread. Bound workers, queued originals, decoded
// pixels and the persistent derived cache separately from original uploads.
sharp.cache(false);
sharp.concurrency(1);
export function createThumbnails({ get, all, run }) {
    const pending = new Map();
    const queue = [];
    let active = 0;
    let closed = false;
    let closing = false;
    const pump = () => {
        while (!closed && active < 2 && queue.length) {
            const task = queue.shift();
            active++;
            task().finally(() => {
                active--;
                pump();
            });
        }
    };
    return {
        async get(id, load) {
            const cached = get('SELECT data FROM attachment_previews WHERE attachment=?', id);
            if (cached) return cached.data ? Buffer.from(cached.data) : null;
            if (pending.has(id)) return pending.get(id);
            if (closing || closed || pending.size >= 32)
                throw Object.assign(new Error('Previews are busy. Try again shortly.'), {
                    status: 503,
                });
            const result = new Promise((resolve, reject) => {
                queue.push(async () => {
                    try {
                        let data = null;
                        try {
                            const original = load();
                            if (!original) {
                                resolve(null);
                                return;
                            }
                            data = await sharp(original, { limitInputPixels: 40_000_000, pages: 1 })
                                .rotate()
                                .resize(480, 360, { fit: 'inside', withoutEnlargement: true })
                                .webp({ quality: 75, effort: 3 })
                                .timeout({ seconds: 5 })
                                .toBuffer();
                            if (data.length > 262144) data = null;
                        } catch {
                            /* Invalid or oversized rasters remain downloadable. */
                        }
                        if (!closed && get('SELECT id FROM attachments WHERE id=?', id)) {
                            let { bytes, count } = get(
                                'SELECT COALESCE(SUM(bytes),0) bytes,COUNT(*) count FROM attachment_previews',
                            );
                            if (bytes + (data?.length || 0) > 64 * 1024 * 1024 || count >= 4096)
                                for (const oldest of all(
                                    'SELECT attachment,bytes FROM attachment_previews ORDER BY rowid',
                                )) {
                                    if (
                                        bytes + (data?.length || 0) <= 64 * 1024 * 1024 &&
                                        count < 4096
                                    )
                                        break;
                                    run(
                                        'DELETE FROM attachment_previews WHERE attachment=?',
                                        oldest.attachment,
                                    );
                                    bytes -= oldest.bytes;
                                    count--;
                                }
                            run(
                                'INSERT OR IGNORE INTO attachment_previews(attachment,data,bytes) VALUES(?,?,?)',
                                id,
                                data,
                                data?.length || 0,
                            );
                        }
                        resolve(data);
                    } catch (error) {
                        reject(error);
                    }
                });
            });
            pending.set(id, result);
            pump();
            try {
                return await result;
            } finally {
                pending.delete(id);
            }
        },
        async close() {
            closing = true;
            // Let queued work finish before closing SQLite.
            await Promise.allSettled([...pending.values()]);
            closed = true;
        },
    };
}
