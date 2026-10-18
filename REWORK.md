# Architecture rework

The application remains a single Express/Socket.IO backend with SQLite, a React
client, and an Electron desktop shell. WebRTC remains a peer-to-peer mesh with the
existing eight-person cap and media protocol version 2.

## Module ownership

| Concern | Files |
| --- | --- |
| Server composition, middleware, state endpoint | `server/app.js` |
| Database initialization, versioned migrations, batched message enrichment | `server/database.js`, `server/schema.sql` |
| Password derivation, sessions, expiry, revocation | `server/security.js`, `server/sessions.js`, `server/accounts.js` |
| Conversation history, messages, reactions, attachments | `server/messages.js` |
| Profiles, avatars, custom emojis | `server/profiles.js` |
| Friends, administration, private calls and signaling | `server/friends.js`, `server/administration.js`, `server/calls.js` |
| Origin policy, bounded authentication limiter, role validation | `server/policies.js` |
| Shared domain/event/media types and DM identity | `shared/contracts.ts`, `shared/rooms.js` |
| JSON/blob transport and coalesced state refresh | `src/api.ts`, `src/stateRefresh.ts` |
| Conversation snapshots, events, cancellation, pagination | `src/conversation.ts`, `src/useConversation.ts` |
| Chat, calls, friends, settings, common forms and avatars | `src/ChatMessages.tsx`, `src/CallPanel.tsx`, `src/FriendsPanel.tsx`, `src/SettingsPanel.tsx`, `src/forms.tsx`, `src/Avatar.tsx` |
| Dialog lifecycle, expanded media shell, volume controls | `src/useDialog.ts`, `src/ExpandedViewer.tsx`, `src/VolumeControl.tsx` |
| Capture and peer ownership | `src/useCall.ts` and existing media helpers |

The React entry point still owns navigation, connection credentials, preferences,
and application-level actions. The backend remains JavaScript; shared types check
client event contracts but do not replace server-side runtime validation.

## Behavior and compatibility

- DM room IDs are normalized on the server. Migration 1 merges reversed legacy
  room IDs into the canonical history while preserving message IDs, attachments
  and reactions.
- Conversation requests are cancelled when replaced. Messages, edits and deletions
  received while a request is pending are replayed over its snapshot. Only the
  active request can publish a response. Full-state refreshes coalesce bursts and
  serialize follow-up requests; changing accounts cancels old requests.
- History uses stable `(created,id)` cursors. The UI loads 100 messages at a time.
  Search and pinned views query the full conversation, including Unicode
  case-insensitive substring matching. Search scans the conversation; it is not
  an indexed full-text search engine. Reconnect reloads the newest page.
- `GET /api/messages` retains the legacy array response and a default limit of
  500. `page=1` returns `{messages,next}`. `limit` accepts 1–500, `before` takes the
  opaque `next` cursor, and `pinned=1` restricts results to pins. Search/pin filters
  apply before pagination. Update the server before distributing the new client.
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

### Campfire branding upgrade

Before starting this version on an existing installation:

1. Stop the backend and back up its complete data directory. Rename the previous
   application database to `campfire.sqlite` in that directory, along with any
   matching `-wal` and `-shm` sidecars. Do this before restarting so the backend
   opens the existing community instead of creating a fresh database.
2. Docker Compose now uses the `campfire` service and `campfire-data` volume.
   Reuse the existing volume with an override declaring `campfire-data` as
   `external: true` and setting `name` to the existing Docker volume name.
   Rename the database inside that volume while the service is stopped.
3. Desktop builds now use package/executable name `campfire` and app ID
   `org.campfire.desktop`. With the app fully closed, copy the previous desktop
   user-data directory into the new Campfire profile to retain client settings.
   Encrypted credentials remain subject to the operating system's key storage;
   signing in again may be required. The preload bridge is now `window.campfire`,
   so rebuild the renderer and desktop shell together.

Back up the database before upgrading, using the SQLite backup mechanism or by
stopping the service and copying the data directory including WAL files. Restart
the backend, then update browser/desktop clients. Existing accounts, password
hashes, sessions, preferences and media behavior are retained.

Database migrations run transactionally and record their versions. Migration 2
adds decoded attachment sizes and a trigger-maintained usage total. Re-running
startup does not reapply migrations. Old server code inserts attachments using
the former schema, so rolling back requires restoring the pre-upgrade database
backup along with the old code.

`MAX_STORED_UPLOAD_BYTES` defaults to **1073741824** (1 GiB). It limits aggregate
decoded attachment bytes, with accounting and checks inside message transactions.
Deleting a message releases its quota through attachment cascade triggers. If an
existing database already exceeds the limit, uploads and downloads remain intact,
text messages still work, and new attachments are rejected until space is freed
or the configured limit is increased. A value of zero disables new nonempty
attachments. This measures attachment payloads, not physical database file size;
base64, messages, avatars, emojis and SQLite overhead consume additional space.

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
