# Agent guidance — cfw-synapse

One Cloudflare Worker: the GitHub PR reviewer/keep-fresh application and an independently gated organizational-corpus/Slack application. Read [`docs/architecture.md`](docs/architecture.md) before structural changes.

## Hard rules (enforced by code — do not weaken)

1. **Secrets live in `src/creds.ts` only.** `envOf()` is secret-stripped by
   type and value. New integrations add a capability to creds.ts
   (host-pinned, auth injected inside); they never export token material.
2. **Deterministic gates stay deterministic.** Synapse is advisory-only:
   the cap that keeps EVERY review event a COMMENT (never APPROVE, never
   REQUEST_CHANGES) lives in `uses/review/gate.ts` (`capAdvisoryOnly`) and is
   applied by the coordinator (`uses/review/finalize/`); the keep-fresh provenance
   gate is code policy too. Never move either into prompts, never add
   model discretion, never add a non-comment review-event code path.
3. **Fail closed.** Permission errors, unknown states, low confidence →
   don't act, log loudly, let a human in.
4. **Independent default-off runtime switches.** `synapse-webhook-reviews` is the brake for automatic GitHub reviews and keep-fresh; manual `POST /api/review` is separately bearer-authorized. `synapse-review-memory` requires bindings and an approved repository-scope retention policy for facts and patterns. The explicitly separate `synapse-corpus-ingestion` and `synapse-slack-replies` gates require approved source/model policy, trusted identity and independent-journal recovery readiness. Producer and consumer checks are both required. Deletion, ACL reconciliation, retention and pending vector/reply cleanup must continue when new-content/model/reply gates are off. Additional gates or environment knobs require an explicit operational decision.
5. **One repo-targeting knob.** `REVIEW_REPOS` is enforced once per ingress
   (the webhook and the manual `/api/review` route) — never add a second
   allowlist check deeper in the pipeline (it would break the fixture smoke
   and split the policy).
6. **Review agents never write to GitHub.** Their only output channel is
   `submit_findings` (a context sink). Every GitHub write belongs to the
   coordinator (`uses/review/finalize/`, `options-actions.ts`). Adding a write tool to
   the agent tool array is a design violation, not a feature. The
   auto-merge toggle in options-actions.ts is human-initiated only (Bot-sender
   guard + write-access check) and arms GitHub's native auto-merge —
   Synapse itself never merges.

## Layered layout

`src/` separates capability from application, enforced by
`src/layering.test.ts`:

- `connections/` — external surfaces (GitHub, workspace container, db
  state), application-agnostic; may not import tools/harness/uses/server.
- `tools/` — agent-facing tool definitions over connections; may not
  import harness/uses/server.
- `harness/` — the agent-run lifecycle envelope (lease claim/heartbeat,
  group budget, salvage, owned terminal CAS) over the db run ledger;
  imports NO layer. Every model loop a use runs goes through
  `executeAgentRun` — never drive the ledger's lifecycle directly.
- `uses/` — the applications (`review/`, `keep-fresh/`, `corpus/`); may not import server.
- `server/` — ingress + routing (http, webhook, manual, queue dispatch,
  cron), composes everything.
- `protocol.ts` and the root modules (config, flags, creds, env, log)
  are shared by every layer. `protocol.ts` imports no layer; creds/env
  import capability types from `connections/` but never application modules. The test enforces the three layer rules above, not the root-module convention.

New capability → connections (+ a tool if agents call it). New
application → a new `uses/` directory. Never grow a connection or tool
around one use's needs — extend the use's own context/schema instead
(see `uses/review/findings-tool.ts` extending the generic tool context).

## DB context

This service uses `@openrouter-monorepo/db/synapse/*` query files.
**No D1 for review state** — review state is Postgres via Hyperdrive; the
memory feature (`src/memory/`) uses the `MEMORY_DB` D1 binding (migrations
in `migrations/memory`; wrangler.toml).
`uses/review/round-store.ts` (plain
functions: review orchestration reads + the FORCE terminal path) and the
`StateStore` delivery-marker/lock facade delegate to these Postgres query
files.

The organizational corpus uses only the dedicated `packages/synapse-corpus` context via `withCorpusDb`, never the platform context. Its encrypted raw bucket and content-free SQLite Durable Object privacy journal are separate bindings. Missing or mismatched journal/checkpoint state fails closed. Source/raw/vector/result writers capture privacy revisions before reading evidence and recheck under the corpus fence before SQL commitment; no network call belongs inside that transaction.

Every handler must establish a DB context before calling `dbRead`/`dbWrite`.
HTTP routes use Hono's `createDbMiddleware()`; queue and
scheduled handlers use:

```ts
await withRpcDbContext(envOf(), () => yourHandler(), ctx.waitUntil.bind(ctx));
```

## Working conventions

- TypeScript ESM, Workers runtime — Web APIs first. The only runtime
  `node:` exception is `node:diagnostics_channel` in the shared
  `@openrouter-monorepo/instrumentation/cloudflare-statsd` and
  `cloudflare-breadcrumbs` shims, supported by the Worker's `nodejs_compat`
  flag and matching the monorepo's other Cloudflare services.
- Zod at every boundary (webhooks, API bodies, tool schemas, DB output).
- Structured logs via `src/log.ts` (shim over `iLog/wLog/eLog`):
  `log.info('domain.event', {fields})`. Keep `OR_ENV = "production"` in
  `wrangler.toml` so fields reach the instrumentation tail as JSON — and
  never log PR/comment/reply content: production logs are indexed in
  Datadog and shipped via Logpush, so log identifiers and sizes (kind,
  pr coordinates, char counts), not bodies.
- Tests: `bun:test`, colocated `*.test.ts`.
- Known `@openrouter/agent` SDK workarounds live in
  [`docs/sdk-workarounds.md`](docs/sdk-workarounds.md) — read it before
  touching `harness/agent-run.ts`'s input shaping or final-response handling.
  **The empty-final tolerance (#2) must survive**; the message-array shaping
  (#1) is verified obsolete against SDK 0.10.0 but stays until deliberately
  removed — see the doc's per-workaround status.

## Verify before yielding

```bash
cd services/cfw-synapse
bun run typecheck     # 0 errors
bun test              # all green
wrangler types        # generates worker-configuration.d.ts
```
