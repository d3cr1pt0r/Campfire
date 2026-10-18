# Campfire design review

Ember is the implemented direction: warm charcoal, timber navigation, cream type, amber controls, sage presence accents, and a custom campfire illustration. Canvas is the light theme; Forest remains an additional CSS study in the comparison gallery. Settings → Appearance offers System (default), Dark (Ember), and Light (Canvas), saved on this client.

Open `index.html` in a browser. It works directly from disk. The gallery contains 46 screen states for each of three Campfire directions, with the original layout alongside each capture. Use the direction buttons, category selector, or screen search; click a screenshot for full resolution. `design-directions.png` shows nine examples on a single board. Seven `compare-*.png` files provide standalone before/after exports.

The screenshots render the application's actual React components with a deterministic API/socket fixture, including staged voice and media data. The gallery covers chat, search, pins, threads, direct messages, friends, requests and empty states, every settings section, profile controls, registration/invitations, channel and role administration and confirmations, all application modal variants, calls, expanded viewers, avatar cropping, notifications, and sign-in/owner-setup/error variants. OS-native screen-source and file pickers use the operating system's appearance and are outside the retheme.

## Assets and implementation

- `src/style.css`: application-wide warm base colors and shared styles.
- `src/campfire-theme.css`: refined Ember styling and optional Canvas/Forest studies; resolved themes use `data-theme` on the document element. System is the default client preference.
- `src/CampfireScene.tsx`: scalable welcome illustration, decorative and hidden from assistive technology.
- `src/main.tsx` and `src/ChatMessages.tsx`: Campfire branding, welcome copy, and flame details.
- `assets/campfire/icon-512.png`: final **512 × 512 RGBA PNG**, with transparent outer corners. Corresponding renderer and Electron assets are in `src/assets` and `electron/icons`; the ICO contains a 256 × 256 PNG frame.
- Electron branding, favicon, new-server default name, package artifact names, build workflow artifact names, and README display names now use Campfire. Existing server names and user-authored role colors remain their own content. Package and executable names, application IDs, and the desktop bridge also use Campfire. See the upgrade guide in `../../REWORK.md` when updating an existing installation.

## Reproduce

From the repository root:

```sh
node scripts/campfire-review-server.mjs
# In another terminal:
node_modules/.bin/electron scripts/campfire-review-capture.cjs
node scripts/campfire-review-gallery.mjs
node_modules/.bin/electron scripts/campfire-review-verify.cjs
```

The preview listens on localhost ports 5181 and 5182. Baseline source is loaded from Git revision `f7e55c1027027e97da01994285c0988fcc3055a4`; the current source provides the new designs. The fixture does not open the real database or use an existing account. Both Electron review scripts use separate temporary user-data directories. The baseline icon is available as `campfire-icon.png`. Baseline captures use the current product name with the original layout.

The gallery is also available while the preview server is running at `http://127.0.0.1:5182/Docs/campfire-review/index.html`.

## Validation scope

Type checking, production build, formatting, the complete unit suite, and Git whitespace checks passed. The 184 application captures recorded no JavaScript renderer errors. Capture dimensions are 1440 × 960. Gallery controls and horizontal layout at 1440 and the native minimum width of 960 are checked separately in `verification.json`.

This validates appearance and source behavior, with staged media. It does not establish real multi-client audio/video behavior or packaged Linux/Windows installer behavior. Restart an already running desktop app after rebuilding because Electron enforces a single-instance lock.

## Image generation

The built-in image generation tool created the icon; Sharp resized the final asset and encoded the ICO. No external API key was used.

Final generation prompt:

> Use case: logo-brand. Create a single production app icon for Campfire, a cosy friends chat app. A bold simple golden amber flame with a subtle speech-bubble silhouette, above two short crossed terracotta logs, centered on a deep warm espresso rounded-square tile. Friendly sophisticated flat illustration with softly rounded geometric edges, subtle warm glow only inside the tile. Palette espresso #211a17, burnt orange #df754d, honey #f5bd71, cream #fff1dc. Readable at 32 pixels. No text, no letters, no tiny details, no mockup, no sheet. Square composition, icon fills image, 512x512 maximum output requested.

Final edit prompt:

> Use case: background-extraction. Edit this Campfire app icon. Preserve exactly the existing amber flame, cream inner flame with speech-bubble tail, crossed orange logs, warm glow, espresso rounded square tile, composition and colors. Remove ONLY the white canvas outside the rounded-square tile and make those exterior corners transparent. The whole dark rounded-square tile remains opaque. No other changes. No text. Output square icon, final app asset will be resized to 512x512.
