# Video quality — 2026-10-22

## User-facing behavior

- Settings → Audio & Video → **Video & screen sharing** now has separate camera and screen settings:
    - **Camera:** resolution 360p, 720p (default) or 1080p, at 15 or 30 fps (default).
    - **Screen sharing:** resolution **Source** (default) or up to 720p, 1080p or 1440p, at 5, 15, 30 (default) or 60 fps. Source sends the screen at its own resolution; any lower one scales it down, which blurs small text. Screens are never scaled up.
- **Advanced**, for camera and screen separately:
    - **Bitrate:** Data saver, Lower, Auto (default), Higher, High or Maximum (0.5× to 3× the automatic ceiling). The slider shows the resulting ceiling per viewer, for example "Auto · up to 8.0 Mbps per viewer" for a 1440p screen at 30 fps.
    - **When the connection cannot keep up:** keep it sharp (lower the frame rate, the screen default), keep it smooth (lower the resolution) or balanced (some of each, the camera default).
- Changes apply at once, including to a camera or share already running, without reconnecting.
- When video you send is reduced by bandwidth or by your computer, a **Reduced quality** button appears next to LIVE in the call heading. Its tooltip says who is affected and why: one viewer's connection, your upload (when every viewer is affected), the connection between you and your only viewer, or your computer. Clicking it opens connection diagnostics.
- Viewers see a warning triangle on the reduced video's tile, saying from their side why it is reduced: their connection, the sender's upload, the connection between them, or the sender's computer.
- Connection diagnostics now show, per person, the round trip, current upload and download, the estimated available upload, and for video each way the resolution, frame rate, bitrate (outgoing against its ceiling), codec, whether it runs on the GPU or CPU, and packet loss. A total upload and download line sits at the top.

## How it works

- Without a ceiling Chromium allows only about 2.5 Mbps for any video above 540p, so 1080p received no more bits than 720p. The automatic ceiling now follows the captured size and frame rate:

| Screen, 30 fps | Ceiling |     | Camera, 30 fps | Ceiling  |
| -------------- | ------- | --- | -------------- | -------- |
| 720p           | 3 Mbps  |     | 360p           | 1 Mbps   |
| 1080p          | 5 Mbps  |     | 720p           | 2.5 Mbps |
| 1440p          | 8 Mbps  |     | 1080p          | 4 Mbps   |
| 2160p          | 14 Mbps |     |                |          |

- Sizes between rows are interpolated by pixel count. Frame rate scales the ceiling by 0.5 at 5 fps, 0.75 at 15, 1 at 30 and 1.5 at 60, because fewer frames each differ more from the last; the bitrate setting multiplies the result, with a 300 kbps floor.
- It is a ceiling, not a target: still content uses far less, and each viewer's connection still lowers it on its own. A static 1440p share of text used about 2.3 Mbps under a 5 Mbps ceiling and 2.9 Mbps under 10, and at 5 Mbps looked essentially identical to the original at 3× zoom; scaled to 1080p it was visibly blurred.
- The sharp, smooth and balanced choices map to the sender's degradation preference (maintain-resolution, maintain-framerate, balanced). For screens they also set the track's content hint (detail, motion or none), which tunes Chromium's encoder.
- A limit is detected from Chromium's own report that it lowered resolution or frame rate for lack of bandwidth or CPU, or from the viewer reporting more than 5% packet loss. It must hold for five one-second samples before it is shown or cleared, so the first seconds of a stream, while its bitrate climbs, do not warn. The sender tells each affected viewer through the existing call signaling (`quality` in `CallSignal`); clients that predate this ignore it.

## Implementation

- `src/videoQuality.ts`: settings with validation and defaults, capture constraints, content hints, bitrate ceilings, encoding parameters, the stats summary, limit detection, attribution and messages.
- `src/peerMedia.ts`: `createPeerMedia` takes options (`videoCodecs`, `videoEncoding`) and sets the video sender's encoding whenever it attaches or syncs, only when the values change; Chromium keeps them through renegotiation and track replacement. A rejected encoding leaves Chromium's defaults.
- `src/useCall.ts`: capture uses the new constraints; settings changes apply constraints to running tracks and resync every viewer, again 1.5 s later once the new size is reported. Stats are sampled every second throughout a call, not only while diagnostics are open, and quality notices are sent and received.
- `src/AudioVideoSettings.tsx`, `src/CallPanel.tsx`, `src/MediaTile.tsx` and `src/campfire-theme.css`: settings, the heading warning, diagnostics and the tile warning. A `--warning` colour is defined for both themes.
- `shared/contracts.ts`: the new preferences, `VideoAdaptation`, `VideoLimit` and `CallSignal.quality`. The camera resolution keeps its `quality` preference, so saved settings carry over.

## Verification

- `npm run check`, `npm run format:check`, `npm test` and `npm run build` pass. `test/video-quality.test.js` covers settings, constraints, ceilings, encodings, stats, limit settling and attribution; `test/peer-media.test.js` covers applying and updating sender limits and a rejected limit.
- `node scripts/verify-video-quality.mjs` runs two Electron clients against a temporary server: settings save and show their ceiling; a share captures with the chosen constraints and gets the expected ceiling, frame rate, content hint and degradation preference; bitrate and resolution changes mid-share reach the running sender; diagnostics show live video both ways and totals; a bandwidth limit (reported through a wrapped `getStats`) raises the warning on both sides and clears it. Chromium's fake capture device, used for a predictable microphone, restarts at a fixed size instead of scaling, so live rescaling was checked separately on a real screen: a 3440×1440 capture limited to 720p delivered 1720×720 frames.
- Not verified: real congested networks (Chromium's own reduction under a 400 kbps limit was measured separately), calls between separate machines, Linux and macOS.
