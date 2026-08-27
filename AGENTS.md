# AGENT GUIDELINES

See `.claude/rules/` for additional, deeper-dive rule files.

## Standard Workflow

- **Ask clarifying questions** before starting. Don't assume
  intent — if there are multiple valid approaches or ambiguous
  requirements, ask. Err on the side of asking too many
  questions rather than too few.
- **Plan before implementing** non-trivial tasks.
- **Read before editing.** Before and after modifying or
  creating any file, read the entire file to understand
  context and avoid duplication.

## Pull Requests

- **Stack multi-layer changes.** A change that crosses more
  than one architectural layer ships as a GitHub-native
  stacked PR, one layer per PR, dependencies pointing down.
  See `.agents/skills/stacked-prs/SKILL.md` for slicing rules
  and `gh stack` mechanics.
- **Every layer stands alone.** Each PR must typecheck and
  pass its scoped tests without the layers above it applied,
  and must not import symbols introduced above it.
- **One owner per file.** Assign every touched file to
  exactly one layer before creating branches.
- Single-layer changes stay single PRs. Do not manufacture
  a stack for a small diff.

## Style Principles

- **Maximize type-precision.** Never use `any` (use `unknown`).
  Use `satisfies` instead of `as`. Always declare return types.
  Prefer ESM literal enums (`as const` objects with `ValueOf`).
  Use Zod schemas for all API interfaces.
- **Minimal Interface Design:** When defining new
  interfaces/types, write only the minimal required fields.
  Don't speculate on future needs.
- **Use Result monads** (`ok()`, `err()`, `isOk()`, `isErr()`)
  instead of throwing. Import from
  `@openrouter-monorepo/type-utils/result-monad`.
- **Validate external data at runtime.** Parse user input and
  vendor responses with Zod. Log validation errors, don't
  trust vendor docs blindly.
- **Prefer immutability.** `const` over `let`, `map` over
  `for` + push.
- **Use completeness checks.** Prefer `switch` over `if`
  chains. The `default` case should be a compile-time error
  using `value satisfies never`.
- **One class per file.** File name matches class name. Helper
  functions at the bottom, types at the top.
- **Extract reusable utils** into their own files for
  testability.
- **Small, specialized dependencies.** Prefer focused libraries
  with high test coverage. Avoid large frameworks or overlap
  with existing deps. Remotion dependencies must satisfy the
  security floor enforced by `bun run check:remotion-pin`.
- **Treat `trustedDependencies` additions as a last resort.**
  An entry permanently authorizes a package's install-time
  lifecycle scripts on every dev, CI, and agent machine. Add
  one only for a genuine install-time build step (native
  compile or prebuilt-binary download) that cannot be avoided
  — never to silence Bun's untrusted-script warning, and never
  for telemetry, funding, or other cosmetic scripts. Hold
  `overrides` and `patchedDependencies` changes to the same
  bar. See `.claude/rules/dependencies.md`.
- **One owner per piece of state.** Server state lives in
  TanStack Query, shared mutable client state in a Zustand
  store, dependency injection and subtree-scoped values in a
  React context, and everything else in component state. Never
  mirror state another layer owns, and read stores through a
  per-property selector. See
  `.claude/rules/frontend.md` → State Management.
- **Read the shared data-layer rules before frontend TanStack Query work.**
  Any change that defines or consumes TanStack Query reads, mutations, keys,
  options factories, prefetches, or cache updates must follow both
  [`packages/frontend/data-layer/AGENTS.md`](packages/frontend/data-layer/AGENTS.md)
  and
  [`packages/frontend/data-layer/REVIEW.md`](packages/frontend/data-layer/REVIEW.md).
- **Make new dependencies tree-shakeable in worker builds.**
  Before adding or bumping a dependency reached from a Worker,
  check that its `exports` map serves ESM under wrangler's
  conditions (`workerd`, `worker`, `browser`). A package whose
  ESM entry sits only behind `esnext`/`module` resolves to
  CommonJS, which esbuild cannot tree-shake. Patch its `exports`
  to add `workerd`/`worker` entries pointing at the ESM build,
  and confirm the saving in `dist/bundle-meta.json` — see
  `.agents/skills/cfw-api-startup-optimization/SKILL.md`.

## Inference Path Performance

These rules apply to all code running in hot inference paths
(`services/cfw-api`, `packages/router`, adapters, skins).

- **No database writes in inference paths.** `INSERT` / `UPDATE` /
  `DELETE` must not run in request-serving code. Writes belong in
  background jobs, usage-record pipelines, or post-response hooks.
- **No per-isolate caching.** Do not cache data in module-level
  `Map`s, `Set`s, or plain objects inside Workers. Isolate-local
  caches diverge across the fleet, are invisible to monitoring,
  and cause high query volume when the cached value varies per user
  or request. Per-isolate caches are acceptable **only** for
  rarely-updated, request-independent data (e.g., a global
  feature-flag set that changes once a day).
- **Use auth service / `getUserByKey` for per-user data.** Any data
  scoped to a user or organization should come from the auth service
  or `getUserByKey`, which already runs once per request. Do not
  query the database directly during inference for per-user data.
- **Use Hyperdrive-cached connection for necessary hot-path queries.**
  When a query genuinely cannot be moved into the auth service and
  must execute during inference, use the Hyperdrive-cached connection
  string so the connection is pooled and responses are cached at the
  Cloudflare edge. Never open a direct database connection from a
  hot inference path. **Caveat:** Hyperdrive has shown degraded
  reliability under heavy load — timeouts and failed deliveries
  increase significantly at high request volumes. Treat it as a last
  resort, not a default. Strongly prefer moving data into the auth
  service or KV before resorting to Hyperdrive queries on every
  inference request.
- **No instance-level references to request bodies or response data.**
  Do not store request bodies, transformed/serialized requests, or
  response payloads on class fields of long-lived objects (adapters,
  routers, plugins). Instance fields retain their referents — including
  base64 image/audio blobs — for the object's whole lifetime, long
  after the last read. Thread the data explicitly as function
  parameters to the consumers that need it, scoped to the narrowest
  lifecycle window.

## Database Access

- **Use Kysely for all queries.** Use `dbRead` / `dbWrite`
  from `@openrouter-monorepo/db/context`. See the
  [Writing Kysely Queries skill](./.agents/skills/writing-kysely-queries/SKILL.md)
  for patterns, helpers, and gotchas.
- **Frontend server actions and RSC entrypoints must not import the database
  at runtime.** Use a private `cfw-frontend-api` REST route and consume it
  through TanStack Query in the shared data layer. See
  [`packages/frontend/data-layer/AGENTS.md`](packages/frontend/data-layer/AGENTS.md)
  and [`packages/frontend/data-layer/README.md`](packages/frontend/data-layer/README.md).
- **Do not mention "Supabase".** The database is Postgres; we
  migrated off Supabase. Do not add new references to Supabase,
  the Supabase CLI/SDK, or Supabase-specific bindings, env
  vars, or client patterns (`getSupabasePrimary`, PostgREST,
  etc.) in code, comments, or docs — say "Postgres" generically.
  The only acceptable mentions are: explanations of legacy
  behavior, the Supa Broadcast destination
  (`packages/broadcast/destinations/supabase`), postmortems,
  and existing legacy infra names that cannot be renamed
  in-place (e.g. GKE secret paths like `supabase-credentials`).

## Route Placement

**Do not add new routes to `cfw-api`.** It is frozen to
mitigate startup-time increases that degrade inference
performance. Place new routes in the appropriate worker:

- **`cfw-public-api`** — Publicly documented routes
- **`cfw-frontend-api`** — Routes supporting the web app
- **`cfw-internal`** — OpenRouter internal use only (pinned to
  us-central1)

A unit test in `services/cfw-api/src/app.test.ts` enforces this
by failing if unrecognized route prefixes appear. **Do not add
entries to the allowlist in that test** — move the route to the
correct worker instead.

## Code Structure

- Use early returns (guard clauses) instead of nested
  conditions.
- Replace large switch/if-chains (4+ cases) with handler
  registries.
- Keep functions small and single-purpose (5-20 lines).
- Use context objects for related parameters.
- Structure by domain, not technical responsibility. Prefer
  many small files over giant ones — see the
  [Tao of Node](https://alexkondov.com/tao-of-node/#structure-in-modules).
- Colocate tests with modules (`.test.ts` or `.test.tsx` next to source).

## Logging

Use `iLog()`, `eLog()`, and `wLog()` from
`@openrouter-monorepo/instrumentation/logger`. Do not use
`console.log()`. Log structured context objects with
snake_case field names.

- **Never log a value you did not assemble for the log line.**
  Vendor API objects, DB rows, request and response bodies,
  auth/session and user objects, webhook events, config
  objects, and thrown errors go in as named scalar fields —
  never the object itself, a spread of it, or a nested branch
  of it. Error paths are not an exception: log `error.message`
  and a stable code, not the raw error or the object that
  caused it.
- **Name every field.** Enumerate the identifiers and values
  the line needs (`user_id`, `status`, `amount`) so each field
  is a deliberate choice. A logged object silently gains
  fields when its upstream shape changes, and logs have no
  deletion path.
- **Keep sensitive and unbounded values out.** No prompts or
  completions, keys or tokens, emails, names, addresses,
  payment details, or base64 blobs. When a field is needed for
  correlation but not for reading, log an ID or a hash.

`openrouter/no-stripe-payloads-in-logs` enforces this for
Stripe resources. It is a floor, not the boundary of the rule.

## Feature Instrumentation

Ship a new feature's measurement in the same PR as the feature.
Frontend features capture a PostHog event from the `PostHogEvent`
enum in `packages/enums/posthog.ts`. Server-side features emit
Datadog metrics via `getStatsd()` from
`@openrouter-monorepo/instrumentation/statsd`. Every feature needs
at least an adoption counter and a success/failure outcome with a
low-cardinality failure reason, and its PR description names the
metrics and events it adds. A feature that emits a failure signal
also ships a Terraform Datadog monitor or dashboard in
`configs/terraform-monitors/`, routed to a low-signal Slack
channel (default `@slack-OpenRouter-test-slack-messages`) unless
the PR author names another. See
`.claude/rules/feature-instrumentation.md`.

## Async

`Promise.race` is banned. Use `safeRace` from
`@openrouter-monorepo/helpers/safe-race`.

Every `fetch()` response whose body is not consumed must be
cancelled via `response.body?.cancel()`. See
`.claude/rules/fetch-body-cancellation.md`.

## Verification

- Run `bun run verify` (format, lint, typecheck) before committing. It is
  fast, run it as often as you like
- Run formatting through `bun run format`, not the formatter binary on a
  hand-built file list. There is no type-aware lint mode, `bun run typecheck`
  catches type errors

## Testing

- Framework: `bun:test` for packages and services
- Use `assertOk` and `assertErr` for Results
- Do not use `any`
- Plain functions should always be tested
- **Never write mock-based DB tests** (Postgres or Spanner) —
  see `.agents/skills/db-integration-tests/SKILL.md`.
- **Always create tests for missing coverage.** When fixing a
  bug, adding a feature, or modifying behavior, check whether
  a test exists. If not, create one:
  - **`tests/e2e/`** — for tests that should run in CI on every
    PR (cheap, deterministic, regression prevention). Use
    `callApi`, `RequestBuilder`, `TestModelGroups`.
  - **`tests/manual/`** — for expensive tests, flaky provider
    tests, or documenting what went wrong (not run in CI). Use
    date-prefixed dirs with `snapshot.json` + `index.test.ts`.
- **Never sleep on real timers in tests.** Use
  `jest.useFakeTimers()` plus
  `jest.advanceTimersByTime()` for timer-driven code, and
  `waitFor` / `findBy*` / `await act(async () => {})` for async
  UI updates. Fixed `setTimeout` sleeps with a nonzero delay are
  banned in frontend tests by the
  `openrouter/no-real-timer-sleeps` lint rule — see
  `.claude/rules/testing.md`.
- **Test after every push, not just PR creation.** Re-run
  relevant tests after every code push that changes behavior.
- **React to test/recording findings.** If a test or video
  recording shows failures, fix the issues and re-test before
  reporting completion. Never report "PR is ready" when tests
  failed or were skipped.

## GitHub Actions

- **Pin third-party actions to a full commit SHA.** Any `uses:` reference outside `actions/*` and this repo's own `./.github/actions/*` must name a 40-character commit SHA, never a tag or branch. Tags are mutable, so a tag-based reference lets an upstream maintainer — or an attacker who compromises that repo — change the code we execute without any change on our side (CVE-2025-30066).
- **Record the source tag in a trailing comment**, so the pin stays readable and Dependabot can bump it:

  ```yaml
  uses: astral-sh/setup-uv@fac544c07dec837d0ccb6301d7b5580bf5edae39 # v8.2.0
  ```

- **Resolve the SHA from the tag you intend to use**, with `gh api repos/<owner>/<repo>/commits/<tag> --jq .sha`. Do not hand-copy a SHA from another file, and do not bundle a version bump into a pinning change.
- **Pin the tool version too when an action installs one.** Actions like `setup-uv` resolve "latest" over the network at run time, which is both a moving target and a flake source, so pass an explicit version input.

## Migrations

- **Extract and document locks before opening a PR.**
  Run the migration in a rolled-back transaction against
  local Postgres and inspect `pg_locks` for dangerous
  modes (ACCESS EXCLUSIVE, EXCLUSIVE, SHARE ROW
  EXCLUSIVE, SHARE). Include the locks and a prod-risk
  assessment in the PR description and as SQL comments at
  the top of the migration file. See
  `postgres/migrations/AGENTS.md` for the full lock
  analysis procedure.
- **Comment new tables and columns.** Follow every
  `CREATE TABLE` with `COMMENT ON TABLE` and a
  `COMMENT ON COLUMN` per column, and comment new columns
  added to existing tables — see
  `postgres/migrations/AGENTS.md`.
- **Spanner migrations** have their own conventions — see
  `services/usage-record/spanner/migrations/AGENTS.md`.

## Nested Agent Docs

When writing guidance for agents working on a specific part
of the codebase, put it in a nested `AGENTS.md` (conventions
and workflow) and/or `REVIEW.md` (patterns to flag in review)
in that directory — not in a nested `README.md`. Nested
`AGENTS.md` / `REVIEW.md` files are automatically picked up
and enforced by agent tooling; READMEs are not.

## Local Postgres

Local Postgres runs in Docker and migrations are applied with dbmate.
Only use `bun run db:*` scripts to interact with the database:

- `bun run db:start` / `bun run db:stop` - Start/stop local Postgres
- `bun run db:reset` - Reset database
- `bun run db:migrate` - Run migrations
- `bun run db:migration <name>` - Create a new migration
- `bun run db:types` - Generate TypeScript types

## Secret Management

We use Infisical for centralized secret management.
See [INFISICAL.md](./scripts/infisical/INFISICAL.md) for
documentation.

Key points:

- Environment variables are injected via `infisical run`
- `.env.development.local` can override Infisical locally
- Each service has its own secret path for isolation
- Pre-commit hooks scan for hardcoded secrets
- Agents: `INFISICAL_CLIENT` and `INFISICAL_SECRET` are
  provisioned org-wide on every Devin session. Authenticate
  non-interactively and read values directly — do NOT ask
  the human (or call `secrets(action="request")`) for any
  credential that lives in Infisical (e.g. `E2E_CLERK_USER` /
  `E2E_CLERK_PASSWORD` under `/tests/e2e`):

  ```bash
  INFISICAL_TOKEN=$(infisical login \
    --method=universal-auth \
    --client-id="$INFISICAL_CLIENT" \
    --client-secret="$INFISICAL_SECRET" \
    --plain --silent) || {
    echo "infisical login failed — check INFISICAL_CLIENT / INFISICAL_SECRET" >&2
    exit 1
  }
  [ -n "$INFISICAL_TOKEN" ] || {
    echo "infisical login returned an empty token — check INFISICAL_CLIENT / INFISICAL_SECRET" >&2
    exit 1
  }
  export INFISICAL_TOKEN

  # Read one value
  infisical secrets get <NAME> \
    --projectId=771b7bc0-6578-41b0-886e-9fcdb66e9173 \
    --env=dev --path=/<folder> \
    --token="$INFISICAL_TOKEN" --plain

  # Or wrap a command so only that folder's secrets are
  # injected as env vars (scope to a specific path —
  # `--path=/ --recursive` can 403 on cross-environment
  # secret refs; see .agents/skills/e2e-vercel-ai-sdk/SKILL.md)
  infisical run \
    --projectId=771b7bc0-6578-41b0-886e-9fcdb66e9173 \
    --env=dev --path=/tests/e2e -- <command>
  ```

  Folder paths mirror the repo (e.g. `/tests/e2e`,
  `/services/cfw-api`, `/projects/web`); see `env.manifest.json`.

## Naming

- `camelCase` for functions and variables
- `PascalCase` for types, interfaces, React components, classes
- `UPPERCASE` for top-level string/number/boolean constants
- Prefix booleans with "did", "should", "is", etc.
- Plural names for functions returning arrays
