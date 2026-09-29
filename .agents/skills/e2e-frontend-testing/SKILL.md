---
name: e2e-frontend-testing
description: >-
  Record and review frontend e2e tests for changes to
  projects/web, projects/mission-control, or any UI
  component, page, or style.
user-invocable: true
---

# Frontend E2E Testing

Use this skill for frontend changes: `projects/web/`,
`projects/mission-control/`, or any UI component / page / style.
See [e2e-testing](../e2e-testing/SKILL.md) for when to test and
how to determine scope.

> **CRITICAL RULES — read these first:**
>
> 1. **React to what recordings show.** If a video recording
>    reveals bugs (errors, broken UI, stuck states), you MUST
>    fix those issues and re-record. Never send a video that
>    shows failures as your final deliverable.
> 2. **Never skip testing silently.** If you cannot test (env
>    issues, missing credentials, build failures), tell the user
>    immediately and ask for help. Do NOT report "PR is ready"
>    when testing was skipped or failed.

## Setup

Start the app and sign in using [local-dev-env](../local-dev-env/SKILL.md). Use the actual web origin from Tilt. For auth or onboarding tests that need a new identity, use the optional [isolated-user workflow](../local-dev-env/references/isolated_users.md).

For production-bundle verification, serve the build with
`bun run --cwd projects/web start`, not `next dev`. Copy a prebuilt artifact
into the web project's Next output directory rather than symlinking one from
outside the monorepo,
and record its BUILD_ID. If Clerk stays `loaded=false` and chat or sign-in
renders a skeleton, reproduce the same route on a baseline build with the same
origin and environment before attributing it to the change. That establishes a
pre-existing blocker, not coverage of the hidden controls; never substitute
fake auth.

When serving an existing production artifact with `next start`, verify API routing separately: `DEV_USE_PROD_FRONTEND_API=true` alone does not enable the frontend-API proxy (`packages/frontend/middlewares/utils.ts` gates it on a dev server or Vercel preview), and prerendered cards can look live while client reads return 404. Protected PR previews accept the existing `VERCEL_AUTOMATION_BYPASS_SECRET` as a request header; never put the value in a URL or recording.

For public Documentation/FAQ checks, an API-only edge proxy does not serve Mintlify `/docs/*`. Separate local click-routing evidence from production docs destination evidence. If anonymous command-line requests are blocked, verify the rendered destination and navigation response status in the browser instead.

For FAQ SSR parity, parse actual JSON-LD scripts and real accordion markup, not escaped RSC payloads. A closed server-rendered trigger may omit `aria-controls`, while the panel still references it through `aria-labelledby`. Compare that panel's text with the expanded browser answer and FAQPage text.

Measure `innerWidth` and document scroll width on each surface independently. Reusing a pill list in a maker or Lab flex container can overflow even when the same list fits a model page, and maker pages may already overflow on `main` before the change, so measure the same page on production or the base branch for a baseline. Capture the exact viewport with every observation.

For a lazy-chunk assertion on the newsletter form, use `/chat`: footer routes such as `/models` load the form eagerly by design. Match the implementation module, not a chunk that merely names the dynamic import. Before attempting popup triggers, read the Statsig gate and the capture-units response, since a 200 can hold only disabled units with zero rollout, and check the console for `newsletter_turnstile_site_key_missing`. Never override eligibility to claim live coverage.

For `force-static` ISR pages that fetch their own origin during build, check
whether the origin was listening at build time. A failed build-time fetch
bakes fail-open HTML into the prerender. After the route's `revalidate`
window passes, request it to trigger regeneration, then reload after that
regeneration completes. Reproduce on the merge-base build before attributing
the state to the PR. Pass only once real rows render.

For public-route-only checks, `TILT_PROFILE=lean tilt up --stream -- --lite`
(see `Tiltfile`) runs local web with production public frontend-API reads.
Wait for `uiresource/web`; no local database or login is needed for those
reads. Do not mistake visible fallback cards for successful backend coverage:
the home page's `app/[locale]/(home)/actions.ts` uses a private featured-models
route that lite mode may not serve. Report that fetch separately from the
visible navbar/hero/cards, and use the full frontend-API stack to verify it.

When running web alone with `bun run dev web`, set `DEV_USE_PROD_FRONTEND_API=true` before startup; otherwise public catalog reads may target absent local workers and `/sitemap.xml` can return 500 before app selection runs (`packages/frontend/middlewares/utils.ts`). Local sitemap locs use the local origin: compare parsed pathnames to production, and exclude `/apps/category/` when counting app profile URLs.

## Browser Tool Selection

Before asserting a hover-only visual defect (for example, the shared
`packages/frontend/components/CardCarousel` edge gradients), inspect
`matchMedia('(hover:hover)').matches` and `matchMedia('(pointer:fine)').matches`.
`:hover` can match while Tailwind's hover media query is disabled. Mobile
viewport emulation may reset these capabilities even after restoring desktop
dimensions; recheck before desktop hover tests, or run phone-width checks last.
Allow enter/exit transitions to settle before asserting opacity or clicking
through a closing dialog; an immediate screenshot can capture the fade itself.

Use whatever browser tool is available in your environment:

- **Playwright MCP** (Claude Code) — use `browser_navigate`,
  `browser_snapshot`, `browser_click`, `browser_type`, etc.
- **Built-in browser** (Devin) — use Devin's browser tool
- **Browser preview** (Cursor) — use the built-in preview

Do not assume a specific browser tool is connected.
Check what tools are available before proceeding.

When multiple agents attach to the same Chrome CDP endpoint, named
`agent-browser` sessions still share its tabs and viewport. Reserve the
browser exclusively for a recording, or use separate browser instances.
After clicking a model link, check whether it opened a new tab before using
Back; return to the original rankings tab when it did.

For deployed-site Playwright tests (`tests/web-e2e/`), credentials are injected from Infisical at `/tests/e2e`:

```bash
bun run --filter @openrouter-monorepo/test-web-e2e e2e
```

This command defaults to `https://openrouter.ai`; it does not target the local stack. `E2E_CLERK_USER` and `E2E_CLERK_PASSWORD` belong to the deployed Clerk tenant.

For local route smoke tests, use the runner that builds the production app, mints a development ticket, and provisions local fixtures:

```bash
cd tests/web-e2e && bun run e2e:local
```

It requires the local stack and an authenticated Infisical session. `BASE_URL` defaults to `http://localhost:3000`; set it to the local web origin when ports differ. The runner temporarily disables Tilt's web dev server while it builds and serves the app. Set `LOCAL_ROUTE_SMOKE_NEXT_PORT` to a free port if the default (web port + 1) is occupied.

`LOCAL_ROUTE_SMOKE_RUNS=3` repeats for flakiness. `LOCAL_ROUTE_SMOKE_WORKERS` defaults to 4. `LOCAL_ROUTE_SMOKE_BUILD=never` reuses an existing build, so use it only when that is the build under test. See `tests/web-e2e/scripts/run-local-route-smoke.ts` for options and result checks.

Gotchas the runner already handles, worth knowing when you script around it:
- The `/projects/web` Infisical path injects `NODE_ENV=development`; set
  `NODE_ENV=production` inside the `infisical run -- ...` command, not in
  the parent shell, or `next build` prerenders with development React.
- Clerk session tokens live 60s. A fresh Playwright context per test
  replays the Clerk handshake redirect on every navigation, which is slow
  and occasionally lands on `/sign-in`; navigation-only suites should
  share one signed-in context per worker (see
  `suites/smoke/all-routes-navigation.test.ts`).

## Sign In Flow (local manual browser testing)

1. Sign in with a [Clerk sign-in ticket](../clerk-dev-signin-token/SKILL.md), as described in local-dev-env.
1. Confirm the session is active.
1. Select **Personal** for personal-account tests, or the organization required by the test.

**Verify which context is actually active before asserting auth
behavior** — a restored session can come back with an org active,
which changes both the auth branch taken and the entity that owns
any written rows:

```js
window.Clerk.organization?.id; // null => personal context
```

Cross-check in Postgres with `select clerk_user_id, is_organization
from users where clerk_user_id = '<org_ or user_ id>'`. Org-owned
rows are keyed by the `org_…` id (e.g. `credits.clerk_user_id`), so a
write that appears to have done nothing to the personal account may
have correctly landed on the org.

To cover both paths in one session, switch with the account switcher
in the top-right nav (it lists **Personal** plus each org) instead of
scripting `setActive`, so the recording shows the switch.

## Record and Test

For public forms, wait for client hydration after reload before filling or
submitting (a settled auth control such as **Sign Up** is a useful signal).
Server-rendered inputs may be visible before their React handlers are ready.

For newsletter error/retry checks, distinguish malformed input (client
validation, no request) from valid syntax rejected by the backend. Choose
rejection fixtures using `packages/email/validation/is-autogenerated-email.ts`:
a short numeric suffix need not cross the bot-score threshold. Use a realistic
non-disposable address for success, verify `newsletter_subscribers.source`
and `newsletter_consent_events.event`, then delete only test consent events
before their subscribers (the foreign key restricts deletion).

For TanStack Query refocus timing, a tab switch in Chrome launched with
`--disable-backgrounding-occluded-windows` does not emit a visibility change.
Use `document.dispatchEvent(new Event('visibilitychange', { bubbles: true }))`
while the page is visible and annotate it as a synthetic trigger. The event
must bubble because query-core listens on `window`. Measure stale age from
the last response, not from navigation. Count query-layer fetches, not raw
Network entries: `Other`-initiator preloads pair with each fetch and appear
on baseline too.

> **Gotcha (Devin `agent-browser record`):** `record start` spins up a
> *fresh* browser context that does **not** carry the Clerk session, so it
> redirects to `/sign-in`. Start the recording first, re-consume a
> `clerk-dev-signin-token` ticket inside the recording context
> (`window.Clerk.client.signIn.create({ strategy: 'ticket', ticket })` +
> `setActive`), then navigate to the page under test.

1. Start a screen recording.
2. Navigate to each page or component affected by the diff.
3. Annotate key moments:
   - `type="setup"` for navigation and login steps.
   - `type="test_start"` with an `"It should ..."` description
     for each feature being verified.
   - `type="assertion"` with pass/fail result after checking
     each behavior.
4. Verify: no console errors, layout renders correctly, the
   feature works as intended.
5. Stop the recording.

## Video Review Loop (MANDATORY)

After stopping the recording, **review what happened**:

1. Check the recording summary — did any assertions fail?
   Did the UI show errors, stuck states, or broken layouts?
2. If **everything passed** — proceed to report.
3. If **anything failed or looked broken**:
   a. Identify the root cause from the recording + console.
   b. Fix the code.
   c. Push the fix.
   d. **Re-record from scratch** — go back to step 1.
   e. Repeat until the recording shows everything working.
4. **Never send a recording that shows failures** as your
   final deliverable. The video you share with the user must
   demonstrate the feature working correctly.

Common failure patterns to watch for:
- "Processing" spinner stuck for >30 seconds
- `ERR_NETWORK_CHANGED` in console (wait for Docker to
  stabilize, then retry)
- Toast errors like "Item Save Error"
- UI elements not rendering (missing components, null returns)
- API returning 500s (check cfw-api logs)
- With `agent-browser`, refresh refs after every interaction; dismiss fixed
  maintenance banners before clicking lower-page controls.
- Wait for a hydrated control (not just navigation completion) before a
  full-page screenshot; RSC pages can finish navigating while the grid is
  still a skeleton.
- For streamed not-found SEO checks, inspect raw HTML (Googlebot UA curl)
  and the hydrated DOM separately, and report the HTTP status separately
  from the visible not-found boundary: `notFound()` on a dynamic route
  streams `robots=noindex` into a 200 response.

## Comparing API vs UI

When validating that a server tool produces the same
output via the API and the UI:

1. Run the manual API test first — inspect the JSON output
2. Open the UI feature in the browser
3. Sign in and run the same operation
4. Compare: models used, completion content, annotations

## Report

- Send the video to the user as an attachment.
- Include screenshots of affected pages in the PR description.
- If issues are found, fix them and re-record.
- **Do NOT report the PR as "ready" if the video shows
  failures.** Either fix and re-record, or clearly tell the
  user what is broken and why you could not fix it.

---

## Chatroom / Playground Testing

When changes affect the chatroom or playground features
specifically, follow these additional steps.

### Local Login

Sign in with a [Clerk sign-in ticket](../clerk-dev-signin-token/SKILL.md), as described in [local-dev-env](../local-dev-env/SKILL.md#sign-in).

### Known Issues

**Browser `ERR_NETWORK_CHANGED` during Docker startup:** wait for the required resources to become ready, then reload. For persistent failures, inspect Docker network events with `docker events --filter type=network`.

**Chat requests fail while the page loads:** check `tilt logs api` and the API readiness result. Resolve the reported service or credential failure before treating the UI interaction as an end-to-end pass.

### Testing System Prompt

1. Navigate to `/chat` on the web origin shown by Tilt
2. Sign in using local-dev-env if needed
3. Select a model (click on a model icon in the flagship
   models section)
4. Click the three-dot menu (`:`) next to the model name
   in the tab bar
5. The character config dialog shows the "System Prompt"
   section
6. Verify the prompt contains:
   - Model name and author
   - Frozen date line
   - Formatting rules block

### Testing Server Tools

The `getServerTools()` function in `prepare-api-request.ts`
constructs the tools array. To verify:
1. The datetime tool (`openrouter:datetime`) is always included
2. Web search tool is conditionally included based on
   `isWebSearchEnabled`
3. To inspect the actual request payload, set up a fetch
   interceptor in the browser console before sending a message

### Key Chatroom Files

- System prompt: `projects/web/features/playground/definitions/defaults.ts`
- API request builder: `projects/web/features/playground/state/chat/helpers/send-to-character/prepare-api-request.ts`
- Model info types: `packages/models/model-info/index.ts`
- Model constructor: `packages/routing/models/constructor.ts`

---

## Key References

### Multilingual browser setup

Before recording locale UI (for example the navbar language picker), verify
native labels visually, not only in the DOM. On Linux, check CJK font coverage
with `fc-list :lang=zh`, `fc-list :lang=ja`, and `fc-list :lang=ko`, and install
`fonts-noto-cjk` if any is empty. Chrome keeps its missing-glyph fallback after
installation, even across reloads and new tabs. Restart Chrome at the process
level (`chrome://restart`) while preserving its user-data directory, then
confirm glyphs and authentication before recording.

### Local feature-flag and responsive UI verification

The development panel is available to local development users. Open it with
`Ctrl+.` (`Cmd+.` on macOS), choose **Feature Flags**, and filter by the Statsig
gate name before selecting **On**, **Off**, or **Default**. Confirm the evaluated
value as well as the override selection. These controls are implemented in
`projects/web/components/dev-panel/FeatureFlagsPanel.tsx`.

When switching locales, re-inspect accessible names: the developer panel is
translated too (for example, `Search flags…` becomes `Flags suchen…` in German).
Do not reuse an English-only search or button locator after locale navigation.

If native computer control is unavailable and CDP fallback is authorized, keep
one persistent browser connection while using mobile device metrics. Disconnecting
between actions can restore Chrome's minimum physical window width. Check
`innerWidth` and visually review the captured recording, not just screenshots.
Auto-edited recordings may compress CDP-only actions excessively; retain the raw
recording and render timestamped annotations onto a real-time copy when necessary.

### Newsletter popup artwork checks

The Dev Panel gate override also works signed out, so an `everyone` audience capture unit needs no Clerk login. Seed real `newsletter_popup_config` rows with path-specific `included_paths` so desktop/mobile and fallback fixtures coexist without editing rows mid-recording. The public capture-units API response and the client query are each cached for 60 seconds. Between presentations, clear only the newsletter-prefixed local/session storage keys (see `projects/web/components/newsletter/newsletter-storage.ts`), then reload. Wait for the dialog opening animation and check `img.complete && img.naturalWidth > 0` before screenshotting. URL-without-alt fixtures cannot be tested through the API because the creative schema rejects them and the serializer nulls malformed stored creative. Submission needs `NEXT_PUBLIC_NEWSLETTER_TURNSTILE_SITE_KEY` and matching backend Turnstile configuration, so artwork-only checks do not prove it.

## Related Skills

- [`e2e-testing`](../e2e-testing/SKILL.md) — when to test, scope determination, critical rules
- [`local-dev-env`](../local-dev-env/SKILL.md) — local stack setup, service readiness, and inference tracing
