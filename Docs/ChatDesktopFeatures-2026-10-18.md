# Chat and desktop additions — 2026-10-18

## User-facing behavior

- Type `:` in either the channel/DM composer or a thread to search common built-in emoji aliases and server custom emojis. Arrow keys select; Enter or Tab completes; Escape dismisses. Enter completes an open suggestion before sending. IME composition remains independent.
- Ctrl/Cmd + F focuses conversation search; Ctrl/Cmd + comma opens settings. During a call, Ctrl/Cmd + Shift + M toggles microphone mute and Ctrl/Cmd + Shift + D toggles deafen. Existing Enter/Shift+Enter and push-to-talk shortcuts remain available.
- Server settings support PNG/JPEG/WebP icon uploads, resized to a maximum of 256 pixels. The icon appears in the server rail. Server-edit permission is required; the API validates the stored PNG independently.
- Notifications settings include server mute, scoped to this device, account, and server. It suppresses message sounds and desktop alerts, including DMs and mentions/thread mentions. Existing channel/DM overrides remain available; the conversation toolbar now also has a mute button. Unread indicators remain visible.
- Reaction chips show only emoji and counts. Hovering or focusing a chip opens a separate popup listing participant names and avatars, with a fade-in animation. Server settings can disable these names for everyone; each text channel can also disable them. These switches control presentation, not identity privacy or permission to react.
- Reactions appear first, with thread reply counts below them and more vertical spacing.
- Settings → Channels uses drag handles instead of up/down buttons. Drop places a channel before or after its target within the same channel type, selected by the upper or lower half of the target row. A horizontal insertion line previews the result. Alt + Arrow keys on a focused handle provide keyboard reordering. The API validates permissions and channel visibility and saves positions atomically.
- Desktop Settings → My account includes an opt-in Close to system tray setting. Closing hides the window and preserves the running session. The tray offers Open and Quit; clicking it or launching another instance restores the hidden window. Disabling the option restores normal close. If native tray creation throws, normal close is allowed.
- Server owners can remove members and restore their access from Server settings. Removal retains message history, revokes every session, disconnects sockets/calls, hides the member from active lists, and blocks login until restored. Owners cannot remove themselves or another owner. Restoration requires a fresh login.
- Push-to-talk remains off for new installations; saved preferences remain respected. Microphone tests use independent local capture, so call mute, deafen, and push-to-talk do not silence the test or alter transmission. Simultaneous capture still depends on device/OS support.
- Voice rosters show microphone-muted/deafened icons and a CAM badge for camera sharing, alongside the existing LIVE screen-share badge. CAM opens/joins the corresponding voice call.
- Scrollbars use transparent tracks with no arrow buttons. Only the thumb appears when the window is focused and the scrolling area is hovered or contains keyboard focus. Width remains reserved to prevent layout jumps.

## Implementation inventory

- `src/emojiCompletion.ts`, `ChatComposer.tsx`, `ThreadPanel.tsx`: emoji aliases and accessible composer completion.
- `src/main.tsx`, `SettingsPanel.tsx`, `ChannelSettings.tsx`, `ChatMessages.tsx`, `campfire-theme.css`: shortcuts, server/member controls, drag ordering, reaction layout, and focus styling.
- `src/notifications.ts`, `MicrophoneMeter.tsx`, `useCall.ts`: notification policy, independent test capture, and outgoing voice status.
- `shared/contracts.ts`, `server/app.js`, `administration.js`, `calls.js`, `database.js`: state/contracts, validated management endpoints, status broadcasts, and migration 10 for per-channel reaction-name display.
- `electron/main.cjs`: native tray lifecycle and hidden-window restoration.
- Existing channel, notification, migration, and socket-event test suites cover the new behavior.

## Verification

- `npm run check`, `npm run build`, `npm run format:check`, and `git diff --check` passed.
- Full `npm run test:unit`: 153 passing tests. Subsequent channel-suite check passed all 10 tests, including hidden drop-target rejection.
- Isolated Linux Electron checks used temporary server accounts and desktop profiles. Passed: authenticated rendering; colon suggestions and completion; Ctrl+F and Ctrl+comma; server controls; reaction setting updates; drag/drop persistence; reaction-before-replies ordering; status broadcasts and CAM/mute/deafen rendering; no document horizontal overflow at 1440 and 960 pixels.
- Native production Electron tray checks passed: close hides window and creates a tray; second-instance activation restores the window; disabling tray mode permits normal asynchronous window close.
- Voice roster checks used a synthetic socket participant. These verify signaling/rendering, not physical capture or multi-client WebRTC transport. Physical microphone/camera, platform tray visibility, and Windows/macOS behavior were not validated in this run.

## Follow-up fixes

- Server icons now reuse the profile picture cropper, including drag/pan, zoom, horizontal/vertical positioning, Center crop and Fit whole image. Existing server icons have an Adjust server icon action. Preview and saved output use the same 256-pixel square canvas.
- Channel dragging keeps the source in a ref so events do not depend on React rendering timing. Before/after placement supports adjacent moves and the first/last positions, with a horizontal insertion line and no visible move label. Saving prevents concurrent drags.
- Revoked invitations are excluded from the server query before the 200-item limit and hidden in the UI. Revoking the currently displayed new invitation also dismisses its code.
- Follow-up validation: 25 relevant tests passed (channels, registration, crop geometry), along with TypeScript, build, formatting and diff checks. Linux Electron verified shared icon controls, exact preview/save equality, reopening existing icon adjustment, invitation visibility, and real mouse-initiated native drags moving first to last, last to first, and one adjacent position down.

Reaction popup follow-up: compact emoji/count chips, a viewport-clamped portal popup with participant avatars and names, reduced-motion support, keyboard focus and Escape dismissal. Linux Electron checks passed for hover/fade-in, dismissal, viewport placement, reaction toggling, and the server display setting. TypeScript, production build, formatting and diff checks passed.
