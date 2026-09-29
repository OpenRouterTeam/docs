# Build context

- Follow root `AGENTS.md` and the nested `AGENTS.md` for the directory you are editing, for code style, database access, logging, async, testing, and secret-handling rules.
- Prefer Tilt for long-running dev tasks. Use `tilt up` for the full stack or `tilt up -- web api` for targeted services (positional args after `--`, not `--to-run`). If encountering OOM issues, use `TILT_PROFILE=lean tilt up` to run a reduced stack.
- Use targeted `bun`/Turbo scripts for validation (`bun run typecheck`, `bun run test`, package filters, or colocated test commands as appropriate).
- Use `bun run db:*` scripts for local Postgres database workflows.
- Automated setup must remain noninteractive. Do not require `infisical login`, cloud auth, Stripe login, Clerk/1Password access, or secret-backed commands unless the task explicitly asks and credentials are already available.
- Setup expectations: Brewfile tools best-effort, Node 24.17.0, bun 1.4.2, `bun install --frozen-lockfile` (Cloudflare Worker types are auto-generated via postinstall).
