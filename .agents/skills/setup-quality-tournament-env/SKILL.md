---
name: setup-quality-tournament-env
description: >-
  Set up the local environment for quality-tournament wizard verification —
  dev stack startup, dev Clerk login (via clerk-dev-signin-token), admin gate grant in
  local Postgres, agent-browser connection, and evidence capture
  (screenshots + ffmpeg screen recording; agent-browser record drops the
  session). Sub-skill of verify-quality-tournament-wizard-ui.
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
non-admins to `/`. The check reads `users.is_admin` for the signed-in
Clerk user from the local Postgres DB, cached for 60s.

```bash
# Get the signed-in Clerk user id
agent-browser eval "window.Clerk?.user?.id"

# Grant admin to this already-synced local user.
bun run db:test-user --user-id <clerk_user_id> --admin true
```

Wait 60+ seconds for the `is-admin-v2` cache entry to expire before
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
