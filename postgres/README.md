# Manually Performing DB Migrations On Prod

Use the normal deploy path first. If a migration exceeds the database
`statement_timeout` default of `8s` (`20260706230000_baseline_schema.sql`),
run it with the timeout-raising dbmate path below. Migrations must run as
`github-ci` so object permissions stay consistent.

## Indexes on large tables: build before the release

The release runs migrations on the `8s` default timeout, so an index build on a
big table (rule of thumb, over ~100k rows) fails the release and leaves an
INVALID index behind. Run it yourself first, on the commit the train ships:

```sh
git pull
bun run scripts/db-migrate-gcp.ts --statement-timeout
```

This applies and records every pending migration, so only run it once the
release commit is on `main`. Then confirm the index is valid, since the planner
ignores an INVALID one and `IF NOT EXISTS` skips over it silently:

```sql
SELECT indisvalid FROM pg_index WHERE indexrelid = 'public.my_index'::regclass;
```

If `false`, `DROP INDEX CONCURRENTLY` and rebuild.

## Preferred: dbmate

Run the pending migrations in order with a 10-minute statement timeout:

```sh
bun run scripts/db-migrate-gcp.ts --statement-timeout
```

The flag defaults to `10min`; pass `--statement-timeout=<value>` (e.g.
`--statement-timeout=15min`) for a different timeout.

This runs only each migration's `migrate:up` section and records each version
after it succeeds. Review the pending batch before starting; stop and
investigate any failure rather than recording a partially applied
`transaction:false` migration.

The script authenticates to Secret Manager using the runtime service account.
For a human-run fallback, use the impersonating form below; the
`generateAccessToken` audit record identifies the operator even though the
database session is `github-ci`.

<details>
<summary>The script crashes with <code>Could not load the default credentials</code></summary>

Secret Manager reads Application Default Credentials, which a laptop does not
have until you create them:

```sh
gcloud auth application-default login
```

Then rerun the migration command. The
`PG_US_CENTRAL1_POOL_DB_URL is not set` warning printed above the crash is
unrelated; migrations connect through dbmate, not the DB pool.

</details>

## Manual fallback: Postgres (Cloud SQL)

1. Ensure `psql` is installed (for example, `brew install libpq && brew link --force libpq`).

2. Connect directly to port 5432 as `github-ci`:

   ```sh
   PGPASSWORD="$(gcloud secrets versions access latest \
     --secret=sql-pg-us-central1-github-ci-password \
     --project=openrouter-core \
     --impersonate-service-account=db-migrate@openrouter-core.iam.gserviceaccount.com)" \
   psql "sslmode=require host=pg-us-central1.internal.openrouter.ai dbname=postgres user=github-ci"
   ```

3. Set the timeout for this direct session, then run only the migration's
   `migrate:up` body. Do not wrap the migration in one large transaction:
   migrations marked `transaction:false` and migrations with long-running
   statements are intentionally written to release locks between statements.

   ```sql
   SET statement_timeout = '10min';
   -- paste ONLY the migrate:up body here
   ```

   `psql` does not interpret dbmate's `-- migrate:down` marker, so pasting the
   whole file runs the down section too. With `ON_ERROR_STOP` off, a failed
   statement inside a transaction also leaves later statements aborted and
   `COMMIT` reports `ROLLBACK`; use `\set ON_ERROR_STOP on` if you deliberately
   use a transaction recipe. Migrations that use `RESET statement_timeout`
   must set it again before later slow statements. The `github-ci` role already
   has a 5-second `lock_timeout`; a deliberate transaction recipe must also
   account for the 60-second `idle_in_transaction_session_timeout`.

4. Monitor the database and abort if you see lock contention or I/O pressure.
   `.postmortems/2025-11-05-database-supabase-outage.md` documents an
   `ACCESS EXCLUSIVE` lock from this manual procedure queuing behind vacuum.
   Separately, `20260715090000_topup_xai_zdr_backfill.sql` documents I/O
   saturation on the normal deploy path despite its own 15-minute timeout.
   For large backfills, use bounded PK-range batches and pacing as that
   migration does.

5. If dbmate could not be used, apply the entire pending batch in timestamp
   order before recording versions; `migrate --strict` rejects out-of-order
   pending versions. Only after the up body has fully completed (including
   every statement of a `transaction:false` migration), record its version:

   ```sql
   INSERT INTO dbmate.schema_migrations (version)
   VALUES ('<migration_timestamp>');
   ```

   Do not assume every migration uses the database's `8s` default; some set
   their own timeout.

# Running Ad-hoc (Non-mutating) Queries

For ad-hoc, non-mutating queries, use [Cloud SQL
Studio](https://console.cloud.google.com/sql/instances/pg-us-central1/studio?project=openrouter-core):

1. Select the `postgres` database → **IAM database authentication** →
   **Authenticate**.
2. Query text taking over 3s is logged by `auto_explain` and forwarded through
   Cloud Logging to Datadog; result rows are not logged. Do not inline customer
   emails or `clerk_user_id` values in SQL literals.
3. To raise the timeout for this role, run:

   ```sql
   ALTER ROLE "YOUR_EMAIL@openrouter.ai" SET statement_timeout = '10min';
   ```

   Re-Authenticate after changing the role; `ALTER ROLE` is applied from
   `pg_db_role_setting` at login. When finished, clean it up:

   ```sql
   ALTER ROLE "YOUR_EMAIL@openrouter.ai" RESET statement_timeout;
   ```

# Adding data to seed.sql

Some tests expect that IDs are consistent. Only ever add rows to the end of each insert statement.
