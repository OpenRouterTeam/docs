# Fixtures Agent Guidelines

## Fixtures vs snapshots

Fixtures and snapshots go hand in hand — one pins each side of the
pipeline:

- A **fixture** is the *input*: a captured raw upstream provider
  payload (provider-native SSE stream or JSON body), checked in under
  `fixtures/<provider>/`. It pins what the provider actually sends.
- A **snapshot** is the *expected output*: the recorded result of
  piping that fixture through `router.submit` in a test
  (`toMatchSnapshot()`, stored in the test's `__snapshots__/` dir). It
  pins what OpenRouter emits for that input.

Together they make any adapter/skin transform change visible as a
snapshot diff against real provider data.

## Rules

- **Fixtures are raw upstream format**, not the transformed OpenRouter
  output, and not synthetic payloads hand-written from vendor docs.
- **Verbatim live captures only** — never fabricate a fixture or copy
  an existing one and splice in expected fields. If the behavior can't
  be triggered against the live API, say so in the PR instead.
- **Name files** `YYYY-MM-DD-<model>-<scenario>.json` (or `.sse.txt`).
  Providers without a model concept (e.g. Stripe) put the API resource
  in the `<model>` slot: `fixtures/stripe/2026-09-02-refunds-card-reference-pending.json`.
- **Binary multipart captures are a `.bin` + `.http.json` pair** sharing one stem: the `.bin` is the verbatim response body, and the `.http.json` carries the response `status` and `content-type` header, since the multipart boundary lives in the header rather than the body. Load both through a typed helper next to the fixture (e.g. `fixtures/recraft/load-multipart-fixture.ts`) that validates the `.http.json` at runtime instead of annotating `JSON.parse`.
- **Collect** via a script in `fixtures/scripts/` (with provider keys
  from Infisical `/_providers` — except Google Vertex, whose
  `GOOGLE_APPLICATION_CREDENTIALS_JSON` service account lives in
  `/_shared` because it is shared with GCP services; use
  `--path=/_shared` when collecting Vertex fixtures). Every committed fixture must have a
  corresponding scenario in the provider's collection script so it can
  be re-collected; ad-hoc curls are for exploration only — promote the
  request into the script before committing the fixture, and commit
  the script-generated `.json` companion alongside the `.sse.txt`.
- Any change to adapter response transforms, skin handlers, or parsing
  of new upstream fields/events/params must ship a fixture + snapshot
  test in the same PR — see `packages/router/AGENTS.md` and the
  `create-fixtures` skill (`.agents/skills/create-fixtures/SKILL.md`)
  for the full workflow and test pattern. Request-only transforms
  (reshaping the outgoing request body, covered by unit tests on
  `transformRequest`) do not require a fixture.
