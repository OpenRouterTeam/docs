# E2E Test Review Guidelines

Checklist for writing, editing, and reviewing E2E tests. Each
rule addresses a pattern that has repeatedly broken the scheduled
nightly suite.

---

## 1. Never assert exact LLM output

Models are non-deterministic. Exact-match assertions on
generated text, tool arguments, or token counts **will** flake.

```typescript
// BAD — flakes when model rephrases
expect(args.ticker).toBe('ACME');

// GOOD — structural check
expect(args.ticker).toBeTypeOf('string');
expect(args.ticker.length).toBeGreaterThan(0);
```

```typescript
// BAD — some providers return 0 for cached/reasoning tokens
expect(usage.reasoning_tokens).toBeGreaterThan(0);

// GOOD — tolerate provider-specific zero values
expect(usage.reasoning_tokens).toBeTypeOf('number');
expect(usage.reasoning_tokens).toBeGreaterThanOrEqual(0);
```

Use `assertMessagesResponseStructure` or
`assertSuccessfulCompletion` for response validation — they
check shape without coupling to specific content.

---

## 2. Tolerate provider availability changes

Models get disabled, endpoints go down, providers return
unexpected status codes. Tests must not hard-fail on provider
outages.

```typescript
// BAD — hard failure when provider is down
const result = await callApi('/api/v1/embeddings', {
  body: { model: 'nvidia/some-model', input: 'hello' },
});
assertOk(result);

// GOOD — skip gracefully when endpoint is unavailable
const result = await callApi('/api/v1/embeddings', {
  body: { model: 'nvidia/some-model', input: 'hello' },
});
const PROVIDER_UNAVAILABLE = [404, 502, 503];
if (
  isErr(result) &&
  PROVIDER_UNAVAILABLE.includes(result.error.status)
) {
  ctx.skip();
  return;
}
assertOk(result);
```

When pinning tests to a specific model, prefer models from
`TestModelGroups` — they are maintained centrally and updated
when models are deprecated or replaced.

---

## 3. Fix slow tests before bumping timeouts

When a test times out, investigate the root cause first:

1. **Reduce work** — can the test use a smaller payload,
   fewer models, or a single round-trip instead of many?
2. **Parallelize** — can independent assertions run
   concurrently with `Promise.all`?
3. **Mock the slow part** — if the slowness is upstream
   (provider cold-start, cache population), can you stub
   it for the CI path?

Only bump the timeout as a **last resort**, and leave a
comment explaining why the default isn't enough:

```typescript
// Image-offloading round-trip requires provider download
// + base64 re-encode; 30s measured p99 in CI.
await pollUntilCached(cacheKey, { timeout: 30_000 });
```

---

## 4. Keep Zod schemas in sync with the API

When the API adds a new field or enum value, the E2E test
schemas must be updated. Schema drift is the single most
common cause of mass failures: one enum value missing from a
shared schema (e.g., a new `service_tier`) fails every test
that parses that response.

If you are adding a new API feature:

- Update the relevant Zod schemas in `tests/e2e/api/shared/`
- Make new optional fields actually optional (`.optional()`)
- Add new enum values to existing enums

If you are reviewing a PR that changes API response shapes,
check whether E2E schemas need a corresponding update.

---

## 5. Validate tests run in the scheduled CI environment

The scheduled nightly E2E suite runs with `TEST_ENV=staging`
against production. It does **not** have:

- Local services (cfw-tts-api, cfw-stt-api, dev-fs-logs)
- Regional proxy env vars (`BRD_PROXY_PASS`,
  `CF_COMPLIANCE_API_TOKEN`, `EU_PROBE_API_KEY`, etc.)
- Cloudflare AI bindings (`CF_API_TOKEN`)

Before merging a new test into `tests/e2e/`:

1. **Check env var dependencies.** If your test needs env vars
   not in the CI workflow, either add them to the workflow or
   gate the test with `describe.skipIf(!process.env.MY_VAR)`.
2. **Check service dependencies.** If your test hits a local
   service (e.g., `127.0.0.1:8791`), it must skip in remote
   envs or use the staging equivalent.
3. **Check import paths.** Ensure any cross-package imports
   have the export registered in the source package's
   `package.json` exports map.

---

## 6. Do not leave the E2E user in a dirty state

The smoke and VR test suites share a single Clerk account
(`e2e@openrouter.ai`). The `global-setup.ts` authenticates
once and every test reuses that session.

- **Guard expected state in `beforeAll`/`beforeEach`.**
  Validate preconditions (e.g., correct org context, default
  settings) before running tests. Fail fast with a clear
  message instead of chasing confusing downstream failures.
- **Never switch the E2E user's org context** during a test
  without switching it back. The session persists across runs.
- **Do not change account settings** (display name, email,
  org membership) as part of a test without reverting.
- If a test *must* modify account state, restore the original
  state in an `afterAll` or `afterEach` hook — and validate
  the precondition in a `beforeAll` so the next suite fails
  fast if cleanup was missed.

A session left in an org-member context breaks every suite that
assumes the default account state, all at once.

---

## 7. SSE/streaming assertions: filter protocol extensions

OpenRouter may add SSE events that are not in the base OpenAI
or Anthropic streaming spec (e.g., `response.keep_alive`
heartbeats). Tests that validate streaming protocol compliance
should filter or tolerate unknown event types.

```typescript
// BAD — breaks on any new SSE event type
for (const event of events) {
  expect(KNOWN_EVENTS).toContain(event.type);
}

// GOOD — filter to events you care about
const contentEvents = events.filter((e) =>
  KNOWN_EVENTS.includes(e.type),
);
```

When asserting on accumulated stream output, prefer collecting
from deltas rather than relying on SDK helpers like
`finalResponse().output_text` which may not handle protocol
extensions. See `tests/e2e/api/shared/stream-parser.ts`
(`parseStream`, `assembleStreamedMessage`) for the canonical
delta-collection pattern.

---

## 8. Visual regression: mask dynamic content

VR snapshots break whenever dynamic content changes between
runs. Mask elements that are expected to change:

- Model counts, prices, dates, timestamps
- User-specific data (credits, usage numbers)
- Third-party embed content

Use `page.evaluate` to replace dynamic text with stable
placeholders before taking snapshots. See existing masking
patterns in
`tests/web-e2e/suites/visual-regression/dashboard-pages.test.ts`
(threshold + `waitForVisualStability`) and
`tests/web-e2e/suites/visual-regression/public-pages.test.ts`
(mask examples for model lists).

When a UI change intentionally updates the page, refresh the
baseline in the same PR — don't leave it for the nightly run
to catch.

---

## 9. Smoke tests: assert on stable selectors

Smoke tests that check for page headings or specific text are
brittle when UI copy changes. Prefer:

- `data-testid` attributes over text content matchers
- Role-based selectors (`getByRole('heading')`) over exact
  string matches
- Flexible matchers (regex, `toContainText`) over exact
  equality

When a PR changes page copy or component structure, update the
affected smoke tests in the same PR.

---

## Quick self-check before merging E2E changes

- [ ] No exact-match assertions on LLM-generated content
- [ ] Provider outages handled gracefully (skip, not fail)
- [ ] Timeouts are generous for async/multimodal operations
- [ ] Zod schemas match current API response shapes
- [ ] Test works with `TEST_ENV=staging` (no local-only deps)
- [ ] E2E user state is cleaned up after the test
- [ ] Streaming tests tolerate unknown SSE event types
- [ ] VR baselines refreshed if UI changed
- [ ] New env var dependencies documented or gated

---

## 10. Audit Cloudflare version pinning coverage

Requests that bypass the shared helpers or `config.headers.standard` do not
carry the Cloudflare override header and are not pinned. To find candidate
paths, run:

```bash
grep -RIlE 'createOpenRouter|new (OpenAI|Anthropic)|await fetch\(' \
  tests/e2e/api/frameworks tests/e2e/api/batches tests/e2e/api/responses \
  tests/e2e/api/messages tests/e2e/utils | sort | while read -r file; do
  grep -q 'config\.headers\.standard' "$file" || printf '%s\n' "$file"
done
```

Suites gated by `describe.skipIf(IS_REMOTE_ENV)`, including the three
`api/{chat-completions,messages,responses}/metadata/pipeline-guardrails.test.ts`
files that use `api/shared/pipeline-guardrail-suite.ts`, cannot run in the
production version-pinned workflow and are out of scope. The BYOK budget
helper is also out of scope because its only consumer requires
`RUN_BYOK_BUDGET_E2E=1` and a local environment. The
`api/compliance/openresponses.test.ts` suite is also out of scope because the
compliance CLI only receives the base URL, API key, and model, so it cannot
carry the override header and would report green against the 100% version.
