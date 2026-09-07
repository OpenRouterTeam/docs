# usage-record service

Service to access usage records, eg Spanner. Handles generation writes, pending charges (including per-pool credit pool tracking), async job billing (with cached upstream Files API output file IDs), and billable entity management. Query endpoints default to a 30-day lookback when `from` is not set. A recurring cron (`settleStaleCharges`) finds stale, non-terminal async jobs and settles their lingering pending charges. The Dataflow pipeline batches generation writes (production batch-min-size of 5) and keeps async-job charge Spanner transactions low-priority to avoid contending with the generation write path. Generations run as two Dataflow lanes, interactive and batch, which write disjoint `generation_shards` / `budget_usage` shard ranges (interactive `0-13`, batch `14-15`) so the two jobs never contend on the same rows; see the [dataflow README](dataflow/README.md#generation-lanes-and-shard-ranges). The staging Dataflow deploy script can seek the staging subscription to any point within the last 6 hours for replay-based experiments. The DLQ replay workflow imports dead-lettered messages from GCS for an explicit source — either the generations DLQ or the async-jobs DLQ. Spanner schema changes live in `spanner/migrations/` (see its README); tables spill older data to HDD via locality groups while indexes stay on SSD.

## Architecture

```mermaid
graph TD
    CfwApi["cfw-api\nservice binding"] -->|publish| Worker["usage-record Worker\nport 8801"]
    Worker --> PubSub["Google PubSub"]
    PubSub --> Dataflow["Apache Beam Pipeline\nasync_job + generation writers"]
    Dataflow --> Spanner["Google Spanner\ngenerations · billable_entities\nasync_jobs · pending_charges\nnotification_alert_deliveries"]
    Spanner --> QueryAPI["Query Endpoints\n/generation · /credits · /pending-charges"]
```

You can read more about why Spanner needs to be accessed
through this service
[here](https://www.notion.so/openrouter/RFC-Transaction-Table-Usage-Metering-Migration-Spanner-28c2fd57c4dc80a39334d3ae1608a94a?source=copy_link#2cb2fd57c4dc80a7afe5c0835855a3d7),
but in a nutshell:

- This service controls access to the usage-record Spanner
  database
- This database contains records critical to us handling
  credit usage limits, eg `generations` and
  `billable_entities`
- This service is called by cfw-api through a
  [service binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/).
  Non-Cloudflare consumers must call endpoints on cfw-api
  in order to access data in the usage-record database

All business logic in this service should be narrowly
focused on ensuring correct usage of the usage-record
database. Only endpoints that fall in the scope of reading
from and writing to usage-record tables belong in this
service.

## Running locally

### With Tilt (recommended)

From the repo root:

```bash
tilt up
```

Use `TILT_PROFILE=lean tilt up` if encountering OOM.

There is also a k8s-based setup, though this is harder to work
with:

```bash
bun run x scripts/tilt-dev.ts
```

Wait for cfw-api (or "api") to come up on the
[Tilt dashboard](http://localhost:10350/r/(all)/overview).
Once up, the DB should be ready to go and seeded.

The relevant Tilt resources are:

- **pubsub** — PubSub emulator on `:8086`
- **dataflow** — Beam pipeline (DirectRunner)
- **spanner** — Spanner emulator on `:9010`/`:9020`
- **usage-record** — Cloudflare Worker that publishes
  generations to PubSub

Generations submitted through the API flow through
PubSub → Dataflow → Spanner, matching the production
path.

Test request:

```bash
curl -H "Authorization: Bearer sk-or-v1-freeuserkey" \
  'http://localhost:8787/api/v1/generation?id=gen-001'
```

Note that Dataflow batches writes, so it can take a
few seconds before generations appear in Spanner unless
you send many.

To verify the full pipeline is working:

1. Send a request to the local API:

   ```bash
   curl http://localhost:8787/api/v1/chat/completions \
     -H "Authorization: Bearer sk-or-v1-unlimitedkey" \
     -H "Content-Type: application/json" \
     -d '{"model":"openai/gpt-4o-mini",
          "messages":[{"role":"user",
          "content":"hello"}]}'
   ```

1. Check the Dataflow container logs for
   `received generation` and `inserting batch` messages.

1. Query the Spanner emulator REST API to confirm the row
   was written:

   ```bash
   # Create a session
   SESSION_ID=$(curl -s -X POST \
     http://localhost:9020/v1/projects/openrouter-dev\
   /instances/dev/databases/usage/sessions \
     -H "Content-Type: application/json" \
     -d '{}' | jq -r .name)

   # Query generations
   curl -s -X POST \
     http://localhost:9020/v1/${SESSION_ID}:executeSql \
     -H "Content-Type: application/json" \
     -d '{"sql":"SELECT generation_id, model
          FROM generations
          ORDER BY started_at DESC LIMIT 5"}'
   ```

### Without Tilt

All commands below run from `services/usage-record`.
Each step runs in its own terminal.

#### 1. Start emulators

```bash
bun run dataflow:emulators
```

This starts the Spanner and PubSub emulators via
`docker compose`. Leave this running.

#### 2. Run Spanner migrations

```bash
bun run spanner:migrate
```

#### 3. Start the pipeline

```bash
bun run dataflow:run
```

The first build takes 1–2 minutes (pip install).
Subsequent builds use the Docker layer cache and are
fast unless `pyproject.toml` or `uv.lock` change.

#### 4. Start the usage-record worker

```bash
bun run dev
```

This starts the Cloudflare Worker that publishes
generations to PubSub (port `8801`).

#### 5. Start the API gateway

From `services/cfw-api`:

```bash
bun run dev
```

This starts the API on `http://localhost:8787`. You can
now send requests and verify the full pipeline using
the same steps as the Tilt section above.

### Integration tests

Integration tests require the Spanner emulator to be
running, which is provided by Tilt:

```bash
bun run test:integration
bun run test:integration:worker
```

### Direct access to Spanner emulator

The Tiltfile will forward port 9020, which you can use
to run commands directly against the Spanner emulator
from the host.
