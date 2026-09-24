# AGENT GUIDELINES

Nested `AGENTS.md` and `REVIEW.md` files carry the deeper-dive rules for the directory they sit in; skills under `.agents/skills/` carry workflow recipes. This file holds only repo-wide rules and pointers.

## Standard Workflow

- **Ask before starting when the readings diverge.** If different readings of the request would lead to materially different work, ask; otherwise make the routine judgment call and state the assumption in your summary.
- **Check for an existing implementation before adding one.** Read the file you are changing and search for an existing helper first.

## Pull Requests

- **Stack multi-layer changes.** A change that crosses more than one architectural layer ships as a GitHub-native stacked PR, one layer per PR, dependencies pointing down. Single-layer changes stay single PRs; do not manufacture a stack for a small diff.
- **Restack bottom-up, or push the whole stack atomically** (`git push --force-with-lease --atomic origin <b1> <b2> ...`); a head pushed before its base is diffed against the stale base and CODEOWNERS requests reviews that are never retracted.
- **Every layer stands alone.** Each PR must typecheck and pass its scoped tests without the layers above it, and must not import symbols introduced above it. **One owner per file:** assign every touched file to exactly one layer before creating branches.
- **Commit messages are `<type>: <short description>`** plus an optional body. No `Co-Authored-By`, no generated-by footer, no tool links or emoji decorations.
- **Preserve history.** Add new commits instead of amending or force-pushing a pushed branch; rebases (including `gh stack` restacks) are the exception.

## Style Principles

- **Maximize type-precision.** Never use `any` (use `unknown`). Use `satisfies` instead of `as`. Always declare return types. Prefer ESM literal enums (`as const` objects with `ValueOf`). Use Zod schemas for all API interfaces.
- **Minimal interface design.** New interfaces/types carry only the minimal required fields; do not speculate on future needs.
- **Derive inference-surface inventories from `API_SURFACES`** (`packages/enums/api-surfaces.ts`) with `Object.values(API_SURFACES)` or `Object.values(ApiType)`; never hand-type the list. Rules: `packages/enums/AGENTS.md`.
- **Type static strings as literals**, never as `string`. Scientific notation only for pricing constants (per-token prices, USD amounts, other money values); every other numeric constant uses plain digits with underscore separators (`60_000`, `300_000`), and BigNumber arithmetic uses the `bn` helper.
- **No speculative type guards.** Access a `T | undefined` property directly instead of writing `'prop' in obj`; add a guard only once tsc reports the property missing.
- **Return unknown when the answer is unknown.** A fallback is allowed only when the substitute answers the same question as the missing value. Reject malformed input rather than repairing it. See `REVIEW.md` → Unknown Values.
- **The default workspace is not guaranteed to exist.** Never fall back to it or derive it with `defaultWorkspaceId(entityId)`; require an explicit workspace ID or fail. See `packages/db/workspaces/AGENTS.md`.
- **Import CJS-only libraries as `import * as lib from 'lib'`.** Everything else is ESM.
- **Use Result monads** (`ok()`, `err()`, `isOk()`, `isErr()`) instead of throwing. Import from `@openrouter-monorepo/type-utils/result-monad`.
- **Validate external data at runtime.** Parse user input and vendor responses with Zod; log validation errors; don't trust vendor docs blindly.
- **Prefer immutability.** `const` over `let`, `map` over `for` + push.
- **Use completeness checks.** Prefer `switch` over `if` chains; the `default` case is a compile-time error using `value satisfies never`.
- **One class per file.** File name matches class name. Types at the top, helper functions at the bottom.
- **Extract reusable utils** into their own files for testability. A self-contained block of 50+ new lines added to an existing file belongs in its own file, exporting a function that takes explicit parameters.
- **Small, specialized dependencies**, versions frozen, size checked on [Bundlephobia](https://bundlephobia.com/); no large frameworks or overlap with existing deps. Extract only the functions needed from a large package, with an attribution URL at the extraction site. Remotion pins: `projects/remotion/AGENTS.md`.
- **Treat `trustedDependencies` additions as a last resort.** Only for an unavoidable install-time build step (native compile or prebuilt-binary download) — never to silence Bun's untrusted-script warning (`bun pm untrusted` shows what is blocked), never for telemetry, funding, or cosmetic scripts. Read the script in the resolved version, state in the PR what it does, and update the `bun.lock` mirror in the same commit. `overrides` and `patchedDependencies` meet the same bar and go once upstream ships the fix.
- **Frontend state has one owner per piece** (TanStack Query for server state, Zustand for shared mutable client state, React context for dependency injection, component state otherwise): `packages/frontend/AGENTS.md` → State Management. Any TanStack Query read, mutation, key, options factory, prefetch, or cache update must follow `packages/frontend/data-layer/AGENTS.md` and `packages/frontend/data-layer/REVIEW.md`.

## Inference Path Performance

In hot inference paths (`services/cfw-api`, `packages/router`, adapters, skins): no database writes (they belong in background jobs, usage-record pipelines, or post-response hooks); no per-isolate caching in module-level `Map`s, `Set`s, or plain objects except rarely-updated, request-independent data; per-user data comes from the auth service / `getUserByKey`, never a direct query; never open a direct database connection from a hot path; no instance-level references to request bodies or response data on adapters, routers, or plugins. Full rules: `services/cfw-api/AGENTS.md` → Rules for Contributing; `packages/router/AGENTS.md` → Memory Retention.

## Database Access

- **Use Kysely for all queries** via `dbRead` / `dbWrite` from `@openrouter-monorepo/db/context`; **frontend server actions and RSC entrypoints must not import the database at runtime** (use a `cfw-frontend-api` / `cfw-internal` REST route through the TanStack data layer); **do not mention "Supabase"** — say "Postgres". Migrations: **extract and document locks before opening a PR** (`pg_locks`; locks and prod-risk assessment in the PR description and as SQL comments) and **comment new tables and columns**. Local Postgres is driven only through the `bun run db:*` scripts. Full rules and commands: `packages/db/AGENTS.md`; lock procedure: `postgres/migrations/AGENTS.md`.

## Workers and Cloudflare

- **Do not add new routes to `cfw-api`** (frozen): new routes go to `cfw-public-api`, `cfw-frontend-api`, or `cfw-internal`, and **do not add entries to the allowlist in `services/cfw-api/src/app.test.ts`**. Scheduled jobs and multi-step admin operations run as Cloudflare Workflows in `cfw-internal`, not Vercel crons, Graphile jobs, or `waitUntil` fan-out.
- **Cloudflare resources** are Terraform in [`openrouter-infra`](https://github.com/OpenRouterTeam/openrouter-infra) `terraform/cloudflare-prod`; resources already declared by an in-repo Terraform stack stay there until their state is imported and the old declaration removed. Do not redeclare them elsewhere or make changes in the Cloudflare dashboard. Worker code and `wrangler.toml` bindings stay in this repo.
- Route placement, Workflows, Cloudflare resources, tree-shakeable worker dependencies, Worker response caching, live config, KV refresh, service metrics, and dashboards: `services/AGENTS.md`.

## Code Structure

- Early returns (guard clauses) over nested conditions; handler registries over large switch/if-chains (4+ cases); small single-purpose functions (5-20 lines); context objects for related parameters. Flatten loops with `continue` / `return` instead of `else if` chains; extract a case body that grows past a few lines into a named function.
- Order a file imports (types first), then types, helpers, registries, and public API. Docblocks are terse: one line where possible, none for a private helper whose name says it, multi-line only for non-obvious contracts.
- Structure by domain, not technical responsibility; many small files over giant ones ([Tao of Node](https://alexkondov.com/tao-of-node/#structure-in-modules)). Colocate tests with modules (`.test.ts` or `.test.tsx` next to source).

## Logging

Use `iLog()`, `eLog()`, and `wLog()` from `@openrouter-monorepo/instrumentation/logger`, never `console.log()`, with snake_case context fields. **Never log a value you did not assemble for the log line**: objects (vendor, DB row, body, auth, error) go in as named scalar fields (`user_id`, `status`, `error.message`), never the object, a spread, or a nested branch of it. **Keep sensitive and unbounded values out** (prompts, keys, PII, payment details, base64); log an ID or a hash. `openrouter/no-stripe-payloads-in-logs` is a floor, not the boundary. Full rules and error helpers: `packages/instrumentation/AGENTS.md`.

## Feature Instrumentation

A metric earns its place when you know who reads the number and what they do with it; reviewers do not ask for instrumentation and its absence does not block a PR. Frontend: `PostHogEvent` from `packages/enums/posthog.ts`; server: `getStatsd()` from `@openrouter-monorepo/instrumentation/statsd`. Tags stay low cardinality (never a user ID, API key, prompt, URL, or raw error string); emission never throws or adds an `await` to a request-serving path. Monitors are not part of shipping a feature; read `configs/terraform-monitors/AGENTS.md` before adding one.

## HIPAA and ePHI

Every feature owner decides, before opening the PR, whether the change can produce, move, store, log, or display ePHI, and states the answer on the PR's HIPAA / ePHI checklist line. "Does not touch HIPAA" is a claim about data flow, not about whether the word HIPAA appears in the diff. HIPAA is subtractive and allowlisted: a HIPAA workspace gets nothing new by default, and unknown posture is refused, never treated as non-HIPAA. Run `.agents/skills/hipaa-ephi/SKILL.md` before any PR that touches inference content, write sinks, logs or telemetry, routing or eligibility, HIPAA-reachable surfaces, posture or auth reads, or retention and deletion. Reviewers check the claim per `REVIEW.md` → HIPAA and ePHI.

## Security Review

Before opening a PR whose diff changes who can reach or read something, run `.agents/skills/security-review/SKILL.md` (access) and `.agents/skills/security-review-data-trust/SKILL.md` (data flow) and name the classes you ran in the PR's Security and privacy section. The trigger is the boundary the diff crosses, not the file: an auth gate, tenant or workspace scoping, a server action or route handler, a server-side fetch to a caller-influenced host, a platform credential or signing key, a read-then-write on balances or caps, what a public response or log line exposes, deletion or retention of user data, or the prompts, tools, or secrets handed to an agent. Each skill's description carries the path-level trigger list.

## Async

`Promise.race` is banned. Use `safeRace` from `@openrouter-monorepo/lib-async`. Every `fetch()` response whose body is not consumed must be cancelled via `response.body?.cancel()`, on every path that does not read it — an unconsumed body leaks memory and holds a connection open.

## Verification

- Run `bun run verify` before every push. Format through `bun run format`, not the formatter binary on a hand-built file list. `bun run typecheck` is the only guard for `typescript/no-floating-promises` and `typescript/no-misused-promises`; type-aware lint covers only `typescript/switch-exhaustiveness-check` (`.agents/skills/add-oxlint-rule/SKILL.md`).
- Once a PR is out of draft, run `bunx pacwich affected list --base "$(git merge-base origin/main HEAD)" --head HEAD --ignore-uncommitted --json`. If it names `@openrouter-monorepo/web` or `@openrouter-monorepo/test-web-e2e`, or the PR changes the shape of data a page renders, follow `.agents/skills/update-visual-regression/SKILL.md` (that local `tests/web-e2e` run gates your merge). Otherwise skip it and say why in the PR.
- Other development targets (`typecheck:clean`, `fallow:lint`, `kill-ports`, `bun run x`): `README.md` → Develop Locally.

## Testing

- `bun:test` for packages and services; `assertOk` / `assertErr` for Results; `assert(...)` rather than an `if` to narrow an optional property; no `any`. Plain functions should always be tested.
- **Build fixtures real object > existing fake > typed `createMockX` factory.** Module mocks are banned; a cast in test setup means the fixture is wrong. Probe statically-invalid input with `@ts-expect-error`, not a cast. Fixture, process-global mock, fake-timer, ClickHouse TTL fixture, and `@existingBuggyBehavior` rules: `.agents/skills/unit-test-writing/SKILL.md`.
- **Ship raw upstream fixtures with upstream-response-behavior changes**: a verbatim live capture in `fixtures/<provider>/` plus a snapshot test in the same PR, never a hand-written or hand-edited payload; request-only transforms need none — `packages/router/AGENTS.md` → Fixtures, `create-fixtures` skill.
- **Never write mock-based DB tests** (Postgres or Spanner) — `.agents/skills/db-integration-tests/SKILL.md`.
- **Always create tests for missing coverage** when fixing a bug, adding a feature, or modifying behavior. **`tests/e2e/`** runs in CI on every PR (cheap, deterministic); **`tests/manual/`** holds expensive or flaky tests and incident documentation (not run in CI) in date-prefixed dirs with `snapshot.json` + `index.test.ts` — `.agents/skills/e2e-testing/SKILL.md`.
- **Never sleep on real timers in tests.** `openrouter/no-real-timer-sleeps` bans fixed `setTimeout` sleeps in frontend tests; fake-timer recipe in the unit-test-writing skill.
- **Test after every push, not just PR creation.** React to test/recording findings: if a test or video recording shows failures, fix and re-test before reporting completion. Never report "PR is ready" when tests failed or were skipped.

## Nested Agent Docs

Guidance for one part of the codebase goes in that directory's `AGENTS.md` (conventions and workflow) and/or `REVIEW.md` (patterns to flag in review), never a nested `README.md`; only `AGENTS.md` / `REVIEW.md` are picked up by agent tooling. Pointers: GitHub Actions pinning `.github/AGENTS.md`; CI runner performance `scripts/ci/AGENTS.md`; reviewer norms `REVIEW.md` → Reviewer Norms, UI norms `projects/web/REVIEW.md` and `packages/frontend/REVIEW.md`.

## Secret Management

Infisical holds all secrets; setup, `infisical run` injection, `.env.development.local` overrides, and per-service paths: [INFISICAL.md](./scripts/infisical/INFISICAL.md). Pre-commit hooks scan for hardcoded secrets. **Agents:** `INFISICAL_CLIENT` and `INFISICAL_SECRET` are provisioned org-wide on every Devin session; authenticate per `.agents/skills/infisical-agent-auth/SKILL.md` and read values directly — do NOT ask the human (or call `secrets(action="request")`) for any credential that lives in Infisical.

## Naming

- `camelCase` for functions and variables; `PascalCase` for types, interfaces, React components, classes, Zod schemas (`PersonSchema`), and literal enum members; `UPPERCASE` for top-level string/number/boolean constants.
- Prefix booleans with "did", "should", "is", etc. Plural or `...List` names for functions returning arrays (`resolveModelList`, not `resolveModel`).
- Whole words over abbreviations, and `CamelCase` the abbreviations that remain: `Api`, `Url`, `Http`, `Json`. No `I` prefix on interfaces.
- `DEV_` marks temporary development code, `INTERNAL_` marks a symbol that is not for external use.

## Markdown

For `.md` and `.mdx` files and PR descriptions:

- Do not hard-wrap prose — one logical line per paragraph.
- Restart ordered-list numbering at 1 in each section, and put a blank line before and after every list.
- Use real `##` headings, not bold text as a heading.
- Always give a fenced code block its language.
