# Key-leak relay burst family

Companion to migration [`../280_add_key_leak_relay_burst_mv.sql`](../280_add_key_leak_relay_burst_mv.sql). Migration [`../283_rank_key_leak_relay_burst_by_spend.sql`](../283_rank_key_leak_relay_burst_by_spend.sql) modifies the view's query in place, ranking signatures by OpenRouter spend before peak accounts, and carries the current SELECT.

That migration creates the refreshable `default.user_flag_key_leak_relay_burst_v1_mv`, which appends `key_leak_relay_burst` snapshots to `default.user_flag_detections`. It reads only the shared per-key origin aggregates: `default.api_key_origin_minute_v1` (migration 279), which carries the exact client IP hash, ASN and 80-character user-agent prefix as dimensions, and `default.api_key_origin_daily_v1` for the whole days of the novelty baseline. The detector owns no rollup of its own, so there is no detector-specific backfill or validation procedure. Everything about the source table, including how to repopulate history, lives in [`270_add_api_key_origin_v1.md`](./270_add_api_key_origin_v1.md).

## Dependency on the source table

The detection window is the 24 complete clock hours before the snapshot's hour and the novelty baseline is the 30 days before that window, so a snapshot reads the window and the partial day at each end of the baseline from `default.api_key_origin_minute_v1` and the whole baseline days from `default.api_key_origin_daily_v1`, which the daily MV fills from every minute insert. The baseline is keyed by account and key only, so minute rows written before migration 279 (`ip_hash = ''`, `ua80 = ''`) count toward it. Days with no origin rows at all, those before the live MVs started on 2026-09-21 that the reviewed `clickhouse-api-key-origin-v1` backfill has not yet rebuilt, are missing from the baseline, so a keyed pair whose only history sits on such days reads as novel and `novelty_share` is overstated until the backfill finishes or 31 days have passed since 2026-09-21. `burst_ratio`, `zero_cost_share`, `usd_per_pair` and the hourly floors read the window only and are correct as soon as 24 hours of minute rows exist.

Migration 279 adds the two columns in place and does not rewrite existing rows. Pre-279 window rows form no `ip_hash` signature and their `asn_ua` signature key does not match any post-279 key, which matters only for the first 24 hours after 279 applies. Run the backfill through Mission Control as described in the 270 runbook before trusting `novelty_share`.

## Column mapping

The detector aggregates minute rows to `(hour, ip_hash, asn, ua80, clerk_user_id, api_key_id)` participants.

- `api_key_id = -1` marks requests that carried no API key (session traffic). It counts toward a fingerprint's distinct accounts and toward `unresolved_share`, and is never emitted as a flagged pair.
- `ip_hash = ''` marks requests without a client IP hash. Such rows join only the `asn_ua` level.
- `asn = 0` marks requests without an ASN. Such rows join only the `ip_hash` level.
- `ua80 = ''` marks requests without a user agent.
- `own_spend_usd` is the minute table's `usage`, the amount billed to OpenRouter credit. BYOK upstream inference is carried separately in `byok_usage_inference` and is not part of it.
- `zero_cost_requests` uses the minute table's definition, which counts a `usage = 0` request as zero cost only when it did not run on the account's own provider key with a non-zero inference cost.

## Detection family

`user_flag_key_leak_relay_burst_v1_mv` refreshes hourly at minute 10 and appends to `default.user_flag_detections` with `family = 'key_leak_relay_burst'`. Force a refresh and inspect the latest snapshot:

```sql
SYSTEM REFRESH VIEW default.user_flag_key_leak_relay_burst_v1_mv;
SYSTEM WAIT VIEW default.user_flag_key_leak_relay_burst_v1_mv;

SELECT computed_at, count() AS rows, uniqExact(entity_id) AS accounts,
       uniqExact(splitByChar('|', dimension_key)[2]) AS signatures
FROM default.user_flag_detections
WHERE family = 'key_leak_relay_burst'
GROUP BY computed_at
ORDER BY computed_at DESC
LIMIT 5;
```

`dimension_key` is `level|signature_key|api_key_id`. `signature_key` is the client IP hash for level `ip_hash`, and `<asn>:<sipHash64 of ua80>` for level `asn_ua`. Neither carries raw IP, key material or user-agent text. Measurements are the numeric fields listed in `packages/db/risk-flags/catalog.ts` under `KEY_LEAK_RELAY_BURST`, and the `cfw-internal` risk-flag piper upserts the highest-ranked row per account into Postgres risk flags; rules bound recency with `seen_within_ms`.

## Reverse lookup

Every account and key a known-bad client IP hash touched is a direct read of the source table through its `idx_ip_hash` bloom filter. Bound it by `date` so the daily partitions do the first cut:

```sql
SELECT clerk_user_id, api_key_id, min(date) AS first_minute, max(date) AS last_minute, sum(requests) AS requests
FROM default.api_key_origin_minute_v1
WHERE ip_hash = ':ip_hash'
  AND date >= toDateTime(':range_start', 'UTC')
  AND date < toDateTime(':range_end', 'UTC')
GROUP BY clerk_user_id, api_key_id
ORDER BY requests DESC;
```

## Deletion

The detector holds no per-account table. Detections for an account age out of `default.user_flag_detections` under that table's 30-day TTL (migration 237), or delete them by `entity_id`:

```sql
ALTER TABLE default.user_flag_detections
    DELETE WHERE family = 'key_leak_relay_burst' AND entity_id = ':clerk_user_id'
SETTINGS mutations_sync = 2;
```

The source rows in `default.api_key_origin_minute_v1` are keyed by `clerk_user_id` and expire under that table's 35-day TTL. Account erasure that must not wait for the TTL deletes them the same way by `clerk_user_id`.
