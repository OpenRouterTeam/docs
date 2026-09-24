# Database Access

Repo-wide rules for reading, writing, and migrating the Postgres database. `REVIEW.md` in this directory carries the review-time checks; `workspaces/AGENTS.md` covers workspace resolution.

## Queries

- **Use Kysely for all queries.** Use `dbRead` / `dbWrite` from `@openrouter-monorepo/db/context`. See the [Writing Kysely Queries skill](../../.agents/skills/writing-kysely-queries/SKILL.md) for patterns, helpers, and gotchas.
- **Frontend server actions and RSC entrypoints must not import the database at runtime.** Use a REST route on the worker matching the frontend — `cfw-frontend-api` for the web app, `cfw-internal` for Mission Control — and consume it through TanStack Query in the shared data layer. See [`packages/frontend/data-layer/AGENTS.md`](../frontend/data-layer/AGENTS.md) and [`packages/frontend/data-layer/README.md`](../frontend/data-layer/README.md).
- **Do not mention "Supabase".** The database is Postgres; we migrated off Supabase. Do not add new references to Supabase, the Supabase CLI/SDK, or Supabase-specific bindings, env vars, or client patterns (`getSupabasePrimary`, PostgREST, etc.) in code, comments, or docs — say "Postgres" generically. The only acceptable mentions are: explanations of legacy behavior, the Supa Broadcast destination (`packages/broadcast/destinations/supabase`), postmortems, and existing legacy infra names that cannot be renamed in-place (e.g. GKE secret paths like `supabase-credentials`).
- **The default workspace is not guaranteed to exist.** Never fall back to it, and never derive it with `defaultWorkspaceId(entityId)` as a substitute for a resolved workspace. When no workspace resolves, require an explicit workspace ID or fail the operation. See `workspaces/AGENTS.md`.

## Migrations

- **Extract and document locks before opening a PR.** Run the migration in a rolled-back transaction against local Postgres and inspect `pg_locks` for dangerous modes (ACCESS EXCLUSIVE, EXCLUSIVE, SHARE ROW EXCLUSIVE, SHARE). Include the locks and a prod-risk assessment in the PR description and as SQL comments at the top of the migration file. See `postgres/migrations/AGENTS.md` for the full lock analysis procedure.
- **Comment new tables and columns.** Follow every `CREATE TABLE` with `COMMENT ON TABLE` and a `COMMENT ON COLUMN` per column, and comment new columns added to existing tables — see `postgres/migrations/AGENTS.md`.
- **Spanner migrations** have their own conventions — see `services/usage-record/spanner/migrations/AGENTS.md`.

## Local Postgres

Local Postgres runs in Docker and migrations are applied with dbmate. Only use `bun run db:*` scripts to interact with the database:

- `bun run db:start` / `bun run db:stop` - Start/stop local Postgres
- `bun run db:reset` - Reset database
- `bun run db:migrate` - Run migrations
- `bun run db:migration <name>` - Create a new migration
- `bun run db:types` - Generate TypeScript types
