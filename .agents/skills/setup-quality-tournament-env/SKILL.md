---
name: setup-quality-tournament-env
description: Set up the local environment for quality-tournament wizard verification (dev stack, dev Clerk login, admin gate grant, agent-browser, screenshot and ffmpeg evidence capture). Sub-skill of verify-quality-tournament-wizard-ui.
allowed-tools: Bash,Edit,Read,Write,Browser
user-invocable: true
---

# Set Up the Quality Tournament Environment

Get the local dev stack, an admin-gated signed-in session, and evidence
tooling ready for quality-tournament verification. This is Phase 1 of
[`verify-quality-tournament-wizard-ui`](../verify-quality-tournament-wizard-ui/SKILL.md).

## Prerequisites

Start with [local-dev-env](../local-dev-env/SKILL.md):

```bash
cd /path/to/openrouter-web
bun run dev:up
tilt wait --for=condition=Ready uiresource/api uiresource/api-kv-cron uiresource/frontend-api --timeout=300s
```

Use the web URL reported by Tilt and the seeded development login from local-dev-env. Browser automation can use [clerk-dev-signin-token](../clerk-dev-signin-token/SKILL.md). For an isolated identity, follow [isolated users](../local-dev-env/references/isolated_users.md). Seed generations for the signed-in Clerk user; the admin grant and generation fixtures must target that same user ID. The `/tests/e2e` password credentials belong to the deployed site.

Confirm with `agent-browser eval "window.Clerk?.user?.id"`.

Connect agent-browser once per session:

```bash
agent-browser connect 29229
```

## Admin gate

`labs/quality-tournament/page.tsx` calls `getAdminForPage()` and redirects
non-admins to `/`. The check resolves the staff flag for the signed-in
Clerk user through the cookie-authenticated `/api/frontend/v1/private/users/current`
route (cfw-frontend-api reads `users.is_admin` from the local Postgres DB),
cached for 60s.

```bash
# Get the signed-in Clerk user id
agent-browser eval "window.Clerk?.user?.id"

# Grant admin to this already-synced local user.
bun run db:test-user --user-id <clerk_user_id> --admin true
```

Wait 60+ seconds for the admin gate cache to expire before
reloading, then confirm you stay on the page:

```bash
agent-browser open http://localhost:3000/labs/quality-tournament
agent-browser get url   # must still be /labs/quality-tournament
```

## Capturing evidence

For every check: `agent-browser snapshot` to read state, then
`agent-browser screenshot /path/file.png`. Embed the screenshots in the
PR description with what each one proves.

**Do not use `agent-browser record` for these pages.** It spins up a
fresh browser context that drops the Clerk session, so the recording
just shows the signed-out redirect to `/` (and it can clear the session
on the live CDP context too). Screen-record the X display instead, while
driving the already-authenticated context. Stop ffmpeg gracefully via a
FIFO (a SIGINT/SIGTERM leaves a VP9 `.webm` with `duration=N/A` and
scrambled frame timestamps):

```bash
mkfifo /tmp/ffctl
ffmpeg -y -f x11grab -framerate 12 -video_size 1600x1200 -i :0.0 \
  -c:v libx264 -preset veryfast -pix_fmt yuv420p -movflags +faststart \
  /tmp/qt-demo.mp4 < /tmp/ffctl >/tmp/ff.log 2>&1 &
exec 9>/tmp/ffctl          # hold the FIFO open
# ...drive the agent-browser flow with deliberate sleeps...
printf 'q' >&9             # graceful quit -> finalized, seekable mp4
exec 9>&-
```

Confirm `ffprobe -show_entries format=duration` reports a real duration
before attaching.

## Notes

### Synthetic source fixtures

Prefer real locally seeded generations. If using a temporary synthetic source for a narrow UI check, keep its ID consistent across the initial transaction list, prompt previews, filtered-generation IDs, and prompt hydration. A visible row alone may still be unselectable: missing/non-replayable previews exclude it, and a zero filtered-generation count sets the selection limit to zero. Prevent background query refresh from replacing the temporary row while testing, then restore every fixture edit. Label source data as synthetic in evidence. Do not mock judge responses when claiming live judging.

For skipped-judging progress regressions, stagger at least two replay shards: return a media comparison first and a text comparison later. Verify the driver `progressByPhase.judging` snapshots across both arrivals and completion, not only the final count. The redesigned progress bar can count evaluated prompt rows rather than judge calls. Label any read-only diagnostic overlay separately from product UI and restore its subscriber afterward.

For Pairwise count checks, distinguish comparison tasks from underlying judge requests: each pair uses forward and position-swapped calls. The live summary multiplies completed comparison tasks by `JUDGE_CALLS_PER_PAIR`. The saved summary uses stored judgments. An unavailable judge can therefore produce one completed task, two displayed live calls, zero stored judgments, and zero saved calls. Capture the run plan, final judging progress, and replay shard count before diagnosing a count mismatch. Human judging uses no model calls. Verify pending and completed saved runs separately, including retained picks after reopening.

### Decisions-backed judges

Before spending tokens on a replay, verify the configured Decisions model exists in the local catalog, has Decisions output modality and a routable endpoint, and that the catalog has been published to local KV. The usual CSV seed may not yet include a recently launched model. Rerunning it cannot create missing entries. Start `cfw-decisions-api` on `CFW_DECISIONS_API_PORT` (default 8824) and retain its logs separately from Next/Tilt output. A response saying `Model <slug> does not exist` is catalog resolution failure, not proof of a missing provider key or failed provider authentication.

For a successful UI run, correlate the fresh timestamp in `services/dev-fs-logs/.logs/default/decisions/fetch-request.log` with `submit.log` and `transaction-attempt.log`. Export only explicit safe fields (timestamp, provider, model, upstream URL, question/answer counts, status, success, retries). Tilt can replay older worker lines with new ingestion timestamps, so its `--since` filter alone is not sufficient to identify the current call. Three Jev criteria produce four questions including the fixed overall choice. Validate recording duration and representative frames with ffprobe/ffmpeg before sharing: a processed recording can be truncated even when raw segments retain the complete flow. Recover raw segments rather than rerun paid evaluations.

#### Devin Secrets Needed

- Existing local-dev/Clerk credentials described by the linked setup skills.
- For a TypeSafe-backed judge, `TYPESAFE_AI_API_KEY` must be available to the Decisions worker. Confirm presence without printing its value.

- The local `cfw-api` server uses `sk-or-v1-unlimitedkey` for auth — the
  tournament's SDK calls are authenticated via the Clerk session cookie,
  which the Next.js server proxies to cfw-api.
- Tournament runs are stored in the browser (zustand → IndexedDB, key
  `or-quality-tournament-v1`); switching browsers or clearing storage loses
  the run history.
- The "Suggest" button for candidate models uses the seeded model DB — it
  works when local Postgres has models seeded (`bun run db:reset`).
- Image-generation prompts trigger the Image modality detection path
  (`detectAggregateModality` in `suggest-modality.ts`), which affects the
  "Suggest" recommendations.
- Video-generation models (Seedance) have no dedicated modality signal on
  `PublicTransaction` — video is detected by model metadata, not transaction
  fields.
