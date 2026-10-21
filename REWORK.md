# Architecture rework

The application remains a single Express/Socket.IO backend with SQLite, a React
client, and an Electron desktop shell. WebRTC remains a peer-to-peer mesh with the
existing eight-person cap and media protocol version 2.

## Module ownership

| Concern | Files |
| --- | --- |
| Server composition, middleware, state endpoint | `server/app.js` |
| Database schema, startup checks, batched message enrichment | `server/database.js`, `server/schema.sql` |
| Password derivation, sessions, expiry, revocation | `server/security.js`, `server/sessions.js`, `server/accounts.js` |
| Conversation history, messages, reactions, attachments | `server/messages.js` |
| Profiles, avatars, custom emojis | `server/profiles.js` |
| Administration, private calls and signaling | `server/administration.js`, `server/calls.js` |
| Origin policy, bounded authentication limiter, role validation | `server/policies.js` |
| Shared domain/event/media types and DM identity | `shared/contracts.ts`, `shared/rooms.js` |
| JSON/blob transport and coalesced state refresh | `src/api.ts`, `src/stateRefresh.ts` |
| Conversation snapshots, events, cancellation, pagination | `src/conversation.ts`, `src/useConversation.ts` |
| Chat, calls, members, settings, common forms and avatars | `src/ChatMessages.tsx`, `src/CallPanel.tsx`, `src/MemberList.tsx`, `src/SettingsPanel.tsx`, `src/forms.tsx`, `src/Avatar.tsx` |
| Dialog lifecycle, expanded media shell, volume controls | `src/useDialog.ts`, `src/ExpandedViewer.tsx`, `src/VolumeControl.tsx` |
| Capture and peer ownership | `src/useCall.ts` and existing media helpers |

The React entry point still owns navigation, connection credentials, preferences,
and application-level actions. The backend remains JavaScript; shared types check
client event contracts but do not replace server-side runtime validation.

## Behavior and compatibility

- DM room IDs are normalized on the server, so both participants share one
  canonical history.
- Conversation requests are cancelled when replaced. Messages, edits and deletions
  received while a request is pending are replayed over its snapshot. Only the
  active request can publish a response. Full-state refreshes coalesce bursts and
  serialize follow-up requests; changing accounts cancels old requests.
- History uses stable `(created,id)` cursors. The UI loads 100 messages at a time.
  Search and pinned views query the full conversation, including Unicode
  case-insensitive substring matching. Search scans the conversation; it is not
  an indexed full-text search engine. Reconnect reloads the newest page.
- `GET /api/messages` returns `{messages,next}` with a default limit of 500.
  `limit` accepts 1–500, `before` takes the opaque `next` cursor, and `pinned=1`
  restricts results to pins. Search/pin filters apply before pagination.
- Losing `send` permission now blocks editing existing messages as well as new
  messages and reactions. Own-message deletion remains allowed in DMs; text channel mutations also obey channel access.
- Idle sockets disconnect at session expiry. Logout uses the same revocation
  service. Long session lifetimes are split into timer-safe intervals.
- Password hashing uses asynchronous scrypt without changing the stored hash
  format: at most four derivations run concurrently and 32 wait. Excess requests
  return 503 instead of creating an unbounded queue. Registration rechecks
  uniqueness and assigns the first owner atomically after hashing.
- Message enrichment uses two batched queries instead of two per message.
  Community member profiles and avatars are joined in one query.
- Expanded image/video viewers share focus trapping, fullscreen handling, Escape
  behavior and focus restoration. Nested dialogs handle keys only in the top
  dialog. Video continues to use the tile's existing audio playback.

## Configuration and database upgrades

Databases are not upgraded in place. `server/schema.sql` defines the complete
schema and runs on every start, creating whatever a new data directory needs. A
database from an older version is refused at startup; start this version with a
new data directory. The server opens `campfire.sqlite` in the data directory.

Back up the data directory using the SQLite backup mechanism or by stopping the
service and copying it, including WAL files.

The attachment storage quota limits the total bytes of stored attachments, with
accounting and checks inside message transactions. The owner sets it under
Settings → Server settings in whole gigabytes; until then `MAX_STORED_UPLOAD_BYTES`
(default **1073741824**, 1 GiB) applies. Deleting a message, or its expiry under
the retention period, releases its quota through attachment cascade triggers.
Above the limit, existing uploads and downloads remain intact, text messages
still work, and new attachments are rejected until space is freed or the limit
is raised. A limit of zero turns new attachments off. This measures attachment
payloads, not physical database file size; messages, avatars, emojis and SQLite
overhead consume additional space.

`TRUST_PROXY` defaults to empty/disabled. Supply only trusted proxy IP addresses,
CIDRs or Express address groups as a comma-separated list. For example, use
`loopback` only when a local reverse proxy is the route to the backend. Do not
trust arbitrary forwarding headers. Authentication uses the resulting client IP,
with 20 attempts per minute and a bounded, expiring address map. Compose forwards
both configuration variables.

## Development and verification

Application dependencies are pinned to the previously resolved versions. Docker
uses `npm ci`. Prettier is a pinned development dependency; `npm run format`
formats source and `npm run format:check` verifies it. Pull requests and pushes
run formatting, strict type checking, tests and a production build on Linux and
Windows via `.github/workflows/check.yml`.

The packaging command still fetches the pinned electron-builder tool on demand.
An attempt to lock its dependency tree was rejected by npm because it includes
a Git-based `@electron/node-gyp` dependency. The repository does not disable that
restriction. Windows packaging and GitHub Actions execution remain unverified.

Regression coverage includes legacy DM/attachment migration, tied-timestamp
pagination, full-history search and pins, quota rollback/release, read-only edits,
concurrent registration, trusted-proxy limiting, idle socket expiry, stale history
responses, live edit/delete merging, superseded requests and state refresh races.
The full test suite includes real HTTP/Socket.IO transport; these tests require
permission to bind localhost. Media helper tests use controlled doubles.

Local verification on Node 26.11.1 passed all 108 tests, formatting, strict type
checking and the Vite production build. An offline `npm ci --dry-run` also passed.
The added CI matrix targets Node 24; it has not been executed remotely here.

Live Electron/browser UI, keyboard/fullscreen behavior, actual microphones,
camera/screen/system-audio capture, Windows executable packaging, Docker execution,
NAT/TURN, load and physical storage capacity still require separate acceptance
testing. No SFU, attachment-file migration, signing or automatic updates are added.

## Channels and avatar positioning

Migration 3 adds permanent channel markers and role/channel access overrides.
`server/channel-access.js` owns effective access checks and per-user channel
metadata; message events are delivered only to currently authorized sockets.
HTTP history/downloads and all message mutations use the same policy. Calls
filter rosters, check both signaling endpoints and revoke active access after
permission changes or deletion. The protected-channel rule is also enforced by
SQLite triggers. Bootstrap no longer recreates deleted default channels.

`src/ChannelSettings.tsx` exposes naming, confirmed deletion and role access.
`src/AvatarCropper.tsx` owns image decoding, preview, drag/zoom/fit controls and
resource cleanup. Shared geometry in `src/images.ts` drives the preview and the
saved square PNG. The original image is not retained after saving a crop.

Tests cover legacy migration, restart behavior, cascading attachment cleanup,
read-only restrictions including managers, hidden history/download denial, actual
Socket.IO event/roster/signaling isolation, call revocation/deletion, and crop
geometry/render transforms. Live crop dragging, keyboard focus, fullscreen UI,
and actual peer media teardown remain manual acceptance checks.
