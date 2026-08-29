---
name: batch-sync-fixtures
description: >-
  Capture real sync-API responses and provider batch output and turn them
  into committed JSONL fixtures for Batch API tests — batch input files,
  batch output lines, sync-response golden vectors for parity tests, and the
  Zod-validated loader pattern. Covers both OpenRouter's sync path and
  provider-native sync APIs (Anthropic Messages, Gemini generateContent)
  when onboarding a new batch provider. Sub-skill of batch-api-development.
user-invocable: true
---

# Batch Sync-API Fixtures

The batch contract is "a batch result line matches the sync-response shape"
(ECO-1717), so batch tests are only as honest as their fixtures. This skill
produces three fixture kinds, all captured from real APIs — never
hand-rolled:

1. **Batch input JSONL** — the provider-native upload format
2. **Batch output JSONL** — real provider batch result lines
   (success + error)
3. **Sync golden vectors** — real sync-API responses the parity tests
   compare batch output against

The sibling [`create-fixtures`](../create-fixtures/SKILL.md) skill covers
router SSE fixtures; this one covers the batch JSONL world.

## Where fixtures live

| Kind                 | Location                                                   |
| -------------------- | ---------------------------------------------------------- |
| Skin output fixtures | `packages/batch/skins/<skin>/fixtures/*.jsonl`             |
| Adapter fixtures     | `packages/batch/adapters/<provider>/fixtures.ts` (+ tests) |
| Service smoke input  | `services/batch-api/fixtures/*.jsonl`                      |

Key rule (same as `create-fixtures`): commit the **raw upstream format**
the adapter/skin receives — e.g. the OpenAI batch output line shape
`{id, custom_id, response, error}` — not the transformed OpenRouter output.

## Step 1 — Capture a sync response

For an existing skin, the sync side of a parity pair comes from the
ordinary chat-completions path:

```bash
# local cfw-api (bun run dev cfw-api), key from Infisical /tests/e2e
curl http://localhost:8787/api/v1/chat/completions \
  -H "Authorization: Bearer $OPENROUTER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model": "openai/gpt-4o-mini", "messages": [{"role": "user", "content": "Reply with the word pong."}]}'
```

When onboarding a new provider (Anthropic, Gemini, …), also capture the
**provider-native** sync response — the raw shape the new adapter's
`to-internal-response` and the skin will receive inside batch output lines:

```bash
# Anthropic Messages (keys from Infisical /_providers)
curl https://api.anthropic.com/v1/messages \
  -H "x-api-key: $ANTHROPIC_API_KEY" -H "anthropic-version: 2023-06-01" \
  -H "Content-Type: application/json" \
  -d '{"model": "claude-haiku-4-5", "max_tokens": 16, "messages": [{"role": "user", "content": "Reply with the word pong."}]}'

# Gemini generateContent
curl "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=$GEMINI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"contents": [{"parts": [{"text": "Reply with the word pong."}]}]}'
```

Save the JSON response verbatim. For deeper captures (adapter-level
request/response), run `bun run dev dev-fs-logs` alongside and pull the
`adapters/*/transform-*.log` files for the generation ID (see the
dev-fs-logs debugging knowledge/skill). Keep prompts tiny and
deterministic ("Reply with the word pong.") so fixtures stay small and
diffable.

## Fixture scenario matrix

Capture each scenario as a matched pair — the provider-native shape plus
the chat-completions counterpart — following the existing per-skin
convention (`packages/batch/skins/anthropic-messages/fixtures/` and
`packages/batch/skins/openai-responses/fixtures/` pair
`sync-<native>-*.json` with `sync-chat-*.json`):

- [ ] `text` — plain response, no tools
- [ ] `tool` — a `tools` request whose response contains
      `tool_calls` / `tool_use`
- [ ] `truncated` — `max_tokens` cutoff (`length` / `max_tokens`
      finish reason)
- [ ] reasoning and structured-output/JSON-mode variants where the
      provider supports them
- [ ] an error line (batch output fixtures)

Use the same tiny deterministic prompt per scenario across the pair so
parity tests compare like for like. Skip a row only when the provider
doesn't support the feature; note that in the research note.

## Step 2 — Capture batch output

One source: real requests against the provider. Submit a small batch to
the provider's batch API (or through OpenRouter's batch path), wait for
completion, and download the output file — this is where
`chat-completions-batch-output.jsonl` (2026-07-06 prod verification run)
came from. Do not pre-generate fixtures from the fake provider or
hand-write them; the fake provider is built _from_ these captures, so
using its output as a fixture is circular.

Error lines are captured the same way: trigger the error against the real
provider (bad model, over-limit line, malformed request) and save its
response.

## Step 3 — Redact + commit with provenance

Run every capture through the executable template at
[`capture-template.ts`](./capture-template.ts) — copy it to
`/tmp/batch-research/<provider>/capture.ts`, fill in the provider schema,
identifier keys, and per-scenario requests, and run it with
`infisical run … -- bun capture.ts <scenario>`. It must:

- **Deterministically rewrite identifiers** — map each org/user/file/job
  id to a stable placeholder (`org_TEST01`, `file-TEST01`, …) so
  cross-references between fixture lines still line up. Keep IDs the
  tests assert on (job ID, custom_id, timestamps) and record them as the
  golden vector.
- **Reject secret-like values** — fail loudly if any line still contains
  something matching key/token patterns (`sk-`, `Bearer `, `AKIA`,
  40+ char base64 runs); never rely on eyeballing.
- **Replace real customer content** with the tiny deterministic prompts
  from Step 1.
- **Zod-validate the redacted output** against the provider schema so
  redaction can't corrupt the shape.
- **Emit a provenance manifest** (`<fixture>.provenance.json`) beside the
  fixture: capture date, source run (prod/live batch id), HTTP status,
  and confirmation that every line is verbatim from the provider.

Then:

- Name files by skin/scenario (`chat-completions-batch-output.jsonl`);
  keep one success line and one error line per output fixture minimum.
- Repeat the provenance summary in the loader header — see
  `packages/batch/test-fixtures/`.

## Step 4 — Loader + shape guard

Expose fixtures through a Zod-validated loader, never raw `JSON.parse` in
tests:

- Loader: split JSONL, `wrap()` the parse, `parseSchema` each line, export
  named accessors (`fixtureSuccessLine()`, `fixtureErrorLine()`) — pattern
  in `packages/batch/test-fixtures/`.
- Shape guard test: a small test that validates every committed line
  against its schema and inline-snapshots one representative line, so
  fixture edits are reviewable — pattern in
  `services/batch-api/src/openai-batch-smoke-fixture.test.ts`.

## Step 5 — Wire into parity tests

Record the golden vector constants (job ID, custom_id, startedAt, billed
generation ID) at the top of the parity test with a provenance comment,
then assert batch-rendered output against the captured sync shape
field-by-field — template:
`packages/batch/skins/chat-completions/sync-parity.test.ts`.

Fixtures generally ship in the same PR as the adapter/skin that consumes
them (per [`batch-api-stacked-pr`](../batch-api-stacked-pr/SKILL.md)); the
raw (pre-redaction) capture transcripts stay under
`/tmp/batch-research/<provider>/` as working artifacts and are never
committed.

For a new provider, the capture list comes from the
[`research-batch-provider`](../research-batch-provider/SKILL.md) capture
matrix — run it there once and promote the relevant captures here rather
than re-capturing.

## Related skills

- [`batch-api-development`](../batch-api-development/SKILL.md)
- [`batch-api-testing`](../batch-api-testing/SKILL.md) — consumes these
  fixtures
- [`research-batch-provider`](../research-batch-provider/SKILL.md) — the
  capture matrix that feeds this skill for new providers
- [`create-fixtures`](../create-fixtures/SKILL.md) — router SSE fixtures
