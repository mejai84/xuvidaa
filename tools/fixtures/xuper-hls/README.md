# Offline HLS playback fixture

This test-only fixture contains the first ten seconds of **Big Buck Bunny**,
copyright 2008, Blender Foundation / www.bigbuckbunny.org.

The film is licensed under [Creative Commons Attribution 3.0 Unported](https://creativecommons.org/licenses/by/3.0/).
The rights holder's [license statement and attribution requirements](https://peach.blender.org/about/)
permit reuse of portions with the attribution above. This directory is a test
fixture; it is not included in the production image or in user catalogs.

The upstream HLS.js project identifies the source stream as Big Buck Bunny in
its [official test-stream registry](https://github.com/video-dev/hls.js/blob/master/tests/test-streams.js).
The segment was downloaded over HTTPS on 2026-11-17 from the public HLS.js/Mux
test stream; no Xuper installer content or proprietary catalog was used.

Source master:
`https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8`

Source rendition (848 × 480, H.264 and AAC-LC according to its manifest):
`https://test-streams.mux.dev/x36xhzz/url_6/193039199_mp4_h264_aac_hq_7.m3u8`

Source segment:
`https://test-streams.mux.dev/x36xhzz/url_6/url_846/193039199_mp4_h264_aac_hq_7.ts`

`segment.m2ts` contains the original segment bytes, renamed to avoid the
repository-wide ignore rule for diagnostic `.ts` files. It is ordinary
188-byte MPEG-TS (not 192-byte Blu-ray M2TS). Serve it as `video/mp2t`.

- Size: 905784 bytes (4818 MPEG-TS packets).
- SHA-256: `ae5f75bb810f13a22346d5b730dfc18f05efe95539bd5376fc7525314832327d`.
- Changes: truncated the original VOD playlist to its first segment; local
  relative filenames and an explicit media sequence replace upstream paths.
  Segment bytes were not modified, transcoded or re-encoded.

Serve `master.m3u8` and `playlist.m3u8` as `application/vnd.apple.mpegurl`, then
load the master with the pinned HLS.js build used by the browser smoke test.
No external media request is needed during playback tests.

`index.m3u8` is the equivalent media playlist for the browser test's intercepted
`/api/media` response. Its segment URI uses the isolated `/__test_hls/` route
so it works regardless of the protected media endpoint's URL and query string.
