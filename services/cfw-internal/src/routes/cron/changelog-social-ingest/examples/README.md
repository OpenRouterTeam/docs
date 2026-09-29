# Changelog ingestion — worked examples (DEV-677 / DEV-678)

This directory contains the exact inputs and expected outputs of the
`CHANGELOG_SOCIAL_INGEST` cron task (`services/cfw-internal/src/routes/cron/changelog-social-ingest/`),
one example per event source. `transform.test.ts` asserts the fixtures map
to the expected events/posts, so the examples can never silently drift.

`api-changelog-page.mdx` is a verbatim two-block excerpt of the real generated
changelog page (`projects/docs/changelog.mdx`) — `<Update label tags rss>`
blocks of OpenAPI spec-diff bullets — so the fixtures exercise the real input,
not an idealized one. Because the content is machine-generated, these
candidates are curation-mandatory: the LLM curator decides whether a diff
block carries an announceable feature.

## Pipeline per source

| # | Source (fixture input) | Normalized event | Post row (`social_posts`) | Render request |
|---|---|---|---|---|
| 1 | `typescript-sdk-release.json` (GitHub release `OpenRouterTeam/typescript-sdk@v0.4.0`) | `typescript-sdk@0.4.0` "Streaming tool calls" | status `draft`, copy from template | `FeatureAnnouncementSquare`, language `typescript` |
| 2 | `go-sdk-release.json` (release `OpenRouterTeam/go-sdk@v1.2.0`) | `go-sdk@1.2.0` "Streaming responses" | status `draft` | same composition, language `go` |
| 3 | `python-sdk-release.json` (release `OpenRouterTeam/python-sdk@v2.0.0`) | `python-sdk@2.0.0` "Async client" | status `draft` | same composition, language `python` |
| 4 | `api-changelog-page.mdx` (generated changelog page) | one `api_changelog` event per `<Update>` block (`api-changelog@2026-07-29`, `…@2026-07-28`; same-day repeats get `#2`, `#3` ordinals), **no code** | status `draft` | same composition; `code`/`language` null without a fence |

`expected-events.json` shows the normalized `FeatureEvent` for each input;
`expected-posts.json` shows the resulting `social_posts` insert payload
(copy + composition props) and the `POST /render` body sent to the
remotion-render service.

Two properties the fixtures lock in:

- **No markdown reaches the video.** Inline links, code spans, and emphasis are
  stripped, and long descriptions are truncated on a word boundary with an
  ellipsis — never mid-word or mid-URL.
- **No borrowed code samples.** An event gets only a fence from its own
  block/notes, and an event with no fence of its own carries `code: null`,
  which renders a text-only card. A snippet from a different feature would
  read as a real example, which is worse than no panel.

## End-to-end walkthrough (example 2, Go SDK)

1. **Ingest** — the cron task lists releases on `OpenRouterTeam/go-sdk`,
   normalizes `v1.2.0` into the event `go-sdk@1.2.0`, and the dedupe check
   (`social_posts.source_ref` unique index) skips it on later runs. Events are
   validated against `featureEventSchema` before anything is written.
2. **Post row** — a `social_posts` row is inserted with status `draft`
   and the generated copy:

   > Streaming responses is now live in the Go SDK v1.2.0
   >
   > Consume SSE streams with a range-based iterator.
   >
   > Docs → openrouter.ai/docs

3. **Render** — the task POSTs `expected-posts.json → [1].renderRequest` to
   the remotion-render service, then flips the row to `rendering` **only once
   `render_job_id` is persisted**. If either step fails the post stays `draft`,
   where an operator can regenerate it — a row in `rendering` with no job id
   could never be reconciled, so the cron sweeps any such row to `failed`.
   (This exact request was rendered end-to-end during development; the output
   was an on-brand 1080×1080 mp4.)
4. **Reconcile** — on the next hourly run the task polls
   `GET /render/:id`, and on `done` writes the durable `video_url` (plus its
   mint time) and returns the post to `draft` — or back to `scheduled` if it
   still has a future schedule — where it appears in the Mission Control
   social-posts queue for review, scheduling, and one-click sharing (DEV-681).
    If the job record is gone (the render service restarted), the task re-signs
    `<render_job_id>.mp4`: present means the render did finish, genuinely absent
    means `failed` (marked immediately with no age check).
