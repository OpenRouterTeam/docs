---
name: testing-speech-take-list
description: Browser-test the speech benchmark gallery (SpeechTakeList, waveform decode queue) in Storybook — story IDs, how to build fetchable local audio fixtures, and how to prove bounded fetching with resource timings (including the 250-entry buffer trap).
---

# Testing the speech take gallery (SpeechTakeList)

Component: `projects/web/app/[locale]/(home)/benchmarks/explore/SpeechTakeList.tsx`
plus `speech-take-peaks.ts` (fetch + `OfflineAudioContext.decodeAudioData`)
and `speech-take-peak-queue.ts` (URL-deduplicated, max-2 job queue; the
component only requests a card's peaks once it is near the viewport or playing).

The live route `/benchmarks/media/speech` is flag-gated and needs arena
speech data, so Storybook is the practical surface.

## Storybook

- `bun run storybook` from repo root -> http://localhost:6006.
- Open stories directly in the iframe so the story fills the window:
  `http://localhost:6006/iframe.html?id=<story-id>&viewMode=story`.
  Story IDs: `benchmarks-speechtakelist--default`, `--mobile`.
- The two-column grid is the `lg` breakpoint; a maximized Chrome (>=1024px)
  shows two columns. For 390px, resize the window (e.g. `xdotool` /
  `wmctrl -r :ACTIVE: -e 0,0,0,390,900`) rather than using the device
  toolbar, and assert `document.documentElement.scrollWidth <= innerWidth`.
- Repo fixtures use remote/unfetchable audio URLs, so decode never succeeds
  in the committed stories (cards stay on the flat seek bar). To test real
  decode you need a fetchable-audio story (see below).

## Fetchable audio fixtures for decode tests

Storybook serves `projects/web/public/` at `/`, so put clips in a
temporary `takes/` folder under it and reference them as `/takes/clip-a.wav`.
Generate with ffmpeg; make them loud enough that the waveform is visibly
non-flat (quiet sine tones look flat):

```
ffmpeg -f lavfi -i "sine=frequency=440:duration=6" -af "volume=8dB,tremolo=f=0.5:d=0.9" -ar 16000 clip-a.wav
```

Include: one card with stored `peaks` (renders immediately), several
missing-peak cards with distinct durations (so Length sorting is
observable), a 404 URL (`/takes/does-not-exist.wav`) and a non-audio file
served as `.wav` (decode failure). Write a temporary
`SpeechTakeList.decode.stories.tsx` and delete it (and the `takes/` folder)
before handing back — they are test instrumentation, not product changes.

## What to assert

- Waveform present: `svg[aria-label$=": waveform"]`; flat bar: the
  `button[aria-label^="Seek within"]` has no `<svg>` child.
- Real vs fake waveform: read the `<path d>` and check the y-range varies.
- Shared player: exactly one `audio[preload="none"]`. Extra
  `audio[preload="metadata"]` elements are duration probes, not players —
  don't count them as a regression.
- Seek: click the active card's waveform at ~50% and read
  `audio.currentTime / audio.duration`.
- 404 clip playback: `audio.error.code === 4` is expected; the button must
  return to `Play ...` with no uncaught console error.

## Proving bounded fetching

Use `performance.getEntriesByType('resource')` filtered to `/takes/` and
`initiatorType === 'fetch'` (the `<audio preload=metadata>` probes show up
as initiatorType `audio`/`media` with 206 — exclude them). Compute max
concurrency with a sweep over `startTime`/`responseEnd`, and duplicates by
counting URLs.

Trap: the resource-timing buffer defaults to 250 entries and Storybook's
module graph alone is ~250 requests, so entries created after the initial
load (e.g. the fetches triggered by scrolling) are silently dropped. Run
`performance.setResourceTimingBufferSize(5000)` right after load, before
scrolling, or the post-scroll check will falsely show no new fetches.
Cross-check with DevTools Network (filter `takes`, Fast 4G + Disable cache
makes the <=2 staircase visible in the waterfall).

Expected with a 200px rootMargin at desktop height: only the rows in view
plus the next row fetch at mount; scrolling to the bottom fetches the rest,
each URL exactly once, never more than 2 in flight.

## Testing cross-origin (prod CDN) clips and the CORS/cache interaction

Local `/takes/` fixtures are same-origin and cannot surface CORS bugs. To
reproduce the prod request path, write a TEMPORARY story whose takes point
at real `https://model-assets.openrouter.ai/model-examples/...` URLs with
`peaks: []` and `audioDurationMs: null` (delete it before handoff; never
commit — the CDN URLs are stable but are not a fixture we own).

The CDN only returns `access-control-allow-origin: *` when the request
carries an `Origin` header (`curl -sI URL` vs `curl -sI -H 'Origin: http://localhost:6006' URL`).
A no-CORS `<audio>` load therefore caches a header-less copy that a later
CORS-mode `fetch()` of the same URL rejects with "No
'Access-Control-Allow-Origin' header" — the card stays flat while Length
still resolves (the probe itself works). Both `<audio>` elements must carry
`crossOrigin='anonymous'`; check `audio.getAttribute('crossorigin')`.

How to test it honestly:

- Keep DevTools "Disable cache" OFF (the bug is a cache interaction) and
  use a **new incognito window per run** (`ctrl+shift+n`) for a cold cache;
  close it (`ctrl+shift+w`) between the fixed / control / restored runs.
- The `browser_console` tool does NOT capture browser-emitted CORS errors —
  open DevTools > Console (F12) and read/screenshot them, or count
  `performance.getEntriesByType('resource')` fetch entries with
  `responseStatus !== 200` (cached failures may not appear there either).
- In the Network panel, a fetch that failed from the primed cache shows
  "Provisional headers are shown" with no response headers; the `media`
  probe row shows a 206 without any `access-control-allow-origin`.
- Control run: back up `SpeechTakeList.tsx`, delete the two
  `crossOrigin='anonymous'` lines, reload; restore with `cp` and confirm
  `git diff` is unchanged.
- With DevTools docked the viewport is short, so only the first rows request
  a decode; scroll to the bottom before counting flat cards.

## Devin Secrets Needed

None — Storybook runs fully offline (the prod-CDN story needs outbound
HTTPS to model-assets.openrouter.ai).
