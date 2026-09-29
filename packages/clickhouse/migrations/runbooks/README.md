# ClickHouse migration runbooks

Operator-facing runbooks for migrations in `../`.

The migration runner (`bun run ch:migrate`) reads `*.sql` files from the
parent `migrations/` directory only — it does not descend into
subdirectories, so files under this directory are inert from the
runner's perspective.

## Convention

- One file per migration that needs operator action.
- Filename mirrors the SQL filename: `<NN>_<name>.md` for
  `../<NN>_<name>.sql`.
- First line of the runbook should link back to the SQL file via
  `[../<NN>_<name>.sql](../<NN>_<name>.sql)` so navigation is
  symmetric.
- Only add a runbook when the migration needs steps the runner
  cannot perform itself (date-bounded backfills, cutover sequencing,
  validation queries, application-side rewrites).
