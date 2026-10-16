# Driskord implementation guide

This document describes the initial source implementation and is intended to be updated with future features. See README.md for setup and exact validation status. The implementation is an early private-community prototype; outstanding runtime/media validation is not implied by a feature being listed here.

## Product decisions

- English-only UI.
- Independent self-hosted servers, identified by HTTP(S) origins. Each server owns accounts, friends, roles, messages, and files.
- The first account owns a new server. All later accounts use the Member role.
- Up to eight peers per voice channel. Mesh WebRTC, not an SFU.
- Text channels, DMs, attachments, all six requested messaging extras, and all six requested calling extras.
- Community extras were not selected; the response instead requested this implementation document. Channels remain public text/voice channels. DMs are private to their participants; the subsequent direct-call implementation adds invite-only temporary voice/video rooms.

## File map and boundaries

| File | Responsibility |
| --- | --- |
| `electron/main.cjs` | Single-instance desktop lifecycle, isolated renderer, permissions, storage IPC and screen/window picker |
| `electron/renderer-server.cjs` | Local UI-only static asset server with CSP, host/path validation, and no community APIs |
| `electron/preload.cjs` | Narrow allowlisted client-state storage bridge |
| `electron/client-state.cjs` | Atomic client settings/session persistence independent of renderer port; OS encryption when available |
| `electron-builder.cjs` | Windows x64 portable executable configuration |
| `.github/workflows/windows.yml` | Manually triggered Windows build/test/artifact workflow |
| `server/index.js` | Standalone entry, environment configuration, signals |
| `server/app.js` | App factory, REST endpoints, session/permission enforcement, live events, presence and call signaling |
| `server/schema.sql` | Initial SQLite schema and indexes |
| `server/security.js` | Password/token hashing and pure permission/conversation-access helpers |
| `src/main.tsx` | Application/auth shell, chat, friend list, settings, dialogs, REST and socket state coordination, media tiles |
| `src/media.ts` | Shared microphone acquisition, unavailable-device recovery and capture diagnostics |
| `src/MicrophoneMeter.tsx`, `src/microphoneMonitor.ts` | On-demand settings input meter, signal measurement and capture/analysis resource lifecycle |
| `src/signaling.ts` | Serialized peer signaling, offer ownership, collision handling and queued ICE |
| `src/MediaTile.tsx`, `src/playback.ts` | Separate remote audio/video playback, explicit playback retry and output-device recovery |
| `src/ExpandedVideo.tsx` | Portal-based large video viewer, full screen, keyboard focus and shared participant volume |
| `src/peerMedia.ts` | Serialized per-peer sender attachment, fixed voice/video/system-audio roles and stream-subscription validation |
| `src/AudioPlayback.tsx` | Independent voice/system audio elements, playback retry, volume and output routing |
| `src/profiles.ts` | Nickname-first display names with permanent username fallback |
| `src/useCall.ts` | Media stream ownership, peer connections, signaling, mute/deafen, PTT, camera and screen track lifecycle |
| `src/types.ts`, `src/desktop.d.ts` | Client contracts, preload storage API, and Vite client/CSS declarations |
| `src/style.css` | Responsive dark desktop layout and component styles; no third-party font requests |
| `test/security.test.js` | Dependency-free password, token, permission and DM-access tests |
| `test/schema.test.js` | Dependency-free SQLite constraints and cascade behavior |
| `test/server.test.js` | Temporary-server integration tests with real Socket.IO clients |
| `test/desktop.test.js` | Desktop storage persistence, encryption integration, asset-host isolation and portable-build configuration |
| `Dockerfile`, `compose.yaml` | Standalone web/server deployment and persistent data volume |

The UI is shared by browser and Electron. No Node.js primitives are exposed to renderer content; the preload exposes only get/set/remove of the connection, preferences and rendererPort keys. The Electron shell hosts only renderer assets on localhost and does not import the community server or create a community database. Remote community connections go through HTTP and Socket.IO, so the backend can later be moved to another runtime without replacing the UI. The current renderer keeps components together for initial delivery; extract `ChatView`, `FriendsView`, and `SettingsDialog` into separate modules when extending their behavior.

## Data model

SQLite runs in WAL mode with foreign keys. All SQL inputs use bound parameters. The schema is idempotent for fresh/repeated startup; there is no versioned migration framework yet. Before changing existing tables, introduce a schema-version table and transactional migrations rather than editing only CREATE TABLE IF NOT EXISTS.

- `roles`: ID, name, hex name color, JSON permission array.
- `users`: UUID, unique case-insensitive username, salted scrypt hash, role FK, reserved banned flag.
- `sessions`: SHA-256 hash of a random 256-bit bearer token, user FK, expiration. Tokens last 30 days. Expired rows are cleaned during authentication requests.
- `channels`: ID, normalized lowercase text-channel name or case-preserving voice display name, `text` or `voice` kind.
- `messages`: UUID, conversation key, author FK, plain-text body, creation/edit timestamps, pinned flag.
- `attachments`: UUID, message FK, original filename, sniffed raster MIME (otherwise binary), base64 payload. Cascade deletion with the message.
- `reactions`: message/user/emoji primary key. Cascade deletion with the message.
- `friends`: sender/recipient primary key, accepted flag. A reverse request accepts an incoming request.
- `settings`: key/value store (currently server name).
- `profiles`: user FK primary key and editable nickname, backfilled from usernames at startup. Username changes are rejected by a SQLite trigger.
- `avatars`: version UUID, unique user FK, bounded PNG base64. Replacing an avatar replaces its ID.
- `emojis`: UUID, unique shortcode name, author FK, bounded PNG base64. Private calls use in-memory state, not a table.

Text conversation keys are channel IDs. DM keys are `dm:<smaller-user-UUID>:<larger-user-UUID>` using lexicographic sort in the client. The server checks exactly two existing, distinct participants and requester membership. All attachment access derives from its owning message's conversation. Account rosters are visible to server members. DMs can be initiated from any member, even before friendship acceptance.

Attachments are capped at ten files and 5 MB combined per message. Before larger deployments, move file bytes out of SQLite, stream uploads/downloads, enforce disk quotas, and add retention controls. Message and attachment insertion run in one SQLite transaction, so a batch cannot create a partially attached message.

## Authentication and authorization

Clients send `Authorization: Bearer <token>` over HTTP and `auth.token` in the Socket.IO handshake. Session tokens are hashed in the database; the browser client token lives in localStorage; the desktop client uses the narrow preload storage bridge to persist it across temporary UI-port changes. On Windows, safeStorage encrypts client-state.dat with the current OS user key. Without encryption support, the client falls back to user-filesystem-protected plaintext (matching the browser localStorage trust model). Log out revokes the token and disconnects sockets with that token. Socket middleware revalidates the session and role on every incoming event. An idle socket may remain connected after token expiration until its next event; add scheduled session expiry enforcement before broader deployments.

Owner always has all permissions. Other roles have independent `send`, `voice`, and `manage` permissions:

| Permission | Capabilities |
| --- | --- |
| `send` | New messages, attachments, reactions and custom emoji uploads |
| `voice` | Join voice channels/private calls, invite accepted friends, signal peers and publish activity |
| `manage` | Server naming, channel creation, non-management role editing/creation, pin/unpin and deletion of other users' messages |

Only Owner assigns user roles or grants/edits roles containing `manage`. Owner cannot be demoted by the current API. Message authors can edit/delete their existing messages and reactions require conversation access and the send permission. Pinning requires management permission and conversation access. Clients losing voice permission receive `call:revoked`, and all other participants receive an updated call roster so their connections close.

All channels are readable by all authenticated users. Do not implement private-channel UI alone: apply visibility checks consistently to state/rosters, message history, live event routing, attachments, typing, call joins, and signals. Public messages currently broadcast to all authenticated sockets; this must change when channel membership becomes private.

The prototype uses synchronous scrypt and database queries. Auth attempts have a per-IP, in-memory 20/minute limit; behind a reverse proxy, clients share that proxy's IP unless a safe trusted-proxy strategy is added. Registration is open. Before public distribution, add registration controls, comprehensive route/socket throttles, asynchronous password hashing, quotas, audit logging, session management, backups, and recovery. Open registration plus first-user ownership means initial bootstrap must happen before exposure.

Electron enables context isolation and sandboxing and disables Node integration. The preload storage IPC checks that requests originate from the local UI origin, restricts keys to connection/preferences/rendererPort and limits JSON values to 16 KB. New renderer windows are denied; HTTP(S) links without embedded credentials open through shell.openExternal in the system browser. In-app navigation is constrained to the renderer origin. Media/notification permissions are restricted to that local origin. The production server sends a CSP header that prevents remote scripts, object embeds, and inline scripts (the Vite development server uses its own development behavior); remote HTTP(S)/WebSocket connections remain enabled to support arbitrary self-hosted servers. Changing renderer-origin handling requires reviewing the permission handlers and CSP together.

## REST API

All `/api` routes except `/info` and `/auth/:action` require a session. Errors return `{error: string}` with an HTTP status. Auth returns `{token,user}`. State is a snapshot; state-changing endpoints broadcast `refresh` where relevant.

| Method | Path | Operation |
| --- | --- | --- |
| GET | `/api/info` | Server name and registration availability |
| POST | `/api/auth/register`, `/api/auth/login` | `{username,password}`; register/sign in |
| POST | `/api/logout` | Revoke current session |
| GET | `/api/state` | Current user, users, roles, channels, friends, online IDs, visible call roster, private-call invitations/membership, custom emoji metadata, ICE config |
| GET | `/api/messages?room=...&search=...` | Latest 500 accessible messages; optional substring filter |
| POST | `/api/messages` | `{room,body,attachments?:[{name,data}]}`; legacy singular attachment remains accepted |
| PATCH | `/api/messages/:id` | `{body? ,pinned?}` with separate permission checks |
| DELETE | `/api/messages/:id` | Delete owned message or manager-moderated message |
| POST | `/api/messages/:id/reaction` | Toggle `{emoji}` from the allowed set |
| GET | `/api/attachments/:id` | Authorized download; `?inline=1` serves sniffed PNG/JPEG/GIF/WebP only as an inline raster |
| PATCH | `/api/profile` | `{nickname}` for the authenticated account; username edits rejected |
| POST / DELETE | `/api/profile/avatar` | Set own `{data}` resized PNG / remove own avatar |
| GET | `/api/avatars/:id` | Authenticated PNG profile image |
| POST | `/api/emojis` | `{name,data}` bounded PNG, send permission |
| GET / DELETE | `/api/emojis/:id` | Authenticated image / author or manager deletion |
| POST | `/api/calls` | `{user}` online accepted friend; returns private room `{id}` |
| POST | `/api/calls/:id/invite` | `{user}`; caller must participate in this private call |
| POST | `/api/calls/:id/decline` | Reject invitation or remove own inactive membership |
| POST | `/api/friends` | `{username}`; request or accept incoming request |
| DELETE | `/api/friends/:id` | Remove friendship or request |
| POST | `/api/channels` | `{name,kind}`; manager only |
| POST | `/api/roles` | `{name,color,permissions}` |
| PATCH | `/api/roles/:id` | Edit name/color/permissions, preserving Owner role |
| PATCH | `/api/users/:id/role` | `{role}`; owner only |
| PATCH | `/api/settings` | `{name}`; manager only |

## Socket contract

Server → client:

- `refresh`: fetch a new `/state` snapshot.
- `message`: complete new message including attachment metadata and reactions.
- `message:update`: replacement message.
- `message:delete`: `{id,room}`.
- `typing`: `{room,user}`.
- `calls`: `[{socket,user,channel}]` roster, excluding private rooms the recipient is not allowed to join.
- `call:invite`: `{id,from}` invitation hint; `/state` holds authoritative pending invitations.
- `call:speaking`: `{user,active}`, only to other sockets in the same call.
- `signal`: `{from,user,data}`; a peer's WebRTC description or ICE candidate.
- `call:revoked`: local call access was revoked; stop capture and close peers.

Client → server:

- `typing(room)`: authorized conversation only.
- `call:join(channel, acknowledgement)`: ack `{peers}` or `{error}`; voice permission, channel kind, single device per user and eight-person cap are checked.
- `call:leave()`: clear active membership and destroy an empty private room.
- `call:speaking(boolean)`: microphone activity hint, checked for voice permission/current call and rate-limited.
- `signal({to,data})`: relay only between sockets in the same active voice channel.

Public channel events are broadcast. DM events target participant-specific socket rooms. Clients deduplicate message IDs. Unread badges are in-memory, not synced read receipts. Socket reconnection reloads presence/state and the currently open conversation. Other conversations refresh when opened. Add cursor reconciliation and unread synchronization before depending on offline delivery.

## Media lifecycle

`useCall` owns all acquired streams and peer connections. Leaving, disconnecting, or unmounting stops microphone/camera/screen tracks. Joining acquires the selected microphone, asks the server to join, then creates connections to existing peers. Incoming peers connect via authenticated signal events. Socket-ID ordering determines the polite peer during offer collisions; candidates queue until a remote description exists.

Each peer reserves three send/receive transceivers: voice audio, camera/screen video, and screen system audio. Microphone and system sound are independent tracks. Screen video and system audio attach only for subscribers to the current share; stopping subscription detaches both senders while preserving voice. Camera and screen are not sent simultaneously; webcam video retains its existing automatic behavior. Stopping sharing restores camera video if active. Resolution is a browser constraint preference, not guaranteed actual encoded resolution or bitrate. The initial sender has no explicit bitrate adaptation policy.

PTT uses focused-window keyboard events. Input fields are excluded and blur releases the key, avoiding stuck microphone transmission. Mute and deafen gate the local microphone; deafen also silences remote media elements. Remote audio output is set per dedicated audio element via `setSinkId` when supported. Volume is local to each participant tile and resets when that peer reconnects. Noise controls use browser capture constraints, not custom DSP. A short Web Audio tone provides call feedback.

The Electron screen picker uses the native system picker where supported and a source-name choice dialog as fallback. Screen/window permissions and behavior, especially Wayland portals and macOS permissions, need platform testing. The browser uses its normal getDisplayMedia picker.

Mesh means N×(N−1) directional peer links: eight participants can require seven outgoing media copies per sender, so the cap is a functional limit, not a performance guarantee. For larger calls, replace signaling/media transport with an SFU (e.g. a self-hosted media service), while keeping server-side account/channel authorization. TURN relay bandwidth also scales with media traffic.

## Extension priorities

1. Install dependencies, retain the generated lockfile, run strict checks/build/integration tests, and validate two real clients with microphone/camera/screen capture.
2. Extract UI and API groups into modules and introduce versioned migrations/shared runtime request schemas.
3. Add cursor-based message history, reconnect reconciliation, indexed full-history search, independent pin retrieval, persistent per-user read state, and server pagination.
4. Add registration controls, reliable session expiry, upload quotas/streaming, recovery, async password hashing, structured errors and comprehensive request/event limits.
5. Add optional community features only after confirming scope: private channels, expiring invites, moderation, icons and saved server accounts. Editable nicknames now exist as described below.
6. Validate the Windows packaging path, add signing and an update strategy, then per-platform capture/output tests and device-loss recovery.

## STUN-only connectivity test configuration

`npm run server` now uses Node's `--env-file-if-exists=.env` flag, supported by the declared Node minimum. The ignored local `.env` opts this checkout into `[{"urls":"stun:stun.l.google.com:19302"}]`; the example documents the opt-in while keeping the default empty. Exported shell variables override the file. No new dependency, wire format, database migration or client rebuild is involved: `/api/state` already supplies `iceServers`, and new peer connections already use it. Restart the running server, then reopen clients before testing. Other deployments must configure their own environment; local `.env` is not committed.

The test uses a third-party STUN service for address discovery only. Outbound UDP 19302 must work from participants; no new inbound forward is introduced. First validate bidirectional audio between different networks for one minute, then camera and screen sharing. Gather `srflx` candidates with the WebRTC Trickle ICE sample when diagnosing failures. STUN discovery alone does not prove media connectivity; a failed call may still require signaling investigation or a TURN relay. Live internet-call validation remains a user-assisted step.

## Windows packaging and connection defaults

`npm run dist:win` runs the actual type check and Vite build, then invokes pinned `electron-builder@26.0.12` via npm exec. This tool is downloaded on demand; it does not change the app dependency lockfile. The build requires registry/Electron/NSIS downloads. The existing app lockfile should be committed and used with npm ci on CI. Configuration is in electron-builder.cjs:

- Stable app ID `org.driskord.desktop` (also set as the Windows AppUserModelId).
- Product name Driskord; x64 portable target; output `release/Driskord-${version}-${arch}-Portable.exe`.
- No install wizard, elevation, Start menu registration or shortcuts. The portable launcher extracts runtime files temporarily.
- App assets and Electron shell packaged in ASAR; server source, databases, tests, .env and release output are not selected as application source. Electron-builder also collects declared production dependencies.
- No native app dependency rebuilding is required; the desktop shell uses Node/Electron built-ins.
- No automatic publishing, updater or signing configuration. Keep app ID stable and increase package.json version for later releases. Updates replace the closed EXE; client settings stay in the current Windows AppData profile, independent of the executable location. They are not moved with the EXE.

The workflow `.github/workflows/windows.yml` is workflow_dispatch only, uses a Windows runner/Node 24, installs application dependencies with npm ci, runs checks/tests, and uploads the EXE as the 14-day Driskord-Windows-x64-Portable Actions artifact. It does not create GitHub Releases. No workflow has been run from this environment.

VITE_DEFAULT_SERVER_URL can prefill a public server origin when building. It is visible in the renderer bundle and must not contain credentials or secrets. Without this variable, Electron shows a blank required server field; browser clients default to their hosting origin (Vite development defaults to localhost:3001). Saved connections override defaults. The localhost port used by the desktop is UI infrastructure only, never the suggested community address. Friends run the shared server separately.

Client state is written atomically under userData/client-state.dat so sessions/preferences survive port changes, relaunch and replacement of the portable EXE. Electron uses safeStorage when available. Tests use an encryption-service stub; actual Windows DPAPI behavior is not validated here. Earlier embedded-server databases are neither migrated nor deleted; use their original standalone data directory if those accounts need to be preserved.

## Chat scrolling and layout bounds

The app grid uses an explicit `minmax(0,1fr)` row. The workspace, column container, and chat pane allow zero minimum height and contain overflow; message history owns vertical scrolling instead of contributing an unbounded minimum height to its ancestors. The message list uses a stable scrollbar gutter and a visible dark-theme thumb, and the composer and optional call panel do not flex-shrink. This keeps history inside the available height as messages accumulate, including while a call or attachment preview is open. Text wrapping remains responsible for long message bodies.

For visual regression checks, load a long channel/DM at 1440×900 and 960×640, scroll to both ends, and verify the header, composer and footer remain visible and the outer document does not scroll. Repeat with the call panel, attachment preview, and member list shown/hidden, and after resizing the window. Also verify short/empty history. Type checking and the production build can validate the code pipeline but do not prove these visual checks. Electron layout-fixture execution was attempted here and blocked by the sandbox before renderer startup (`sandbox_host_linux.cc`, shutdown operation not permitted); real browser/Windows validation remains outstanding.

## Microphone acquisition and diagnostics

Microphone capture is centralized in `src/media.ts`, shared by call joins and the settings permission check. Native capture errors may contain an empty message; the UI now displays the exception name and actionable guidance for denied permission, absent devices, unreadable/busy audio devices, constraint failures, interrupted capture, and missing secure-context APIs. Linux audio-service failures are distinguished from STUN/ICE failures: microphone acquisition happens before joining/signaling a call.

A persisted selected device ID can stop matching after a USB disconnect or a change to the temporary desktop renderer origin. Capture retries once with the system default only for a missing selected input or a device-ID constraint failure. Permission denial, unreadable hardware, and unrelated constraints are never retried against another input. On successful fallback, the caller resets the saved input to System default and tells the user. If the call was canceled while capture was pending, the acquired tracks are stopped and the saved choice is not changed. Failed fallback reports its final capture error.

`test/media.test.js` exercises empty-error diagnostics, API availability, default and explicit-device constraints, missing-device recovery, and no retry on denied/busy devices. The test commands enable Node's TypeScript stripping so the tests run the same helper as the client without a separate build; this flag supports the declared Node minimum. Real Linux microphone access cannot be tested in this sandbox: Electron cannot launch and PipeWire/PulseAudio IPC is restricted. The root cause of the reported Linux failure remains unconfirmed until the updated client supplies its exception name or the user reproduces it with system audio diagnostics.

Manual check: restart the Linux desktop with `npm start`, choose Settings → Voice & video → Input device → System default, and use Allow microphone & refresh devices before joining a call. Confirm successful capture, test explicit input selection across a relaunch, and verify permission denial remains denied. Browser clients need HTTPS or localhost for microphone APIs; ordinary HTTP on another machine's LAN/public IP is not a secure context.

## One-way voice investigation and client fixes

The reported setup still had one-way audio with current builds, default devices and mute/deafen/PTT disabled. The changes below address identified client weaknesses; they do not establish the cause of that particular live failure.

Peer signaling now assigns the initial offer to the joining peer. Responders first apply the incoming offer, reuse its audio/video transceivers, attach local tracks, and only then answer. Incoming descriptions/candidates are processed serially so an offer cannot be mistaken for glare while a previous answer is still being applied. Polite peers rely on WebRTC's implicit rollback for genuine colliding offers; impolite peers discard the colliding offer and its candidates. Candidates wait for a remote description. Closing a peer prevents queued work from emitting more signaling. The video sender is retained directly instead of selecting a potentially different transceiver later. Tests cover these state transitions with fake peers; they are not a real-browser transport test.

Each participant tile now has a persistent audio element and a separate always-muted video element. Camera/screen-track changes only change video membership, and preview audio is never played back. Blocked/rejected audio playback displays a visible Play audio button, rather than requiring a click on an invisible video. Participant volume is visible without hovering. Missing saved output devices fall back to System default and reset the saved preference after success; denied routing does not bypass permission checks. Electron permits speaker-selection only for its existing trusted UI origin. Pending playback/output work is canceled or ignored after cleanup/changes.

Call details is opt-in and polls local WebRTC stats once a second only while open. For each peer it shows connection/ICE state, audio transceiver direction, sent/received audio packets and input/incoming audio levels when supplied by the browser. No SDP, IP addresses, credentials, recordings or stats are uploaded. Packet counts can increase for silence, so these counters are diagnostic evidence, not a claim that speech is present. Browser-unavailable stats display unavailable. Closing the panel/call stops polling.

Manual validation: update both clients (Linux npm start; rebuild/re-download the Windows portable client), join the same voice channel, speak in both directions, and test both joining orders/rejoining. Repeat camera/screen toggles without interrupting voice. If one-way audio remains, compare Call details on both peers while speaking: no received packets indicates missing transport/negotiated media; received packets with a zero incoming level may indicate a silent/muted source; received packets and speech levels with no audible output point toward playback, participant volume or system routing. A failed ICE path may still need TURN; STUN-only connectivity is not guaranteed. Confirm autoplay rejection recovery and stale output-device recovery on actual platforms.

Validation: type checking/production build and 27 unit tests pass, including ten added voice tests for negotiation races, early ICE, canceled/rejected signaling, output routing and separation of audio from video changes. Hardware capture/playback and two real remote clients remain unverified because this sandbox cannot launch Electron or use audio/network services.

## Visual microphone input meter

Voice & video settings now includes a Microphone level card immediately below the input selector. Start microphone test opts into live analysis; Stop ends it. The segmented bar maps RMS input from -60 to 0 dBFS onto 0–100%, labels the current dBFS reading, and provides text for input detected, no input, muted, paused and near-full-scale/clipping. It measures sound amplitude, not speech recognition or network delivery. RMS >= 0.003 marks input activity and absolute sample peak >= 0.98 marks a potentially clipping signal. Audio processing follows the selected noise/echo/AGC preference, so this is post-browser-capture processing rather than a calibrated hardware sound-pressure measurement.

A Web Audio MediaStream source connects only to an AnalyserNode (2048 samples), never speakers. Analysis samples at most every 80 ms while the settings test is active. A suspended context shows Resume meter so a user gesture can resume analysis. The monitor records/uploads nothing. Outside a call, it acquires the selected input through the shared microphone helper and owns/stops that test stream. During a call, it borrows the call's existing microphone and respects its mute/deafen/PTT track state. Stopping/closing the meter never stops or enables a borrowed call track. Input settings changed during a call still take effect on rejoin, as the card explains.

Closing settings, switching settings tabs, stopping the test or changing the selected input/noise preference cleans up animation callbacks, analysis nodes and its AudioContext. Late permission/capture results after cancellation have their owned tracks immediately stopped. Disconnecting a microphone stops analysis and displays guidance. Changes to input/noise automatically restart an already-enabled test; tests never start merely by opening settings.

Nine meter tests verify known-wave RMS/dBFS math, silence, clipping/non-finite samples, owned versus borrowed capture cleanup, late permission responses, denied capture, suspended/muted readings and disconnect/fallback behavior. Type check and production build pass. Actual microphone UI, hardware levels and Electron rendering remain unverified in the restricted environment; manual acceptance is to start the test, speak and observe the bars, change inputs, stop/close and confirm capture release, then repeat during a call and confirm call audio continues after stopping the meter. On Windows, rebuild/re-download the portable EXE; Linux source users restart npm start. The app version remains 0.1.3.

## Expanded screen-share and camera viewer

Tiles with an active video expose an Expand video button and video double-click action. The viewer is portaled to document.body so call-panel height/overflow constraints do not clip it. A muted video element displays the same existing video-only MediaStream at app-window size with object-fit contain. The underlying tile and its dedicated audio element stay mounted; the viewer never creates another peer, audio output element, capture stream or network subscription. Participant volume operates on the original tile's state, and blocked audio can be resumed from the viewer.

Full screen uses the standard user-gesture Fullscreen API; Electron's existing trusted-origin permission handlers now also allow fullscreen. A denied/unsupported native full-screen request leaves the large app-window viewer usable. Close/Return to call returns focus to the opener. Escape exits native full screen first or closes the viewer when not in native full screen; Tab navigation is contained within viewer controls. Video loss/peer departure closes or unmounts the viewer. Cleanup pauses/detaches only the extra video element and exits full screen when appropriate; it never stops shared tracks. A separate state reference for the visible video stream keeps a local preview updated when camera/screen source changes.

No signaling/schema/version changes are required; the app remains 0.1.3. Type check, production build and the existing 36 unit tests pass. Real Electron/browser fullscreen, resizing and remote media remain unverified in the restricted environment. Manual acceptance: expand a remote share and local preview, inspect aspect-ratio preservation at different window sizes, enter/exit native full screen, use Escape/keyboard navigation, change participant volume, stop the share or leave the call while expanded, and confirm voice continues without duplication after closing the viewer.

## Screen-share transport, subscriptions, and separate volume

Media protocol 2 reserves voice audio, video and system-audio transceivers in that order. createPeerMedia reuses offered transceivers on responders, classifies received audio by its transceiver rather than arrival order, and serializes prepare/sync operations. Outgoing voice always uses the raw microphone. The former mono Web Audio mixer and its tests were removed; src/shareAudio.ts no longer exists. Camera/screen share the video transceiver. Stream audio is a dedicated capture track, with its browser-native channel layout; explicit stereo encoder tuning is not implemented.

Screen capture still requests system sound with echo cancellation/noise suppression/automatic gain disabled and restrictOwnAudio requesting exclusion of the app's playback. Windows loopback consent/picker behavior is unchanged. Platform capture limitations still apply; receiving from Windows works through the usual peer transport, while Linux desktop system capture remains unsupported.

All signal payloads carry version:2 and local media availability {sharing,camera,shareId}. Each new capture gets a random shareId; each peer's outgoing subscription starts false and is reset at every capture start. A received {watch:{shareId,enabled,revision}} is accepted only for the current local share and an increasing safe-integer revision. The sender's own incoming watching state and its remote viewer's outgoing wantsStream state are separate, allowing simultaneous bidirectional shares and independently selected viewers. Stale messages from previous shares cannot activate another capture. Older media clients are rejected with an upgrade notice so mixed audio or automatic screen delivery cannot bypass the new controls. All participants must update.

createPeerMedia attaches screen video/system sound only when that specific peer requests them. Otherwise both senders stay null; the user does not receive that screen payload in the background. Stop watching sends a new revision and detaches both senders with replaceTrack(null); acknowledgement occurs only after the serialized replacements complete and only for the still-current revision/share. UI hides video and detaches system-audio playback immediately, showing Stopping stream until confirmation. Already transmitted packets can finish arriving; voice and ICE/RTCP/control traffic remain. Pending subscription requests time out after ten seconds and close that peer's media connection if unconfirmed. A sender replacement failure also closes its connection. This fail-closed behavior may require rejoining voice after an error, and prevents an indefinitely unconfirmed stream subscription. Other peers are unaffected. Actual packet behavior still needs a live call test; test doubles prove sender attachment state, not network traffic.

Per-peer video and system-audio receivers are gated locally as a secondary safeguard; local gating alone is not the bandwidth mechanism. Incoming audio is classified into voice and system MediaStreams. Each AudioPlayback owns its audio element, output selection, autoplay error/retry and volume. MediaTile uses a stable voice-only stream across watch toggles so stopping screen playback does not restart microphone playback. Source/track changes handle delayed ontrack events as well as initial negotiation. Stream sound is mounted only while subscribed. Deafen gates both outputs; microphone mute/PTT gates only outbound voice. ExpandedVideo stays muted and forwards both volume controls/Stop watching to the underlying tile without adding duplicate audio. Sliders remain local to each tile and reset on peer reconnection.

Call details now reports voice packet/input statistics separately from cumulative video/system-audio RTP byte counters (camera contributes to video counters while active). For a bandwidth acceptance test, let a sender play moving video with sound; keep a viewer unsubscribed and verify no incoming video/program bytes. Subscribe, verify both increase, then Stop watching and wait for confirmation/in-flight traffic to settle; those counters should stop while voice packets continue. Repeat with two viewers and two simultaneous streamers, ensuring one viewer's unsubscribe affects only its connection. Also test screen restart/new generation, joining mid-share, camera restoration, stream without system audio, output-device change, mute/deafen and independent sliders, including the expanded viewer.

Nine peer-media tests cover initial null stream senders, independent viewers, offered-slot reuse/classification, queued start/stop ordering, stale watch validation, camera restoration/voice preservation, audio-track independence, queued-operation cleanup, and metadata validation. Existing signaling-race tests remain. Real Electron/WebRTC/RTP and platform playback are unverified in the restricted environment.

## Profiles, previews, emojis, device persistence, and private calls

Client image upload uses createImageBitmap and canvas to decode, fit without upscaling, and re-encode as PNG (512 px avatars, 128 px emojis). This strips original metadata and animation without adding a native image-processing dependency. The server independently checks the PNG signature/IHDR dimensions and byte cap (1.5 MB), rejecting out-of-bounds uploads; it does not decode/re-encode images itself. Source upload limit is 10 MB. Add a hardened server decoder if accepting arbitrary third-party upload clients. New idempotent avatars/emojis tables avoid altering existing schema columns. All image asset endpoints require bearer authentication; image versions change when profiles update.

AuthImage fetches with an Authorization header and displays a blob URL, aborting requests and revoking URLs on cleanup. Credentials are never put in image query strings. Only raster MIME types are displayed. Attachment MIME is sniffed from bytes on storage and again on inline retrieval, allowing old binary-MIME records to preview. Unknown/SVG/HTML files retain binary download behavior. GIF attachment bytes are unchanged. ChatContent renders escaped text, safe HTTP(S) links and custom :name: tokens. Electron opens allowed external links in the system browser; it never navigates the trusted app window to message links.

shared/emojis.js supplies the server/client catalog of over 200 standard emojis. Server-side reactions accept only catalog entries or existing custom shortcodes. Custom emoji uploads require send, with limits of 200 per server and 50 per author. Authors/managers may delete them; deletion removes their reactions and broadcasts updated affected messages through conversation-authorized routing. Existing text tokens for deleted emojis render literally. Both reaction buttons and counts toggle per message/user/emoji, preserving existing schema uniqueness.

Device preferences now retain IDs and labels, including during temporary fallback. listenRendererServer retries the saved rendererPort, falling back to a free port only when occupied; it persists the chosen port so the app origin stays stable across ordinary restarts. Unique non-default device labels recover changed IDs; duplicate labels are deliberately not guessed. Microphone recovery probes default to obtain enumeration labels, then opens the matched saved input and stops the probe. Output routing similarly resolves a saved label before setSinkId. Missing choices remain visible in settings instead of silently displaying the default option. The first upgrade can require reselecting a device if old IDs have expired and no label was recorded. A stable URL plus label recovery is a mitigation; OS device-ID/permission behavior still needs actual relaunch checks.

useSpeaking borrows the raw call microphone through createMicrophoneMonitor, samples at about 80 ms, and holds the activity outline for 250 ms after detected input. It never opens another microphone or monitors the mixed system-audio track. Small boolean activity hints are sent on changes and every second while active; the server rate-limits and relays only within the current call. Receivers expire stale hints after 2.5 seconds. Green outlines decorate call tiles and voice-channel avatars. These are user-reported activity hints for presentation, not trusted evidence or recordings. Mute/deafen/PTT gates the raw track and therefore the indicator. Analysis cleanup does not stop borrowed tracks.

Private calls are in-memory invite-only rooms named private:<UUID>. Creation requires voice permission and an online accepted friend; every added invite also checks accepted friendship, target voice permission and the eight-member limit. A participant can invite their own accepted friends; outsiders cannot view the room/roster, join, invite or signal into it. The existing same-room signaling check and one-active-device rule apply. Invited users must explicitly join; no microphone is opened by receiving an invitation. Invite timestamps expire after two minutes, with 15-second housekeeping. Calls vanish when empty after starting (or expire before starting); accepted participants can rejoin while someone remains. Initial calls have a per-pair cooldown and per-creator pending-room cap. Decline removes access; changing voice permissions revokes active calls. Server restart discards calls and invitations. E2EE/peer identity properties are unchanged.

Drag/drop and the file picker share validateFileSelection from shared/uploads.js. Both queue File objects for review in the composer, with individual removal, a ten-file cap and a 5 MB combined limit. Drops into read-only conversations or during an upload do not queue files. The chat area exposes a file-only overlay; root handlers prevent dropped files from navigating the app. Drag counters reset on drop/end and conversation changes. The send path reads the selected batch, targets the captured conversation, and submits attachments[]; the server still accepts legacy attachment. All payloads validate before insertion and message/attachment writes are atomic. Preview/download authorization is unchanged. Live drag/drop, including OS file-manager behavior and nested targets, still needs manual desktop testing.

New files: shared/uploads.js and declarations, server/images.js, shared/emojis.js and declarations, src/images.ts, src/devices.ts, src/ChatContent.tsx, src/messageText.ts, src/useSpeaking.ts, test/features.test.js, test/app.test.js. Docker copies shared into both build and runtime stages. No additional packages were installed. The implementation uses separate microphone/system-audio senders and the existing mesh/eight-person transport; the subscription section above describes the current transport.

Validation: 59 passing checks in npm run test:unit, including seven in-process request-handler/private-call checks (the parent test plus six subtests), device persistence/port fallback, changed-ID microphone recovery, resize geometry, image bounds, link tokenization, channel names and emoji catalog. Request-handler tests run real Express/SQLite without TCP; fake Socket.IO endpoints verify invitation/roster/activity authorization without asserting real transport. npm run check and npm run build pass. npm test still cannot complete here because the older real-socket integration suite gets listen EPERM. Live Electron relaunch/device routing, drag-and-drop, avatar resizing/rendering, animated GIF rendering, external browser launch, speaking outlines and real private/group media calls remain manual acceptance work.

Upgrade: restart the backend, update/rebuild clients, and choose devices once if necessary. Test two app sessions, profile replacement/removal, GIF preview and DM isolation, custom emoji send/react/delete, capitalized voice names, caller/callee accept/decline and a third invited participant, outsider rejection, mute/PTT indicators during system-audio sharing, and last-member cleanup. No new ports are required. Current version: 0.1.3.

## Validation record

Verified after application dependencies became available:

- Actual `npm run check`: passes, including Vite/CSS and preload declarations.
- Actual `npm run build`: passes with installed Vite 8.3.4/React 19.3.1.
- `npm run test:unit`: 70 checks pass (four security, two SQLite/schema-migration, six desktop, nine microphone, ten voice/signaling, fourteen microphone-meter, eight feature helpers, eight in-process server checks including the parent test, and nine peer-media checks).
- JavaScript syntax checks on server, desktop, packaging config and tests.
- Portable build command reaches the packaging step after successful check/build, then fails with EAI_AGAIN resolving registry.npmjs.org for electron-builder. No Windows executable artifact was generated.

The integration suite is present but cannot run in this sandbox: binding its temporary HTTP server fails with listen EPERM on 127.0.0.1. Full npm test therefore does not pass here. Unlike the earlier source-only validation, the renderer's real production build/type check now pass; the old dependency-install blocker applies specifically to the newly required packaging tool.

Still outstanding: portable packaging/Windows-runner execution, Electron UI launch, Windows portable launch/relaunch/EXE replacement/profile retention, actual OS encryption, real-client integration, Docker, hardware voice/video/screen capture, eight-person load, internet NAT/TURN behavior and accessibility/platform validation. These must not be reported as passed until exercised.

## Expanded chat image viewer

Chat attachment AuthImage instances opt into expandable mode. Loaded previews become keyboard-accessible buttons that open ExpandedImage through a document.body portal, outside chat scroll/overflow constraints. Profile pictures and custom emoji images retain their existing behavior. The viewer reuses the already-authorized blob URL, so it needs no additional request, query-string credential or server change; GIF bytes/animation are preserved. Images fit the app window with object-fit contain and can enter native full screen via the toolbar or double-click. Escape exits full screen before closing; Close, Return to chat or the backdrop dismiss the viewer. Focus is trapped in the viewer and restored to the opener when available. Closing does not revoke the thumbnail URL; AuthImage remains its owner and revokes it on asset change/unmount, which also closes the viewer.

Version remains 0.1.3. Type check and production build pass. Actual desktop image enlargement, GIF animation, focus navigation and native full screen remain unverified here. Manual acceptance: open a landscape/portrait image and GIF, resize the app, enter/exit full screen, close with the button/Escape, open with Enter, and delete the owning message or change conversations while viewing to confirm cleanup.

## Microphone meter startup and channel-analysis reliability

The meter previously created/resumed its AudioContext in a passive React effect. That makes startup depend on browser activation/autoplay state; it is a plausible source of intermittent paused analysis, not a confirmed reproduction of the reported hardware symptom. MicrophoneMeter now creates and resumes the context synchronously in Start microphone test's click handler, before capture/effects await. While a test is active, the component owns that context across selected-device/noise changes and each monitor owns only its graph and standalone capture. A supplied context is never closed by createMicrophoneMonitor; Stop, unmount or failure closes it from the component. Analysis startup errors are distinguished from microphone permission/capture errors. Resume meter still invokes resume from a user gesture.

AnalyserNode's time-domain data is downmixed to mono; opposite-polarity stereo channels can cancel in the old measurement. Multi-channel input now passes through a ChannelSplitterNode and per-channel analysers (up to eight), using the strongest channel's RMS/dBFS and clipping across channels. Mono remains direct-source analysis. Outputs remain unconnected, which Web Audio allows for AnalyserNode; there is no audible microphone monitoring. Unknown channel count uses a two-channel splitter to cover ordinary mono/stereo capture. The same helper serves speaking indicators, so their channel measurement also improves.

During calls the meter still borrows the actual call input and respects mute/deafen/PTT; changing settings does not change an active call's capture. The UI now identifies that microphone and clearly explains rejoining to apply another selection. Muted-device, gated-call, paused-analysis and silent-input states are separate. Standalone tests never enable/stop borrowed call tracks.

Five added regression tests cover shared-context replacement and failure ownership, late cancellation on a reused context, opposite-polarity stereo and right-channel-only input. All 64 non-network checks, type checking and production build pass. Tests use controlled graph doubles, not real browser PCM or user-activation enforcement. Actual Linux/Windows microphone access, switching hardware and restart/Resume meter behavior need manual validation. Check the meter outside a call first (Start test, speak, switch inputs repeatedly, Stop/Start), then repeat in a call with mute/PTT states and the correct displayed device. Version remains 0.1.3.

## Numeric message metadata rendering

SQLite represents pinned as 0/1. Message metadata must convert numeric flags to booleans before JSX conditional rendering; otherwise React renders the false-side numeric 0 next to the timestamp. Pin and edited indicators now use Boolean guards. Version remains 0.1.3. Type check and production build pass.

## Permanent usernames and editable nicknames

The additive profiles table stores one nickname per user. Idempotent startup backfills missing rows from existing usernames and preserves changed nicknames. Registration still asks only for username/password, inserts the same nickname, and returns both fields. A binary-comparison BEFORE UPDATE trigger prevents username changes, including changes of case. PATCH /api/profile accepts only nickname, trims it, rejects blank/over-32-character/control-character values, updates the authenticated account, and broadcasts refresh. Other accounts cannot be selected through the route. No username-edit endpoint exists. Nicknames need not be unique.

The nickname-first displayName helper is used for chat authors, avatars, friends/DMs, voice members, call titles/controls, member roles, typing notices and notifications. Friend acceptance/lookup and login continue using the account username. Settings shows a read-only username and editable nickname. Identity tooltips/friend rows also expose @username to distinguish duplicate nicknames. Older messages resolve the author's current nickname, matching the existing user-ID-based author model. A profile update does not reconnect the call or change account identifiers.

Schema tests exercise legacy backfill, restart preservation and immutable/case-sensitive username rejection. Request-handler tests cover defaults, nickname-only updates, caller isolation, invalid values, immutable username attempts, and login by the original username after display-name changes. Display-name fallback has a helper test. Current type check, production build and all 70 non-network checks pass. Live multi-client nickname refresh, watch/stop bandwidth behavior and independent audio/output playback still need testing. Update the backend and all clients; no dependency or extra port changes. Version remains 0.1.3.
