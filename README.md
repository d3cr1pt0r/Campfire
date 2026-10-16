# Driskord

An English-only, self-hosted community chat app with an Electron desktop client and a reusable React browser interface. This is an initial implementation, not Discord feature parity or a production-audited release.

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

Expected output for version 0.1.0:

```text
release/Driskord-0.1.0-x64-Portable.exe
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

## Implemented scope

- In-app registration/sign-in, salted password hashes, expiring sessions, and server-local accounts.
- Persistent text channels and DMs, friend requests/acceptance/removal, presence, and live messages.
- Files up to 5 MB with authenticated downloads.
- Own-message editing/deletion, five reaction emojis, typing indicators, session unread badges, search, and manager-pinned messages.
- Voice channels with microphone mute/deafen, webcam video and local preview, screen/window sharing, and individual participant volume.
- Focused-app push-to-talk with Space, browser noise suppression/echo cancellation, and call sounds.
- Role creation/editing, colors, chat/voice/management permissions, owner-only role assignment, and server naming.
- Settings for notifications, audio input/output, and 360p/720p/1080p requested streaming resolution.

Search, pinned views, and history currently operate on the latest 500 messages in a conversation. Unread counts are session-local. Screen sharing replaces the outgoing camera track and restores it when sharing stops. Screen sharing is video-only; system audio capture is not implemented. Settings affecting device capture apply on the next call/video start. Output-device support and capture picker behavior depend on the OS. Push-to-talk works while the app has focus and the cursor is outside an input field; it is not a system-wide hotkey.

Private channels, moderation/ban UI, nicknames, custom server icons, saved multi-server sessions, direct-message calls, threads, bots, password recovery, mobile clients, code-signed desktop releases, auto-updates, and a large-call media server are future work. Message text is rendered as plain text, with no HTML or Markdown execution. DMs are access-controlled on the server; they are **not end-to-end encrypted** against the server owner. WebRTC encrypts media transport, and TURN can relay that media.

## Microphone troubleshooting

If voice join fails before connecting, select **Settings → Voice & video → Input device → System default**, then click **Allow microphone & refresh devices**. The client reports the native error name even when the browser supplies no error text. An expired/disconnected saved input is retried once with System default and the saved preference is reset only when that succeeds.

On Linux, `NotReadableError` suggests checking your active audio service and input routing; `NotFoundError` means no suitable microphone was available; `NotAllowedError` means permission was denied. You can inspect your current system audio session from a normal terminal with `wpctl status` (PipeWire) or `pactl info` / `pactl list short sources` (PulseAudio-compatible server). Check the microphone in your system sound settings and avoid launching the app with sudo. These checks concern local capture, not STUN ports.

For browser clients, microphone capture requires HTTPS or localhost. For the Linux Electron client, run `npm start` after updating; packaged clients need a rebuilt package to receive these client-side fixes.

## Validation

```bash
npm run check
npm run build
npm test
```

The integration suite covers separate accounts/clients, live messages, DM isolation, friendship acceptance, edit/delete authorization, reactions, pin permissions, attachments, role changes, signaling, logout, and restart persistence. It uses temporary databases and ports. It does not test real microphone/camera hardware or NAT traversal.

**Current environment result:** actual `npm run check` and `npm run build` now pass with installed dependencies; 17 unit tests pass across security, SQLite schema, desktop state and microphone capture helpers. Server integration tests are blocked here because the sandbox denies listening on localhost (`listen EPERM`). The portable build command completes checking/building but cannot download electron-builder because npm DNS is unavailable. No `.exe` has been produced or tested here. Electron launch, Docker build, live media, and Windows portable launch still need validation. The existing package lock pins application dependencies; the packaging tool is separately pinned in the build command.

See [IMPLEMENTATION.md](IMPLEMENTATION.md) for architecture, data model, event/API contracts, extension guidance, and remaining work.
