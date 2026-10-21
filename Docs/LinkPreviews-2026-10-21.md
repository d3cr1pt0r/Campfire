# Link previews — 2026-10-21

## User-facing behavior

- A message's first three links (outside code, and not KLIPY GIFs) get preview cards: the site name, the title as a link, a short description and an image. Pages with a large image (Open Graph `summary_large_image` or video) show it under the text; others show a small thumbnail beside it.
- YouTube links (watch, youtu.be, Shorts, live, m. and music.) show the video title, the channel and a 16:9 thumbnail with a play badge. Clicking a card opens the link in the browser; nothing plays inside Campfire.
- The message appears at once and its cards follow when the server has fetched the pages. Editing a message updates its cards.
- The author can remove a message's cards with the ✕ on a card; in channels, members who may delete others' messages can too. Removed cards stay removed after edits.
- Pages that cannot be reached, are not public, or have no title simply stay plain links.

## How it works

- The Campfire server fetches each page once (`server/link-previews.js`), reads its Open Graph, Twitter and HTML tags, or YouTube's oEmbed data, and shrinks the image to WebP (at most 640 × 640, 300 KB) with sharp. Members' apps never contact the linked sites; card images are served by the server at `/api/link-previews/:id/image` to signed-in members.
- Cards are cached by URL in `link_previews` and shared by every message linking the page. Successful pages are refetched after a day when linked again, failed ones after an hour. The cache keeps the newest 5,000 pages. `hidden_link_previews` records removals.
- Safety: only `http`/`https` on ports 80 and 443, no credentials, and only public internet addresses. Loopback, private, link-local (including cloud metadata), carrier-grade NAT, documentation, multicast and mapped ranges are refused, as is a DNS answer containing any of them. The connection uses the checked address, so DNS cannot change between the check and the request. Each redirect (at most 3) is checked again. Pages are read up to 512 KB, images up to 5 MB, with 5-second timeouts. At most three pages are fetched at once and 50 wait.
- `LINK_PREVIEWS=off` turns previews off for a server (see `.env.example`; `compose.yaml` passes it through).

## Implementation

- `server/link-previews.js`: address checks, the fetcher, tag and YouTube parsing, link selection, the cache and queue, and the image and removal routes.
- `server/database.js`: message views attach cached cards; only messages containing links add queries.
- `server/messages.js`: fetches after posting and editing, then sends the updated message.
- `src/LinkPreviews.tsx`, `src/ChatMessages.tsx`, `src/campfire-theme.css`: the cards.
- Tests use a fake fetcher and fake DNS answers, never real sites (`test/link-previews.test.js`; `test-support/open-server.js` turns previews off unless a test enables them).

## Verification

- `npm run format:check`, `npm run check`, `npm test`, `npm run build` and `git diff --check` passed.
- One manual run of the module against the real internet: a YouTube video gave its title, channel and a cropped 640 × 360 thumbnail; theverge.com gave its title, description and image; `127.0.0.1` and `169.254.169.254` were refused.
- Windows Electron with two members and fake pages: article, YouTube and compact cards rendered with images in both themes; only the author saw ✕, removing a message's cards updated both clients and was saved; no renderer console errors.
