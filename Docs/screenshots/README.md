# README showcase

Refresh the README image from the current application UI:

```bash
npm run showcase
```

This writes `campfire-desktop.png` and its `campfire-desktop.json` metadata alongside this document. The JSON records the scenario, app version, viewport, timezone, and image hash. The README already links to the PNG, so future refreshes use the same command and filename.

Dependencies must be installed with `npm ci`. Electron needs a working desktop display on Linux; on a headless host, use `xvfb-run -a npm run showcase` if Xvfb is installed. No community backend or account is needed.

To inspect the sample app and keep its window open after capture:

```bash
npm run showcase -- --preview
```

Close the preview window to stop its server. To inspect a new capture without replacing the tracked image:

```bash
npm run showcase -- --output=/tmp/campfire-preview.png
```

## The fixed scene

The capture shows The Fireside sample community, a populated channel, reactions, an active call with a synthetic shared-screen frame, and an open thread with its original message separated from the replies. It uses the dark theme, a 1600 × 1100 content viewport, device scale 1, and UTC timestamps.

- [fixture.mjs](../../scripts/showcase/fixture.mjs) defines the people, messages, replies, channel names, avatars, shared-screen artwork, and target call height. Edit this file to deliberately update the scene.
- [client.mjs](../../scripts/showcase/client.mjs) provides sample socket, call, and speaking integrations. Its shared-screen preview is a canvas video track; it never captures a real screen or microphone.
- [server.mjs](../../scripts/showcase/server.mjs) serves the fixture API and aliases those integrations only for this capture server. It does not load the production backend or database. Unknown API resources fail, and writes are rejected.
- [capture.cjs](../../scripts/showcase/capture.cjs) opens the actual app, uses its resize and reply controls to select the scene, waits for bundled fonts, avatars, and video, and verifies the current layout. It requires two identical consecutive frames before replacing the PNG.
- [showcase.mjs](../../scripts/showcase.mjs) runs the server and Electron together, chooses an available local port, and cleans up its temporary profile and cache after exit.

The capture uses fresh local storage and refuses external network requests and permission requests. Your normal Electron profile, account, messages, and call are not used. The screenshot is a UI showcase, not evidence of a live multi-client media session.

The normal production build has no showcase switch or fixture imports. Changes to actual components and styles appear in the next capture automatically. If the UI controls or required layout change, capture fails instead of silently saving an incomplete scene; update the assertions and interaction selectors in `capture.cjs` alongside that intentional change.
