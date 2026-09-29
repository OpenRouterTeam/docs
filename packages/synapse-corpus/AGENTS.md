# Synapse corpus storage

Agent conventions for `packages/synapse-corpus`. See `README.md` for the package overview.

## Local database

The local database uses `pgvector/pgvector:pg18`, container `synapse-corpus-db`, database `synapse_knowledge`, and port `54323`.

```bash
cd packages/synapse-corpus
bun run db:start
bun run db:reset
bun run db:types
bun run test:integration
bun run db:stop
```

`db:reset` is intentionally local-only and refuses `SYNAPSE_CORPUS_DATABASE_URL`. `db:migrate` and `db:types` accept that variable for explicitly configured environments.

The integration suite truncates all corpus tables and therefore refuses to run against a non-local database host.

The pgvector extension is infrastructure-owned and bootstrapped by local/production provisioning before migrations run.

## Embedding profiles

Setting `production_active = true` on a `corpus_embedding_profiles` row requires a committed `decision_ref` (schema-enforced by `corpus_embedding_profiles_production_gate_check`). The profile comparison that produces that decision is a post-launch evaluation; see `evaluation/baseline-report.md`.
