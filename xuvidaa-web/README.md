# XUVIDAA TV web edition

This is a separate browser application. It does not change the LG webOS app or
its protected playback files. The API adapts the existing Magis service methods
to same-origin HTTP and reuses the existing loopback media proxy without the
FFmpeg relay.

## Required private setting

Set `XUVIDAA_WEB_PASSWORD` as a private variable on the `api` service in Dokploy.
It must contain at least 14 characters. The same access password is shared by
all users; this draft has no user database or per-user portal sessions.
There is deliberately no example value and no `.env` file. The API refuses to
start when this variable is missing. The value is used only for the browser
login and signing the short-lived, HTTP-only session cookie.

## Network and routing

- `web` joins the existing attachable `dokploy-network` and the new
  `xuvidaa-tv-private` overlay network.
- `api` joins only `xuvidaa-tv-private`, listens on container port 8081, and has
  no published host port. The network is not marked Docker `internal`, so the
  API can make outbound portal/CDN requests; its inbound API is available only
  to `web` on that network.
- Traefik routes `tv.rfcsas.com` to `web:8080` over `websecure` using the
  existing `letsencrypt` resolver. Labels are on the Compose container, where
  Dokploy's Docker provider reads them. Deploy this as a Compose application,
  not with `docker stack deploy` (which does not build these images).
- `nginx.conf` disables access logs and response buffering on media routes.
  `Range`, `If-Range`, `HEAD`, upstream status and range headers pass through.
  Media bytes stream with backpressure. Small HLS manifests are bounded and
  rewritten from the API container's loopback proxy URL to same-origin paths.
- Nginx replaces `X-Xuvidaa-Client-IP` with the `X-Real-IP` set by Traefik;
  login throttling uses that verified visitor address. Keep Traefik's normal
  forwarded-header validation enabled. The API must remain on its private
  application network, accessible only to `web`.

## API contract

All JSON routes require the browser session cookie. Requests use JSON bodies,
not query strings, for catalog and playback identifiers.

- `GET /api/session`, `POST /api/login`, `POST /api/logout`
- `POST /api/home` (`root`), `/api/search` (`value`), `/api/detail`
  (`contentId`), `/api/media-info` (`contentId`, optional `seriesContentId`)
- `POST /api/resolve` (`contentId`, optional `seriesContentId`, `trackIndex`)
- `POST /api/live/categories`, `/api/live/channels` (`columnId`, `pageNum`,
  `pageSize`), `/api/live/resolve` (`channelCode`)
- `POST /api/ping`, `/api/netdiag` (the web diagnostic reports the server
  session only; it cannot inspect the television's DNS or codecs)
- `GET` or `HEAD /api/media/:token/*` forwards streaming requests to the
  loopback proxy. `GET`/`HEAD /api/hls/:token/:reference` serves HLS child
  playlists, keys and segments previously registered from a returned manifest;
  callers cannot forge destinations by encoding an arbitrary URL.
- `GET /api/sub/:token.srt` serves a proxied subtitle.
- `GET`/`HEAD /api/image/:token` serves authenticated catalog artwork. The
  destination is registered server-side, resolved to a public IPv4 address and
  pinned for the request. Private/reserved addresses, redirects, non-image
  responses and images over 8 MiB are rejected.

The API does not expose upstream URLs or upstream headers. It keeps playback
records in process memory and returns only same-origin opaque media paths. The
source's GitHub seed fallback is blocked; if the actual portal cannot establish
a session, the API returns an error instead of adopting a third-party session.
The frontend contains no example catalog or test accounts.

The exact Luna-to-HTTP method mapping and methods that remain unavailable are
documented in [API_CONTRACT_IPK_2.2.32.md](API_CONTRACT_IPK_2.2.32.md). M3U
imports and external `streamUrl` values remain disabled until a safe host
allowlist is configured; `resolveSmooth` remains specific to the on-TV FFmpeg
relay.

The image build applies three guarded Node lifecycle adaptations to its own
copy of `proxy.js`: a completed incoming request no longer aborts the response,
and normal upstream EOF/close waits for the downstream response to finish.
The original files under `webos/` are not edited. A changed upstream pattern
fails the build so the adapter must be reviewed again.

## Playback limitations

There is no FFmpeg, transcoding, media fixture or database in this edition.
Browser support for each real portal format (especially MPEG-TS, HEVC and HLS)
must be verified with an authorized resource before enabling production
playback. Proxying preserves byte ranges and does not buffer whole media files.
The container resource limits are initial caps and must be reviewed against
measured portal and streaming load before deployment.
The inherited proxy has one active playback context: opening another title
can stop an existing playback in another browser. Multi-user concurrent
playback is outside this initial edition. HLS child origins must match the
stream origin or one of the portal's backup origins; an additional legitimate
CDN origin requires review before allowing it.

## Build context

The Compose file expects to live in this directory in the XuperTV repository;
the API image copies only `magis.js`, `dnsx.js`, `proxy.js` and their
`ts-indexer.js` dependency. It does not copy the webOS service wrapper or the
FFmpeg binary.

## Local regression checks

Run from the repository root with Node 24 or later:

```sh
node --check xuvidaa-web/server/index.js
node --check xuvidaa-web/server/prepare-upstream.js
node --check xuvidaa-web/public/js/access.js
node --check xuvidaa-web/public/js/app.js
node --test --experimental-test-isolation=none xuvidaa-web/test/server.test.js
docker compose -f xuvidaa-web/compose.yaml config --quiet
```

The Compose command requires `XUVIDAA_WEB_PASSWORD` to be supplied in the
environment. The tests generate their own temporary random access value and
use local synthetic responses with the actual copied proxy; they do not call
the portal or contain playable examples for the product. Where the sandbox
forbids child processes, use `node --test --experimental-test-isolation=none
xuvidaa-web/test/server.test.js` instead.
