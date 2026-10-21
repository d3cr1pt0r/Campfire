# Background search — 2026-10-21

## User-facing behavior

- Searching a conversation no longer pauses the server for everyone else. While a search scans a long history, messages, typing, reactions and calls carry on for all members.
- Results are the same as before: text anywhere in a message, ignoring case, newest first, a page at a time.
- When many searches arrive at once, extra ones get "Search is busy. Try again in a moment." A search that runs longer than 10 seconds stops with "Search took too long. Try more specific words."

## How it works

- `server/reader.js` keeps up to two worker threads, started on the first search. Each runs one query at a time on its own read-only connection to `campfire.sqlite`; in WAL mode it reads while the main thread writes. The workers register the same `contains_text` matching as the main connection.
- The search route checks access, builds the query as before and hands it to a worker. When the rows return, the main thread checks access again, re-reads those messages and keeps only those that still exist and still match; then it adds attachments, reactions and the rest as usual. The next-page cursor comes from the scanned rows, so paging stays consistent.
- At most 32 searches wait. A waiting search is dropped when its request closes, for example when the member types more; one already running finishes. A query past 10 seconds is stopped by ending its worker, and a new worker starts for the next search. Closing the server stops the workers and waits for their connections to close.
- Search itself is no faster: a search with no match still reads the whole conversation (about 0.4 seconds per million messages on a desktop), but now only the searching member waits.

## Implementation

- `server/reader.js`: the worker pool, queue, timeout and shutdown. `server/reader-worker.js`: the worker's read-only connection.
- `server/database.js`: `containsText` and `addTextSearch`, shared by both connections; `openDatabase` reports its file.
- `server/messages.js`: searches go through the reader and are re-checked against current rows. `server/app.js`: creates the reader and closes it before the database.
- `test/reader.test.js`: the main thread keeps reading and writing during a slow query, a worker connection cannot write, long queries stop and the pool recovers, waiting queries can be dropped, a full queue answers busy, and closing rejects what remains. Existing search tests in the server, rework, thread, member-messaging and voice-invitation suites now run through the workers.

## Verification

- `npm run format:check`, `npm run check`, `npm test`, `npm run build` and `git diff --check` passed.
