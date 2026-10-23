# Linux screen-share audio

Campfire's Linux desktop client uses its own small helper linked directly to
PipeWire. It does not depend on venmic. The server, database, and existing
WebRTC screen-audio protocol are unchanged.

## Sharing

Choose a screen or window in the usual picker. Campfire then shows an audio
confirmation before it sends the share:

- **No audio** shares only the video.
- **System audio (excluding Campfire)** shares application playback, including
  applications that begin playing later. Microphone inputs and Campfire's own
  call playback are excluded.
- An **application** shares its playback streams. This can include other windows
  or tabs belonging to the same application process. The application must expose
  an audio stream to appear in the list.

On X11, Campfire recommends an application only when the selected window's
`_NET_WM_PID` matches exactly one listed application process. Under Wayland, the
portal does not reliably expose that association, so the choice starts at
**No audio**. Audio remains in the same sharing flow; the system-owned portal
picker is not modified. PipeWire audio capture works with either display system.

Windows retains its existing system-audio checkbox. Browser screen sharing
continues to use the browser's own capture support.

## Requirements and building

The Linux client needs PipeWire, its loopback module, and PipeWire's PulseAudio
compatibility service so Chromium can discover the temporary input. These are
normally supplied by the desktop's PipeWire installation. A PulseAudio-only
system does not support this capture helper. Missing support allows video-only
sharing; the app never substitutes a microphone for a missing share source.

For development or packaging on Debian/Ubuntu:

```sh
sudo apt-get install build-essential pkg-config libpipewire-0.3-dev libx11-dev
npm run build:pipewire
```

`npm start` builds the helper before launching the desktop client. `npm run
dist:linux` also builds it, and Linux package workflows install the build
dependencies. Windows builds skip the helper. Browser-only builds need no native
compiler or PipeWire dependency.

The generated executable is `electron/native/bin/campfire-pipewire` and is ignored
by Git. Linux packages place it beside the app resources, outside `app.asar`.
Its runtime libraries are `libpipewire-0.3` and `libX11`; the latter is used only
to suggest matching audio on X11. Installed users do not need a compiler or
manual audio-routing commands.

## Capture and cleanup

The helper observes the PipeWire graph and links the selected application output
ports to a temporary stereo audio source. It preserves existing playback links,
does not set default devices, and downmixes multichannel application playback to
stereo. System mode follows new application nodes; application mode follows new
streams from the selected process. Restarting that application with a new process
ID requires restarting the share.

Chromium captures the unique temporary source with an exact device ID. Its audio
track is added to the screen-share stream, independently of microphone capture.
Existing spectator subscriptions and stream-volume controls still apply.

Only the trusted main renderer can request capture, after selecting a screen or
window. A selection token restricts capture to its listed choices. Helper links
and sources belong to the helper connection and disappear on exit. Stop, Cancel,
leaving the call, permission loss, renderer navigation/crash, and application exit
release the resources. Unexpected helper failure ends share audio while allowing
video to continue.

## Verification

- `node --experimental-strip-types test/screen-audio.test.js`: exact-device
  capture, cancellation races, video-only choice, helper failure, selection
  authorization, renderer cleanup, and trusted IPC boundaries.
- `node scripts/verify-pipewire.mjs`: synthetic application playback, real native
  sample capture, Campfire exclusion, new streams in system mode, and source
  cleanup without removing existing audio devices.
- `node scripts/verify-screen-audio.mjs`: the actual confirmation component and
  preload bridge under the desktop CSP, real Chromium capture, audio RTP and
  decoded samples in a second Electron client, Stop, and Cancel. Video is generated
  for this fixture; it does not automate the desktop portal or prove compatibility
  across every compositor, distribution, or packaged Linux environment.
