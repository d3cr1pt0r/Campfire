# Driskord

An English-only, self-hosted community chat app with an Electron desktop client and a reusable React browser interface. See [REWORK.md](REWORK.md) for architecture, upgrade instructions, storage quotas, and validation scope. This is an initial implementation, not Discord feature parity or a production-audited release.

## Run the desktop app

Install Node.js 24 LTS and npm, then:

```bash
npm install
npm start
```

`npm start` builds the renderer and opens Electron. Enter your shared community server's address on the sign-up/sign-in screen (for a server running on the same PC, use `http://localhost:3001`). Desktop clients do not start community servers or create local community accounts. Each shared server has separate accounts. **The first registered account becomes the owner**, so register yours before making a new server public.

Electron uses a temporary localhost port solely to serve its interface. That port is not a community server address and should not be shared. Desktop sessions and preferences persist independently of that port, under Electron's user-data directory. On Windows they use Electron safeStorage/DPAPI encryption; platforms without OS encryption support fall back to a file protected by user filesystem permissions.

## Host a server

```bash
npm install
npm run build
npm run server
```

The server listens on port **3001**, serves the built browser client, and stores its SQLite database in `data/`. Open `http://localhost:3001` or connect from Electron using the server's address. Other users register accounts on that same address. The copy-address button in the member sidebar shares this address; there are no expiring invite codes.

For renderer development, run `npm run server` and `npm run dev` in separate terminals, then open `http://localhost:5173`. Changes to server code require a server restart.

Configuration is documented in [.env.example](.env.example). `npm run server` loads a local `.env` when present; exported shell variables take precedence. To load it explicitly, run:

```bash
node --env-file=.env server/index.js
```

### Internet hosting

Put the server behind an **HTTPS reverse proxy** with WebSocket forwarding. Microphone, camera, and screen capture require a secure browser context (HTTPS or localhost). Set `CLIENT_ORIGINS` for any separately served web client. Electron's localhost client origins are allowed automatically. The proxy must preserve the external `Host` and `Origin`; include the external HTTPS origin in `CLIENT_ORIGINS` when TLS is terminated upstream.

Configure your own STUN/TURN infrastructure using `ICE_SERVERS`, for example:

```bash
ICE_SERVERS='[{"urls":"stun:turn.example.com:3478"},{"urls":"turn:turn.example.com:3478","username":"replace-me","credential":"replace-me"}]' npm run server
```

These are placeholders, not a working public relay. Credentials configured this way are visible to authenticated clients; use a private deployment initially and plan short-lived TURN credentials for wider distribution. Without a reachable STUN/TURN service, calls can work on a LAN but may fail across NAT/firewalls. All media is peer-to-peer, with up to eight participants per voice channel. No third-party ICE service is silently used.

### STUN-only call test

For this checkout, the ignored local `.env` configures Google's public STUN endpoint:

```dotenv
ICE_SERVERS='[{"urls":"stun:stun.l.google.com:19302"}]'
```

Stop the running server with Ctrl+C and restart with `npm run server`. Close and reopen every desktop client so it fetches the new ICE configuration. No client rebuild or additional inbound router port forwarding is required for STUN. Clients need outbound access to the STUN endpoint over UDP port 19302. This uses a third-party address-discovery service; it does not relay call media.

For a one-process test without a `.env`, use:

```bash
ICE_SERVERS='[{"urls":"stun:stun.l.google.com:19302"}]' npm run server
```

Test two participants on different home networks in the same voice channel. Confirm audio in both directions for at least one minute, then test camera video and screen sharing separately. If a call fails, each participant can test `stun:stun.l.google.com:19302` with the [WebRTC Trickle ICE sample](https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/): an `srflx` candidate confirms STUN address discovery, but does not prove peers can connect directly. Missing `srflx` candidates suggest a STUN reachability issue; successful discovery with failed calls requires checking ICE/signaling and possibly adding TURN.

The local `.env` is ignored by Git. On another server, add the setting explicitly. To disable this test, set `ICE_SERVERS=[]` and restart the server and clients. The default remains empty when no setting is supplied.

### Container hosting

Or build the supplied container:

```bash
docker compose up --build -d
```

Compose mounts a persistent volume at `/data`. Set `CLIENT_ORIGINS` and `ICE_SERVERS` in your shell or Compose `.env`. The Docker image serves the web client and server; it does not launch Electron. Build tooling and Electron desktop packages are excluded from the final image.

Back up the database using SQLite's backup mechanism, or stop the service and copy the entire data directory (including WAL files). The desktop client stores its connection/preferences in `client-state.dat` under Electron's platform-specific user-data directory. Any `server/` directory left by earlier prototype versions is retained but no longer used by the desktop client.

## Distribute a Windows portable executable

The repository builds a **64-bit Windows portable executable**. Friends download the single `.exe` and launch it directly; no installation, shortcuts, administrator access, Node.js, or local community server setup is needed. This is an unsigned private-beta build with manual updates, not a signed/public release.

### Build from Windows (PowerShell)

On the build machine, install Node.js 24 LTS, open this project, and run:

```powershell
npm install
npm run dist:win
```

The command type-checks and builds the interface, then downloads/runs the pinned `electron-builder@26.0.12` tool and its packaging dependencies. It needs internet access. Application dependencies remain controlled by `package-lock.json`; this packaging tool is fetched on demand rather than added to the app's dependency tree.

Expected output for version 0.1.4:

```text
release/Driskord-0.1.4-x64-Portable.exe
```

Send **that executable plus your shared server's HTTPS URL** to friends. They launch it, enter the server address, and create an account on your server. Your standalone server must remain running and reachable. To update, close Driskord and replace the old executable with the new one.

Portable means no installation: Electron's runtime is extracted to a temporary directory when launched, and settings/sign-in still live in the Windows user's AppData profile. They are not stored alongside the EXE, so copying it to another PC does not carry a signed-in session. Deleting the EXE leaves those local settings in place.

Optionally prefill your public server address at build time:

```powershell
$env:VITE_DEFAULT_SERVER_URL = "https://chat.example.com"
npm run dist:win
```

The address is public build configuration, not a secret, and remains editable in the sign-in form. Without it, desktop clients ask for a server address. Previously saved connections take precedence.

### Build from Linux using GitHub Actions

1. Put this project, including `package-lock.json` and `.github/workflows/windows.yml`, in your own GitHub repository.
2. Open **Actions → Windows portable executable → Run workflow**. Optionally enter your public server URL.
3. After a successful run, download the **Driskord-Windows-x64-Portable** artifact and unzip it.
4. Send the contained `Driskord-…-x64-Portable.exe` to friends along with your server URL.

The workflow uses a Windows runner, installs locked dependencies, runs type checking and tests, builds the portable executable, and retains the artifact for 14 days. It does not publish a release or upload to an app store. No GitHub repository has been created or workflow run by this implementation.

The executable is not code-signed, so Windows may show an unknown-publisher/SmartScreen warning. Signing certificates and a signing workflow are future work. Test launching the EXE, sign-in, microphone/camera, screen capture, relaunch and replacing the EXE for an update on a real Windows PC before giving the build to your group. The current target is Windows x64; ARM64-native builds are not configured.

## Distribute a Linux standalone build

Build on a Linux x64 machine with Node.js 24 LTS:

```bash
npm ci
npm run dist:linux
```

This runs the type check, builds the interface, and packages two standalone clients with the same pinned electron-builder version used for Windows. With npm 12 or later, its default Git-dependency restriction may reject electron-builder’s pinned `@electron/node-gyp` dependency; use `npm run dist:linux --allow-git=all` to allow it for this invocation only.

Outputs for version 0.1.4:

```text
release/Driskord-0.1.4-linux-x86_64.AppImage
release/Driskord-0.1.4-linux-x64.tar.gz
```

Both include Electron; users do not need Node.js or a local server. AppImage names the x64 architecture `x86_64`. Send the AppImage and your shared server URL. After downloading, make it executable and launch it:

```bash
chmod +x Driskord-0.1.4-linux-x86_64.AppImage
./Driskord-0.1.4-linux-x86_64.AppImage
```

If the distribution lacks working FUSE support, use the archive instead:

```bash
tar -xzf Driskord-0.1.4-linux-x64.tar.gz
cd Driskord-0.1.4-linux-x64
./driskord
```

Keep all extracted files together. Alternatively, AppImage supports `./Driskord-0.1.4-linux-x86_64.AppImage --appimage-extract-and-run` without FUSE; this extracts the runtime on each launch. See the [AppImage FUSE guide](https://docs.appimage.org/user-guide/troubleshooting/fuse.html).

Settings and sign-in remain in Electron's user-data directory (normally `~/.config/Driskord`, or under `XDG_CONFIG_HOME`). To update, close Driskord and replace the AppImage or the entire extracted archive directory. The server remains separate and must be reachable. Builds target Linux x64 with desktop libraries supported by Electron; they are not universal binaries for ARM or every Linux distribution. Screen capture and device permissions depend on the desktop session and available portals. No sandbox-disabling flags are included in the launch commands.

To prefill your public server URL, build with `VITE_DEFAULT_SERVER_URL=https://chat.example.com npm run dist:linux`. Saved connections take precedence, and the address remains editable.

For a hosted build, open **Actions → Linux standalone builds → Run workflow**, optionally set the server URL, and download **Driskord-Linux-x64-Standalone** after it finishes. The workflow runs checks and tests and retains both packages for 14 days; it does not publish a release automatically.

## Implemented scope

- In-app registration/sign-in, salted password hashes, expiring sessions, and server-local accounts.
- Persistent text channels and DMs, friend requests/acceptance/removal, presence, and live messages.
- Files up to 5 MB with authenticated downloads.
- Own-message editing/deletion, over 200 standard emojis and custom emoji reactions, typing indicators, session unread badges, search, and manager-pinned messages.
- Voice channels with microphone mute/deafen, webcam video and local preview, screen/window sharing, per-person Watch/Stop watching controls, and separate voice/stream volume.
- Focused-app push-to-talk with Space, browser noise suppression/echo cancellation, and call sounds.
- Role creation/editing, colors, chat/voice/management permissions, owner-only role assignment, and server naming.
- Channel renaming/deletion with permanent text/voice anchors, per-role text access (full/read-only/hidden), and voice visibility.
- Avatar positioning with drag, zoom, sliders and a fit-whole-image option.
- Settings for notifications, audio input/output, and 360p/720p/1080p requested streaming resolution.

History starts with the latest 100 messages and automatically fetches older pages as you scroll upward. Only nearby message rows are rendered; **Jump to latest** returns to the newest messages, and incoming messages do not pull you away from older history. Search and pinned views query the full conversation and paginate results. Unread counts are session-local. Screen sharing replaces the outgoing camera track and restores it when sharing stops. Windows desktop sharing supports system audio; see below for platform limitations. Settings affecting device capture apply on the next call/video start. Output-device support and capture picker behavior depend on the OS. Push-to-talk works while the app has focus and the cursor is outside an input field; it is not a system-wide hotkey.

Moderation/ban UI, custom server icons, saved multi-server sessions, threads, bots, password recovery, mobile clients, code-signed desktop releases, auto-updates, and a large-call media server are future work. Message text supports clickable HTTP(S) links and custom emoji tokens, with no HTML or Markdown execution. DMs are access-controlled on the server; they are **not end-to-end encrypted** against the server owner. WebRTC encrypts media transport, and TURN can relay that media.

## Channel management and access

Open **Settings → Channels & access**, or use the settings icon beside the channel categories. Managers can rename channels and delete additional channels after confirming. Each server keeps one permanent text channel and one permanent voice channel; these can be renamed but not deleted. Existing servers protect `general` and `lounge` when present, otherwise an existing channel of each type. Deleted channels stay deleted after restart. Deleting a text channel removes its messages and attachments; deleting a voice channel disconnects its participants.

Access is configured per role (group) and per channel:

| Text channel | Behavior |
| --- | --- |
| Full access | View and write, subject to the role's global permissions and message ownership |
| Read only | View messages, reactions, pins and downloads; no posting, reacting, editing, deleting or pinning |
| Hidden | No channel listing, history, downloads, typing notices or message events |

Voice channels are **Visible** or **Hidden**. A role also needs the global voice permission to see/join them. Hidden voice channels do not expose participant rosters or signaling. Revoking voice access disconnects active participants. Private friend calls retain their separate invitation rules.

The owner always retains full access. Managers can configure channels they can see; management permission does not bypass a channel's read-only restrictions. Missing per-role overrides default to full access for compatibility, including newly created roles. Global send/voice permissions remain an upper limit. The minimum-channel rule applies to the server; a role may have every channel hidden.

Back up the database, restart the updated backend for migration 3, then update/rebuild desktop clients. Existing channel names and histories are preserved. The new schema requires restoring the backup when rolling back to older server code.

## Position a profile picture

Under **Settings → My account**, choose **Upload profile picture**. Drag the preview or use horizontal/vertical position and zoom sliders, then choose **Save picture**. **Center crop** fills the avatar; **Fit whole image** keeps the entire photo with background space where necessary. Cancel leaves your existing avatar unchanged. **Adjust current picture** reopens the saved picture for positioning; upload the original again to recover areas removed by an earlier crop. Saved avatars are 512 × 512 PNGs and use the chosen composition in chat, member lists and calls.

## Microphone troubleshooting

In **Settings → Voice & video**, choose an input and click **Start microphone test**. Speak to see live level bars, a dBFS reading and input-detected/muted/clipping status. Start microphone test activates audio analysis directly from your click, and switching inputs during a test reuses that context. Stereo input channels are measured separately so opposite-polarity channels do not cancel the visualization. If Meter paused appears, click Resume meter. Click **Stop microphone test** when finished; closing the settings tab also stops the meter. During a call, it shows the actual call microphone name and measures that existing input without opening another device or bypassing mute/deafen/push-to-talk. Rejoin the call to apply a changed input selection; a muted call input is reported explicitly. The meter indicates local input, not whether a friend receives your audio.

If voice join fails before connecting, select **Settings → Voice & video → Input device → System default**, then click **Allow microphone & refresh devices**. The client reports the native error name even when the browser supplies no error text. An expired/disconnected saved input is retried once with System default and the saved preference is reset only when that succeeds.

On Linux, `NotReadableError` suggests checking your active audio service and input routing; `NotFoundError` means no suitable microphone was available; `NotAllowedError` means permission was denied. You can inspect your current system audio session from a normal terminal with `wpctl status` (PipeWire) or `pactl info` / `pactl list short sources` (PulseAudio-compatible server). Check the microphone in your system sound settings and avoid launching the app with sudo. These checks concern local capture, not STUN ports.

For browser clients, microphone capture requires HTTPS or localhost. For the Linux Electron client, run `npm start` after updating; packaged clients need a rebuilt package to receive these client-side fixes.

## One-way audio troubleshooting

Update both clients before testing these client-side voice fixes. On Linux restart with `npm start`; Windows users need a new portable build from GitHub Actions. Remote audio now plays separately from the always-muted video preview. If playback is blocked, click **Play audio** on the participant tile. Ensure the Voice volume slider is above zero; Stream volume affects shared system sound independently.

If audio remains one-way, open **Call details** on both clients and speak in turn. Note the connection/ICE state, audio direction, sent/received packet counts and input/incoming audio levels. Counts that increase with no incoming speech level can still represent silence. Increasing received packets and a visible incoming speech level with no audible sound suggest playback/output routing; no received packets or an inactive audio direction require transport/negotiation investigation. Share both sets of values rather than assuming every failure requires TURN. STUN cannot guarantee a direct path on every network.

## Enlarge a screen share or camera video

Click the **expand icon** in the top-right corner of a video tile, or double-click the tile's video, to open a large viewer. It fits the entire picture inside the app window without cropping. The viewer's **Full screen** button (or double-clicking its video) switches to native full screen. Use **Return to call**, the close button, or Escape to return; when native full screen is active, Escape exits full screen first.

Voice and Stream volume controls and a blocked-audio Play audio control remain available in the expanded viewer. Stop watching is also available there for screen shares. Voice continues through the original audio element, so opening/closing the viewer does not create duplicate audio or disconnect the call. This works for received screen shares, cameras and your own video preview. Update/restart the client or rebuild the Windows portable EXE to receive the feature.

## Share system audio

Rebuild/download the updated Windows portable EXE, join a voice channel, and start screen sharing. Leave **Share system audio** checked in the source picker. This captures audio from all applications even when sharing one window. The capture requests exclusion of Driskord's own playback to avoid sending the call back to participants; verify this on the actual Windows build. Use headphones during the first test.

Microphone mute and push-to-talk affect only your voice. Microphone and system sound use separate audio tracks and per-person Voice/Stream sliders, including in the large viewer. Deafen silences both; both follow the selected output device. Shared sound is delivered only to people watching your share. Stopping sharing removes system audio and restores your camera while voice continues. Stereo encoding remains browser-dependent.

Linux clients can listen to a Windows friend's shared audio. Capturing system audio from Linux desktop sharing is not implemented. Browser/native picker audio depends on the platform and selected source; enable its audio option when available. If capture provides no audio track, the app reports that it is sharing video only. No server changes or additional port forwarding are needed. Live Windows-to-Linux system audio still needs testing.

## Choose which screen shares to receive

Joining a call does not subscribe you to screen shares. Each streamer has a **Watch stream** button. You can watch any combination of people independently. **Stop watching** unsubscribes from that person's screen video and system audio while their microphone stays connected. Closing the enlarged viewer returns to the small tile; use Stop watching to unsubscribe.

Subscriptions control the sender's actual WebRTC tracks: a non-subscriber has no screen video or system-audio track attached to their outgoing connection. On unsubscribe, the sender detaches both tracks and acknowledges completion. The UI shows **Stopping stream…** until confirmed; previously sent packets can finish arriving during that transition. Small signaling/connection-maintenance traffic and voice continue. A missing confirmation closes that peer connection after ten seconds rather than leaving an unconfirmed subscription running. Other viewers remain subscribed.

Every new screen share starts with zero subscribers, even after restarting a share or reconnecting. Webcam video keeps its existing automatic behavior. Voice and Stream volumes are independent and local to each participant tile; they reset when reconnecting. Stream volume does not subscribe/unsubscribe: use Watch/Stop watching to control bandwidth. Call details exposes cumulative video/system-audio bytes sent/received to help verify that stream counters stop increasing after unsubscribe.

**Update all participants' clients before calling.** The new media protocol separates voice and system audio and rejects older clients that mix them. Restart the updated server for nickname support, then restart Linux clients / rebuild the Windows EXE. No new ports are required.

## Profiles, emojis, and direct calls

- Choose **Online** (green), **Idle** (orange), or **Do not disturb** (red, with a minus) below your name or in **Settings → My account → Status**. Your manual status is saved on this server and shared across signed-in devices. Offline users have a red dot without the minus. Status appears in member and friend lists and beside your own avatar. Do not disturb silences desktop message notifications; messages and calls remain available.
- **Settings → My account → Set Idle automatically when I’m away** enables automatic idle on this device, after 1, 5, 10, 15, or 30 minutes (default 5). It starts disabled. Activity restores Online; manual Idle and Do not disturb take priority. The desktop app queries OS idle time and lock state using Electron’s `powerMonitor` API, without reading keystrokes or mouse positions. Unsupported desktops and browsers fall back to activity within Driskord. Browser background timers can delay detection. With multiple devices connected, any active device keeps an automatically managed account Online; all devices must be idle for automatic Idle. Disconnecting every client makes the account Offline. Restart the updated server and clients to enable presence support; the preference table is created automatically.
- **Settings → My account → Nickname:** change the name shown in chat, calls, member lists, typing notices and notifications. Nicknames initially match the username, including for existing accounts. Usernames stay permanent for login and friend requests; account settings show the username read-only and identity tooltips identify it.
- **Settings → My account → Upload profile picture:** choose an image. The client fits it within 512 × 512 pixels and uploads a PNG; the server enforces those bounds. You can replace or remove it. Profile pictures appear in chat, member/friend lists and call tiles.
- **Settings → Custom emojis:** upload a named image, resized to fit 128 × 128 pixels. Use the emoji picker or type `:name:` in chat. Standard and custom emojis also work as reactions. Use React in the message actions shown on hover or keyboard focus (always visible on touch devices); click your reaction again to remove it. Authors and managers can delete custom emojis. Animated custom uploads become still images; chat GIF originals remain animated when opened.
- Drag files onto the chat area or use the attachment picker to queue up to 10 files (5 MB combined per message). Review the filenames, remove any unwanted files, then send. Drops never send automatically.
- Chat PNG/JPEG/WebP/GIF attachments show small WebP previews and retain their download button. Previews fetch only near the viewport; opening an image fetches its original resolution, including GIF animation. Click a preview (or focus it and press Enter) to open a large viewer. Full screen or image double-click fills the screen; Escape exits full screen first, then closes the viewer. Close or Return to chat restores the chat view. GIFs remain animated in the viewer. Attachment authorization still follows its channel/DM. HTTP(S) links open in your normal browser from Electron.
- Click **Call friend** in the friends list or DM header. Friends must be accepted and online on this server. The recipient sees a **Join call / Decline** banner; joining opens the same voice/video/screen-share controls as a voice channel. In a private call, click **Invite friend** to add other accepted friends, up to eight members. Invitations expire after two minutes; the call disappears when its last participant leaves. Calls and invitations do not survive a server restart.
- Green outlines on call tiles and voice-channel avatars indicate microphone activity. Mute and push-to-talk suppress the indicator. It measures the microphone before screen-share sound is mixed, so shared music does not light it up.
- Input/output selections are saved with device names. Desktop launches reuse the local UI port, and a unique matching device name can recover a changed device ID. A disconnected device uses System default temporarily without discarding the saved choice. After this upgrade, select each device once if an old selection has no saved name. Test by closing/relaunching the app.
- Voice channel names accept capitals and spaces, such as `Test Room`; text channel names normalize to lowercase and hyphens.

Restart the updated server with `npm run server` and update/restart all clients (`npm start` on Linux; rebuild/download the Windows portable EXE). New profile/avatar/emoji tables are created automatically without changing existing messages/accounts. No new dependency or port forward is required. Keep your normal database backup before updating.

## Large message histories and previews

- Conversations fetch 100 messages at a time. Scrolling within 400 pixels of the beginning loads another page asynchronously; failed requests show a retry action. Search and pinned views use the same paging mechanism. The beginning-of-conversation welcome appears only after reaching the oldest page.
- TanStack Virtual measures variable-height rows and renders the viewport plus five rows on each side. Prepending history preserves the reading position. New messages follow the viewport only when already near the bottom; otherwise use **Jump to latest**. The message area supports keyboard scrolling. Loaded text/attachment metadata remains in memory for the current conversation; the complete DOM and image blobs do not.
- Attachment previews are requested within 240 pixels of the viewport. Image blobs and pending requests are released when their rows leave the virtualized range. The stable preview frame reserves space while images download. Originals are fetched only when opening the viewer or downloading; GIF previews use the first frame, and opening loads the animated original.
- The server generates aspect-preserving WebP previews up to 480 × 360 pixels using Sharp. Existing uploads are handled on demand. Generated previews are cached in SQLite, bounded to 64 MiB of logical image data and 4,096 entries; they are derived data, separate from the original-upload quota. Deleting the attachment also deletes its preview. SQLite files/WAL can exceed the logical cache size. Decoding is limited to two concurrent images, 32 pending jobs, 40 million input pixels, a five-second processing timeout, and 256 KiB output per preview. Unsupported/corrupt or oversized images retain their original download/open action.
- Update the backend first (`npm ci`, restart the server, or rebuild the Docker image), then rebuild/restart clients. The preview-cache table is created automatically. Sharp is a server dependency and is excluded from standalone desktop packages; do not omit optional dependencies when installing the server, since they provide its platform binary. A new client needs the updated server for thumbnail previews.

## Validation

```bash
npm run check
npm run build
npm test
```

The integration suite covers separate accounts/clients, live messages, DM isolation, friendship acceptance, edit/delete authorization, reactions, pin permissions, attachments, role changes, signaling, logout, and restart persistence. It uses temporary databases and ports. It does not test real microphone/camera hardware or NAT traversal.

**Current environment result:** actual `npm run check` and `npm run build` now pass with installed dependencies; 70 tests pass in `npm run test:unit` across security, SQLite schema, desktop state, microphone capture, voice signaling/playback, stream subscriptions and separate audio, microphone metering, multi-file uploads, profiles, previews, custom reactions and private-call authorization. The new request-handler tests run without listening sockets; the existing real-socket integration tests are blocked here because the sandbox denies listening on localhost (`listen EPERM`). The portable build command completes checking/building but cannot download electron-builder because npm DNS is unavailable. No `.exe` has been produced or tested here. Electron launch, Docker build, live media, and Windows portable launch still need validation. The existing package lock pins application dependencies; the packaging tool is separately pinned in the build command.

See [IMPLEMENTATION.md](IMPLEMENTATION.md) for architecture, data model, event/API contracts, extension guidance, and remaining work.
