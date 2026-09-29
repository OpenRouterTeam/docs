# remotion-render (DEV-686)

API endpoint on the OpenRouter platform that renders Remotion videos.
Consumed by the changelog announcement flows (DEV-677 SDK changelogs,
DEV-678 API changelog) and later by the Mission Control editing loop
(DEV-681). The branded compositions live in `projects/remotion` (DEV-687).

Renders need Node + Chromium + ffmpeg, so this is a **container service**
(Cloud Run, like `services/gcp-bench-worker`) — never a Cloudflare Worker.

## API

All endpoints except `/healthz` require
`Authorization: Bearer $REMOTION_RENDER_AUTH_TOKEN`.

Auth **fails closed**: if `REMOTION_RENDER_AUTH_TOKEN` is unset, every route
except `/healthz` returns `401` rather than becoming public. The token is
therefore required to use the service at all, in every environment — in
production the server refuses to start without it.

### `POST /render`

Enqueue a render. Body:

```json
{
  "compositionId": "FeatureAnnouncement",
  "inputProps": {
    "sdkLabel": "TypeScript SDK",
    "version": "0.4.0",
    "featureTitle": "Streaming tool calls",
    "tagline": "Stream partial tool-call arguments as the model generates them.",
    "code": "const stream = client.callModel(...)",
    "language": "typescript"
  }
}
```

`compositionId` is `FeatureAnnouncement` (1920×1080) or
`FeatureAnnouncementSquare` (1080×1080). `inputProps` is validated against
the composition's zod schema from `projects/remotion/src/schema.ts` — that
file is the single source of truth.

Returns `202 { "job_id", "status_url" }`.

### `POST /still`

Enqueue a PNG still using the same request body, authentication, queue, and
registry-derived prop validation as `/render`. Add an optional integer `frame`
field. When omitted, the last frame is rendered. Completed jobs return
`image_url` or `/files/<id>.png` and are served as `image/png`.

### `GET /render/:id`

Job status: `{ job_id, status, progress, composition_id, error, ... }`.
`status` is `queued | rendering | done | error`.

When `done`, exactly one video location is returned:

- `video_url` — a 7-day signed read URL for the private GCS bucket, when
  `REMOTION_RENDER_GCS_BUCKET` is set (always in prod). Re-minted on every
  status poll, so expired links self-heal on the next reconcile.
- `file_url` — the local `/files/:id.mp4` path, returned **only** when there
  is no signed URL (local dev with no bucket). Once a render is uploaded the
  local copy is deleted, so `file_url` is omitted rather than handed out as a
  path that would always 404.

### `GET /files/:file.mp4` and `GET /files/:file.png`

Serve rendered output from the output dir. The extension selects
`video/mp4` or `image/png`. Primarily a local-dev/debug path — prod consumers
use signed GCS URLs.

### `GET /sign/:file.mp4` and `GET /sign/:file.png`

Mints a fresh 7-day signed read URL for an already-rendered object. Used by
the ingestion cron to refresh stored `video_url`s before they expire, and to
recover a completed render whose in-memory job record was lost.

Three outcomes, which callers must distinguish:

| Status | Meaning |
| --- | --- |
| `200` | Fresh signed URL. |
| `404` | The object is genuinely absent — the render is gone. The eviction-recovery sweep (`recoverEvictedRender`) marks the post `failed` immediately. The stale-URL refresh sweep (`refreshStaleVideoUrls`) only settles the post once it is older than the bucket retention window (90 days); younger 404s are treated as transient and retried. |
| `501` | No bucket is configured, so no signed URLs exist. Says nothing about the render; the cron retries rather than failing the post. |

### `GET /healthz`

Liveness probe.

## Jobs

Renders are CPU-bound and run one at a time through an in-memory FIFO queue
(`src/jobs.ts`); Cloud Run is pinned to a single instance
(`max_instance_count = 1`) so a status poll always reaches the instance that
owns the job. Jobs are ephemeral: durable state lives in the GCS object +
the `social_posts` row, and signed URLs are re-minted on every `/render/:id`
poll and by the cron's stale-URL refresh (`/sign/:file`).

## Develop

```bash
bun install
REMOTION_RENDER_AUTH_TOKEN=dev-token bun run --filter @openrouter-monorepo/remotion-render dev
```

`REMOTION_RENDER_AUTH_TOKEN` must be set locally too — auth fails closed, so
without it every route but `/healthz` returns 401. On first render the
service webpack-bundles `projects/remotion` (slow, ~30s); subsequent renders
reuse the bundle. Preview the compositions live with
`bun run --filter @openrouter-monorepo/remotion dev` (Remotion Studio).

## Security review

The Remotion security review requires every Remotion package to stay at or
above version `4.0.410`, which contains the fixes for the two critical CVEs.
The workspace currently pins Remotion to `4.0.491`, and
`bun run check:remotion-pin` enforces both the version floor and the resolved
versions in `bun.lock`.

Remotion Studio is a local-development-only component. Run it with
`bun run --filter @openrouter-monorepo/remotion dev`; it binds to localhost and
is never deployed or exposed to an untrusted network. The deployed service
renders server-side with headless Chromium in Cloud Run.

Browser-based rendering is explicitly not used. No end-user IP reaches the
vendor, and the dependency check rejects
`@remotion/player`, `@remotion/web-renderer`, and
`@remotion/canvas-capture` as declared workspace dependencies. Their
transitive presence in `bun.lock` is expected because Remotion Studio pulls
them in.

Luke Parke owns Remotion licence self-reporting. Render tracking already exists.

## Build & deploy

```bash
bun run --filter @openrouter-monorepo/remotion-render build  # dist/ + .remotion-bundle/
docker build -t remotion-render services/remotion-render
```

Production deploys go through the generic Cloud Run workflow —
**Actions → Deploy Cloud Run Service → `remotion-render`** — which calls the
`PROD-deploy` script here (build → push → `gcloud run services update`).
The Cloud Run service, its service account/IAM, the
`openrouter-social-videos` GCS bucket (private; signed read URLs), and
the Infisical→GSM sync of `AUTH_TOKEN` are terraformed in `infra/` (mirrors
`services/auth/infra`); apply that once before the first deploy.

## Consumers

- **cfw-internal `CHANGELOG_SOCIAL_INGEST` cron** (hourly, `:42`) — ingests
  SDK releases + API changelog into `social_posts` and drives renders
  (`src/routes/cron/changelog-social-ingest/`).
- **Mission Control → Admin Utils → Social Posts** — review/queue/schedule/
  share posts, chat-back edit thread, and manual video regeneration
  (`projects/mission-control/app/admin-utils/social-posts/`).

Both authenticate with the same `AUTH_TOKEN` bearer secret
(`/services/remotion-render` in Infisical).

## Local dev via Tilt

The full social-posts flow is wired into the root Tiltfile. All three
resources are manual-start:

```bash
tilt up
tilt trigger remotion-render   # this service, on :8811
tilt trigger mission-control   # UI on :3001, pre-wired to the render service
tilt trigger internal          # cfw-internal on :8794 (ingest cron + manual trigger)
```

The dev bearer token is `dev-token` and is threaded into all three
automatically.

## Follow-ups (not in this PR)

- Job persistence across restarts
- Datadog monitors for render failures
