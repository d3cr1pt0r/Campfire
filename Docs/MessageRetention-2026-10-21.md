# Message retention and storage — 2026-10-21

## User-facing behavior

- Messages are kept forever by default. Under **Settings → Storage**, members who can edit server settings choose how long text channels keep messages (the server default) and how long direct messages, including personal notes, keep them. Each text channel can override the default under **Settings → Channels** (server default, forever, or its own period). Periods are Forever, 1 year, 6 months, 3 months, 1 month, 2 weeks or a custom number of days (1–3,650). Members without that permission see the settings read-only.
- When a message is older than its conversation's period, it is deleted with everything attached: files, reactions, polls, link cards. The clock starts when it is posted; edits and reactions don't extend it.
- **Keep messages permanently, only remove files** (a server-wide switch in Settings → Storage) changes that: when a period ends, only files, images and link cards are removed, and the messages stay with their text, reactions and threads. Each removed file leaves a placeholder with its name, an image or file icon and "Removed after the retention period". Turning the switch on applies at once; turning it off deletes old messages, so it waits a week with the banner like a shorter period, unless applied at once behind a confirmation.
- A thread is deleted as a unit, once its newest message is old enough. A running poll keeps its thread until voting ends.
- Pinned messages are never deleted, and a pin anywhere in a thread keeps the whole thread. Unpinning (or deleting a pinned reply) restarts the full period from that moment, so a misclick never loses anything.
- Saving a shorter period first shows what it would delete (about how many messages and how much attachment space, pinned threads excluded). It then waits a week: members see a dismissible banner in affected conversations, and the header chip shows the coming period. The owner can apply it at once instead, behind a second confirmation. A longer period, or the period already in force, applies at once and cancels a pending change.
- While a period applies: an hourglass chip beside the conversation name shows it; hovering a message's time shows "Posted Oct 21 · deleted Dec 21 unless pinned"; a small hourglass marks messages in their last days (the last week, or the last quarter of a shorter period); the Pin button says it keeps the message permanently; unpinning shows when the message will now be deleted. Nothing extra shows while messages are kept forever.
- While text is kept, the hints are about files: the chip reads "Files · 1 month", the hover "files removed Dec 21 unless pinned", and unpinning says when its files go. Messages without files have nothing at risk and show no hints.
- Expired messages disappear from open apps right away. An open thread that expires closes with a notice.
- The Storage tab also shows attachment use against the storage limit, the database file size and its free space, how much pinned threads keep, and the biggest channels, with direct messages as one unnamed total. The attachment storage limit is set there in whole gigabytes; 0 turns new attachments off.
- Deleting a member's account also deletes their direct messages and personal notes, which nobody could open again. Their channel messages stay, shown as Former member.

## How it works

- `messages.since` starts a message's period: its posting time, moved to the moment it was last unpinned. A thread's clock is the newest `since` among its messages; message views carry it as `retention { since, kept, pollEnds }`.
- `retention_mode` holds the keep-text switch, with `keepTextUntil` while turning it off waits; schedule steps carry whether text is kept at that point, so files and text get separate cutoffs and deletion times. With text kept, each pass looks only at threads that still have files or link cards: their attachments keep their name and type with `removed` set and no bytes, their link cards are dropped and hidden so edits don't bring them back, and `messages:files-removed {room, ids}` updates open apps. Downloads and previews of removed files answer 410.
- `retention_policies` holds the server default and the DM period; `channels` holds each override. Each policy has the period in force (`retention`; 0 forever, NULL the server default for a channel) and an optional shorter one waiting in `retentionNext` until `retentionAt`. `shared/retention.js` merges a channel's and the server's policies into a schedule and computes cutoffs and deletion times; the server and the apps both use it.
- The cleanup runs at startup and hourly. It promotes due changes, then deletes expired threads 100 at a time per transaction, yielding to chat between batches. Each batch sends one `messages:expired {room, ids}` per conversation. Cascades remove replies, attachments (keeping the storage total right), reactions, polls and link-card links.
- Freed space returns to the disk: new databases use `auto_vacuum=INCREMENTAL`, and each pass runs `PRAGMA incremental_vacuum` in small steps while free pages remain.
- Preview figures are the difference between what the new and the current periods would delete by the change's date (and now, for applying at once).

## Storage

- Attachments are stored as raw bytes in a BLOB column instead of base64 text, about a quarter less space. A CHECK keeps the stored size equal to the bytes.
- Messages with files are uploaded as `multipart/form-data` with the raw bytes (one `file` part per file), parsed after sign-in with Node's built-in form parser and a limit of the upload size plus 64 KB. Text messages and polls stay JSON; JSON attachments are refused.
- `message_link_previews` records which cards each message shows. Cards are linked when a message is posted or edited and refetches update cards in place, so older messages keep them. Cards no message links are pruned a day after their fetch. The 5,000-card cap stays as a safety limit and drops unlinked cards first.
- The attachment storage quota is the `maxStoredUploadBytes` setting; `MAX_STORED_UPLOAD_BYTES` is the starting value until the owner saves one.
- This version opens only databases it created and drops the compatibility code for older databases, older clients and old saved preferences. Start the server with a new data directory, and update every desktop app.

## Implementation

- `shared/retention.js`, `shared/retention.d.ts`: periods, schedules, deletion times, cutoffs and saving rules. `shared/uploads.js`: storage quota and byte formatting.
- `server/retention.js`: the cleanup, policy routes, previews and the storage overview. `server/schema.sql`, `server/database.js`: retention columns and table, raw attachments, link table, incremental vacuum, the newest-schema check, and the thread clock in message views.
- `server/messages.js`: multipart uploads, raw attachment storage, the quota, the unpin clock, link-card hooks and the `{messages, next}` history. `server/link-previews.js`: card links, pruning and the safer cache update. `server/administration.js`: the quota setting and deleting a member's DMs. `server/polls.js`, `server/voice-invitations.js`: thread refresh on early poll end, required invitation request IDs.
- `src/retention.ts`, `src/RetentionSettings.tsx`, `src/StorageSettings.tsx`, `src/ChatMessages.tsx`, `src/ThreadPanel.tsx`, `src/main.tsx`, `src/ChannelSettings.tsx`, `src/SettingsPanel.tsx`, `src/conversation.ts`, `src/useConversation.ts`, `src/api.ts`, `src/campfire-theme.css`: the cues, the settings, live expiry and multipart sends.
- Tests: `test/retention.test.js` (server, with backdated rows and explicit sweeps), `test/retention-schedule.test.js` (schedules and wording), additions to the link-preview, member-deletion, schema, conversation and app tests. `scripts/verify-retention.mjs` with `test-support/retention.cjs` drives the desktop app.

## Verification

- `npm run format:check`, `npm run check`, `npm test` (all 321 tests), `npm run build` and `git diff --check` passed.
- `node scripts/verify-retention.mjs` in Windows Electron:
  - nothing shows while messages are kept forever;
  - a file and an image uploaded from the composer are stored as raw bytes, and the image preview loads;
  - a pending period shows the chip and the banner, and the dismissed banner stays dismissed after a reload;
  - applying the period removes the expired message live;
  - the hover date and the hourglass appear only near deletion;
  - pinning shows "kept permanently", and unpinning shows the new deletion date and restarts the clock;
  - an open thread that expires closes with its notice;
  - with text kept, the chip says only files are removed, text-only messages show no hints, and an expiring file becomes a placeholder live while its text stays;
  - the Storage tab shows the switch on, both periods and the per-conversation table, and a shorter DM period asks for confirmation about files;
  - screenshots in both themes; no renderer errors.
