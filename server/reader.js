import { Worker } from 'node:worker_threads';

const busy = () =>
    Object.assign(new Error('Search is busy. Try again in a moment.'), { status: 503 });

// Runs slow read-only queries, like message search, on worker threads, so the main thread
// keeps serving chat and calls while they scan. Workers start on first use; each runs one
// query at a time, and a query that runs too long is stopped with its worker.
export function createReader(file, { workers = 2, queued = 32, timeoutMs = 10000 } = {}) {
    const pool = [],
        queue = [],
        stopping = new Set();
    const stop = (worker) => {
        const done = worker.terminate().finally(() => stopping.delete(done));
        stopping.add(done);
    };
    let closed = false;
    const finish = (slot, settle) => {
        clearTimeout(slot.timer);
        const job = slot.job;
        slot.job = null;
        if (job) settle(job);
        pump();
    };
    const retire = (slot, error) => {
        pool.splice(pool.indexOf(slot), 1);
        stop(slot.worker);
        finish(slot, (job) => job.reject(error));
    };
    const start = () => {
        const slot = {
            worker: new Worker(new URL('./reader-worker.js', import.meta.url), {
                workerData: { file },
            }),
            job: null,
            timer: null,
        };
        slot.worker.unref();
        slot.worker.on('message', ({ rows, error }) =>
            finish(slot, (job) =>
                error
                    ? job.reject(Object.assign(new Error(error), { status: 500 }))
                    : job.resolve(rows),
            ),
        );
        slot.worker.on('error', (error) => retire(slot, error));
        slot.worker.on('exit', () => {
            if (pool.includes(slot)) retire(slot, new Error('Search stopped unexpectedly'));
        });
        pool.push(slot);
        return slot;
    };
    const pump = () => {
        while (!closed && queue.length) {
            const slot = pool.find((entry) => !entry.job) ?? (pool.length < workers && start());
            if (!slot) return;
            const job = queue.shift();
            slot.job = job;
            slot.timer = setTimeout(
                () =>
                    retire(
                        slot,
                        Object.assign(new Error('Search took too long. Try more specific words.'), {
                            status: 503,
                        }),
                    ),
                timeoutMs,
            );
            slot.worker.postMessage({ sql: job.sql, params: job.params });
        }
    };
    return {
        // Resolves to the rows; a waiting query is dropped when signal aborts.
        all(sql, params, signal) {
            if (closed || queue.length >= queued) return Promise.reject(busy());
            return new Promise((resolve, reject) => {
                const job = { sql, params, resolve, reject };
                signal?.addEventListener('abort', () => {
                    const index = queue.indexOf(job);
                    if (index < 0) return;
                    queue.splice(index, 1);
                    reject(signal.reason);
                });
                queue.push(job);
                pump();
            });
        },
        async close() {
            closed = true;
            for (const job of queue.splice(0)) job.reject(busy());
            for (const slot of pool.splice(0)) {
                clearTimeout(slot.timer);
                slot.job?.reject(busy());
                stop(slot.worker);
            }
            // Stopped workers have closed their connections before the database closes.
            await Promise.allSettled([...stopping]);
        },
    };
}
