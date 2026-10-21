# Image attachments — 2026-10-21

## User-facing behavior

- Image attachments are framed to their own shape within 480 × 360 pixels instead of a fixed 4:3 box, so wide screenshots and banners take only the height they need. Small images are not enlarged. Extremely narrow or flat images keep a 48-pixel minimum side and are cropped to it.
- GIFs, animated WebP and animated PNG images play as they come near the screen. The still preview shows first and is replaced by the animated original once it loads.
- The download card now appears only for files without a preview. Images show a download button in their top-right corner on hover or keyboard focus, and the expanded viewer has a Download button next to Return to chat.
- If a preview cannot be made, the attachment falls back to the download card.

## Implementation

- `server/images.js` `imageInfo` reads the displayed width and height, and whether the image animates, from PNG (including `acTL`), GIF, JPEG (with EXIF orientation 5–8 swapping the sides, as previews do) and WebP (VP8, VP8L, VP8X) headers. Malformed data gives no size.
- `server/schema.sql` adds `attachment_images` (created on existing databases at startup, no upgrade step). Uploads store each image's size; zeros record an unreadable header. Attachments uploaded earlier are measured once, at most 20 per message-history response, when their message is first viewed (`describeImage` in `server/app.js`). Sizes come from a join on the existing attachments query, so message history needs no extra query.
- Message views include `width`, `height` and `animated` for images with a known size (`shared/contracts.ts`).
- `src/ImageAttachment.tsx` reserves the exact frame before loading (`attachmentFrame` in `src/images.ts`), loads lazily near the viewport, and uses the original for animated images. Images without a stored size use a 4:3 placeholder until they load. `AuthImage` is now only the plain authenticated image used for avatars and emoji.
- `src/ExpandedImage.tsx` accepts an `onDownload` action. Styles are in `src/campfire-theme.css`; the earlier fixed-ratio rules were removed from `src/style.css`.

## Verification

- `npm run format:check`, `npm run check`, `npm test` (262 passing, including size reporting at upload, one-time measurement of older attachments, header parsing for every format and the frame calculation), `npm run build` and `git diff --check` passed.
- Windows Electron against a temporary server with a 1600 × 300 banner, a 400 × 1400 image, an animated 600 × 200 GIF, a 1200 × 900 JPEG and a text file: frames were 480 × 90, 103 × 360, 480 × 160 and 480 × 360, reserved before loading and filled by their images with no padding. The GIF used its original and showed four distinct frames on screen. Only the text file had a download card. The image download button was hidden until hover. The expanded viewer showed Download. There were no renderer console errors in Ember or Canvas.
