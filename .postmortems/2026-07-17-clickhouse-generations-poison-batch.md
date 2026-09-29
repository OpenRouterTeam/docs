# ClickHouse Generations Poison-Batch Backlog — 2026-07-17 → 2026-07-20 Post-Mortem

| | |
| --- | --- |
| **Status** | Recovered — fix [#29375](https://github.com/OpenRouterTeam/openrouter-web/pull/29375) merged 2026-07-20 15:43 UTC (deploy took effect within minutes); backlog drained ~89.9M peak → ~20k baseline by 16:50 UTC; monitor `1128988` back to **OK** and holding. |
| **Severity** | Medium — user-visible (delayed/gappy dashboards); inference request path unaffected |
| **Duration** | Poison introduced 2026-07-17 21:24 UTC (#29170 merged); alert fired 2026-07-18 13:59 UTC; fix merged 2026-07-20 15:43 UTC; backlog fully drained / monitor recovered 2026-07-20 16:50 UTC |
| **Affected system** | `pull-insert-generations-clickhouse` Pub/Sub subscription → ClickHouse `generations` table |
| **Subsystems** | `clickhouse`, `pubsub`, `routing`, `plugins`, `monitoring` |

---

## TL;DR

A single malformed generation row poisoned the all-or-nothing ClickHouse
insert batches for the `generations` table, stalling the
`pull-insert-generations-clickhouse` queue and delaying analytics ingestion
that backs user dashboards. The bad value —
`endpoint_id = "router-placeholder-openrouter/bodybuilder"` — is a non-UUID
string written into a ClickHouse `UUID` column. It originated from
[#29170](https://github.com/OpenRouterTeam/openrouter-web/pull/29170) (merged
07-17 21:24 UTC), which began persisting a lineage-root generation for the
server-tools orchestration turn; for `openrouter/bodybuilder` that parent turn
has no upstream provider call and never resolves off the transient
`router-placeholder-*` endpoint. Because the batch processor nacks the whole
2000-row batch on any insert error, no batch could be acked, so valid
generation messages piled up behind the poison rows and the Pub/Sub backlog
grew to ~89.9M undelivered messages (peak 07-20 15:52 UTC). Fix
[#29375](https://github.com/OpenRouterTeam/openrouter-web/pull/29375) — nulling
placeholder `endpoint_id`s at both the producer (`init-tx.ts`,
`convert-to-clickhouse.ts`) and consumer (`sanitizeGenerationEndpointIds`) —
merged 07-20 15:43 UTC and deployed within minutes; the backlog began draining
and returned to its ~20k baseline by 16:50 UTC, with monitor `1128988`
recovering to OK.

---

## Timeline (all times UTC)

| Time | Event |
| --- | --- |
| 2026-07-17 21:24 | [#29170](https://github.com/OpenRouterTeam/openrouter-web/pull/29170) "show server-tools chats in Logs" merged — begins persisting a zero-usage lineage-root generation for the server-tools orchestration turn. |
| 2026-07-17 ~21:30 | First `openrouter/bodybuilder` root row written with `endpoint_id = router-placeholder-openrouter/bodybuilder`; the `JSONEachRow` batch insert fails; `oldest_unacked_message_age` begins a linear ~1s/s climb (poison stuck). |
| 2026-07-18 ~10:30 | `num_undelivered_messages` begins a sustained climb (above the noisy ~15k baseline) as poison rows accumulate and re-nacked batches compound. |
| 2026-07-18 12:50 | Backlog crosses the 50k monitor threshold. |
| 2026-07-18 13:59 | Datadog monitor `1128988` fires in `#alerts-api` (~107k undelivered). Devin auto-triage spawned. |
| 2026-07-18 14:09 | Devin posts poison-batch diagnosis: one bad row fails the batch, `batch-processor` nacks all ~2000 msgs, no per-row isolation/DLQ. |
| 2026-07-18 14:15 | @James Sterling asks whether a code change caused it. |
| 2026-07-18 14:21–14:22 | @John Krauss (talos): "we should dead-letter on a bad row?"; confirms **user impact** — delayed CH ingestion makes user dashboards stale/gappy (not internal-only). |
| 2026-07-18 14:32 | [#29250](https://github.com/OpenRouterTeam/openrouter-web/pull/29250) opened — bounded, PII-scoped logging of the failing field + `generation_id` + `clerk_user_id`. |
| 2026-07-18 16:23 | @John Krauss merges [#29250](https://github.com/OpenRouterTeam/openrouter-web/pull/29250). |
| 2026-07-20 15:21 | Logs (from #29250) surface the exact bad value: `bad_field endpoint_id = router-placeholder-openrouter/bodybuilder`, ~0.5M rows. |
| 2026-07-20 15:26 | Devin traces root cause to [#29170](https://github.com/OpenRouterTeam/openrouter-web/pull/29170) (server-tools lineage-root persistence on the placeholder endpoint). |
| 2026-07-20 15:43 | [#29375](https://github.com/OpenRouterTeam/openrouter-web/pull/29375) (Joseph Ciesielski) merged — nulls placeholder `endpoint_id` at both producer (`init-tx.ts`, `convert-to-clickhouse.ts`) and consumer (`sanitizeGenerationEndpointIds`); deploy takes effect over the next few minutes. |
| 2026-07-20 15:46 | [#29380](https://github.com/OpenRouterTeam/openrouter-web/pull/29380) opened — a parallel defensive coercion at the insert boundary; superseded by #29375's consumer fix, since rebased to add only the sampled diagnostic logging John requested. |
| 2026-07-20 15:52 | Backlog peaks at ~89.9M undelivered messages, then drains at ~1M/min as the deploy takes effect. |
| 2026-07-20 16:37 | Backlog down to ~58M and falling ~1M/min. |
| 2026-07-20 16:50 | Backlog fully drained to its ~20k baseline; monitor `1128988` recovers to **OK** and holds steady thereafter. |

---

## Root Cause

- **Trigger
  ([#29170](https://github.com/OpenRouterTeam/openrouter-web/pull/29170)):** To
  make server-tools chats appear in Logs, the PR added
  `Router.#submitServerToolsRootGeneration` (`packages/router/index.ts`), which
  for the first time persists a zero-usage lineage-root generation for the
  outer server-tools orchestration turn. It calls `initTx({ endpoint, ... })`
  → `endpoint_id: endpoint.id`.
- **Why `openrouter/bodybuilder`:** bodybuilder orchestrates via the
  `search_models` server tool. The real work happens in recursive **child**
  requests (each resolves its own placeholder to a real endpoint and is
  billed); the **parent** orchestration turn makes no upstream provider call of
  its own, so it hits the `!currentAdapter` root path (`index.ts:3002-3003`)
  still holding the `router-placeholder-*` endpoint — nothing ever resolves it
  because there's no provider call to resolve it against. The root row is thus
  persisted with `endpoint_id = "router-placeholder-openrouter/bodybuilder"`.
  This is a modeling gap (parent turn has no single concrete endpoint), not a
  failed resolution.
- **Why it breaks ClickHouse:** the column is `endpoint_id UUID`
  (`packages/clickhouse/migrations/1_create_generations_table.sql:36`). A
  non-UUID string can't be parsed → the all-or-nothing `JSONEachRow` batch
  insert fails.
- **Amplifier (pre-existing):** on any insert error the queue batch processor
  `nackAll`s the entire batch
  (`services/gcp-queue-worker/src/batch-processor.ts`, `BATCH_SIZE=2000`), so
  the ~1999 valid messages in a poisoned batch can never be acked and stay in
  the backlog while newly published messages pile up behind them → snowballing
  backlog.
- **Why type-safety missed it:** `endpoint_id` is typed as plain `string`
  app-side (CH row interface `string | null`; Zod `z.string().nullish()`). A
  valid string compiles and passes Zod; the UUID constraint lives only in the
  ClickHouse DDL, which TS/Zod don't model.

**Scope:** confirmed impact is `openrouter/bodybuilder` only (all ~0.5M poison
rows carried the bodybuilder placeholder). Every virtual router (`auto`,
`free`, `fusion`, `phaser`, `pareto-code`, etc.) enters routing on a
`router-placeholder-*` endpoint (`createRouterModelPlaceholderEndpoint`,
`cache.ts:163-174`), so the mechanism is not hard-coded to bodybuilder — any
router is a latent variant if it persists a generation while the outer endpoint
is still a placeholder. Bodybuilder is the one that does so today, via #29170's
server-tools orchestration-root persistence. No other `router-placeholder-*`
value appeared at volume in the logs; not independently confirmed against
ClickHouse.

---

## Impact

- **Backlog:**
  `gcp.pubsub.subscription.num_undelivered_messages{subscription_id:pull-insert-generations-clickhouse}`
  grew from a ~15k noisy baseline to a peak of **~89.9M** undelivered messages
  (07-20 15:52 UTC). This is the total queued backlog — the ~0.5M poison rows
  plus all the valid generation messages that accumulated behind them over ~2.5
  days because no batch could be acked (nacking/redelivering a message does not
  create additional backlog entries). Fully drained back to its ~20k baseline
  by 16:50 UTC (~67 min after the fix merged).
- **Affected rows:** ~0.5M generation records carrying the invalid
  `endpoint_id` (per @John Krauss's log query); ClickHouse parse-error rate
  ~10-13k/hr (error 27, per #29375).
- **Stuck duration:**
  `gcp.pubsub.subscription.oldest_unacked_message_age` climbing linearly at
  ~1s/s from 07-17 ~21:30 UTC until the 07-20 15:43 UTC fix (~66h).
- **User-visible:** delayed ClickHouse generations ingestion → stale/incomplete
  **user dashboards**. The inference/request path (chat completions) was
  **not** affected.
- **Data-loss risk (did not materialize):** valid messages co-stuck in poison
  batches age toward the subscription's `message_retention_duration` (~7 days
  from publish → ~07-24 UTC). The full drain completed 07-20 16:50 UTC, well
  inside the retention window, so no messages expired — no permanent dashboard
  gaps expected (pending the error-27 / backfill check below).

*Datadog metrics referenced:*
`gcp.pubsub.subscription.num_undelivered_messages`,
`gcp.pubsub.subscription.oldest_unacked_message_age` (monitor `1128988`, query
`min(last_15m):sum:gcp.pubsub.subscription.num_undelivered_messages{...} by {subscription_id} > 50000`).

---

## Mitigation

- **[#29250](https://github.com/OpenRouterTeam/openrouter-web/pull/29250)
  (merged 07-18):** bounded, PII-scoped logging of the failing ClickHouse
  field plus `generation_id` and `clerk_user_id`. Redaction blocklist derived
  from the DSR scrub set (`SCRUB_GENERATION_COLUMNS`) with a drift-guard test.
  This surfaced the exact poison value.
- **[#29375](https://github.com/OpenRouterTeam/openrouter-web/pull/29375)
  (merged 07-20 15:43 UTC) — primary fix:** nulls placeholder `endpoint_id`s at
  both ends. Producer: `init-tx.ts` and `convert-to-clickhouse.ts` emit
  `endpoint_id: null` for placeholder endpoints (fixes the source, incl. the
  #29170 orchestration root). Consumer: `parseGenerations` →
  `sanitizeGenerationEndpointIds` coerces *any* non-UUID `endpoint_id` → `null`
  (general, not placeholder-specific) and emits a
  `generations.endpoint_id_sanitized` counter. The consumer half heals the
  existing backlog on redelivery without enabling the DLQ.
- **[#29380](https://github.com/OpenRouterTeam/openrouter-web/pull/29380)
  (open):** opened in parallel as the insert-boundary coercion; its core fix is
  now redundant with #29375's consumer half. Rebased onto main to retain only
  the sampled (~1/10,000) diagnostic logging John requested for continued
  source diagnosis — an allowlist-projected set of non-PII routing/shape fields
  (`pickLoggableGenerationFields`), which omits client-derived PII rather than
  denylisting the DSR scrub columns. Pending decision to keep-for-logging or
  close.

---

## Follow-ups (priority order)

1. **Confirm ingestion caught up** — backlog + monitor `1128988` recovered ✓;
   still verify the ClickHouse error-27 rate on `generations` inserts has
   dropped to ~0 and that no affected dashboards show lingering gaps.
2. **Backfill assessment** — determine whether the ~0.5M stuck generations
   replay cleanly as the backlog drains, before the subscription's
   `message_retention_duration` (~7 days) causes permanent gaps in affected
   dashboards.
3. **Row-level DLQ isolation in the queue worker** — on insert failure, split
   the poison row out (ClickHouse names the `at row N` index), ack the ~1999
   valid messages, and route only the bad row to a DLQ instead of `nackAll`.
   Also confirm/set the subscription's `dead_letter_policy` and
   `message_retention_duration` in IaC (no DLQ-worker logs seen → likely
   unwired).
4. **Close the type-safety gap** — model `endpoint_id` as a branded UUID / Zod
   `.uuid()` so a non-UUID can't reach the CH boundary undetected in the first
   place.
5. **Decide on
   [#29380](https://github.com/OpenRouterTeam/openrouter-web/pull/29380)** —
   keep it purely for the sampled diagnostic logging, or close it now that
   #29375 covers the fix.
6. **Server-tools parent-generation modeling** — sanity-check that other latent
   router variants can't reintroduce a non-null placeholder root now that
   #29170's path nulls it via `init-tx.ts`.

---

## What went well

- Auto-triage fired within ~1 minute of the alert and produced an accurate
  poison-batch diagnosis (~10 min).
- Logging was intentionally bounded and PII-scoped (derived from the DSR scrub
  set), surfacing the exact bad value without exposing user data.
- Clean root-cause chain from the logged value → #29170; the fix hardens both
  ends — the producer nulls the placeholder at the source, and the
  router-agnostic consumer coercion means no future non-UUID can re-poison a
  batch.
- Paging discipline: the incident owner explicitly avoided over-paging ("let
  sam sleep").

## What could be improved

- **Type system didn't model the UUID constraint** — a DDL-only constraint
  invisible to TS/Zod allowed a non-UUID to reach the insert.
- **No per-row isolation / DLQ** in the batch processor — one bad row can stall
  ~1999 good ones indefinitely.
- **Click-ops'd subscription** — `dead_letter_policy` /
  `message_retention_duration` weren't in IaC and couldn't be verified from
  logs.
- **~2-day detection-to-root-cause gap** — the offending value wasn't logged
  until #29250 shipped (07-18) and was only read on 07-20. Field-level logging
  on insert failure by default would have shortened TTR.

---

## Related

- **[Cache-hit generations wrote NULL `endpoint_id` — 2026-07-30](2026-07-30-cache-hit-null-endpoint-sentinel.md)** — a separate but related `endpoint_id`-hygiene follow-up. Response-cache hits wrote a valid NULL `endpoint_id`. The NULL inserted without error but polluted analytics. The fix writes an all-zero sentinel instead ([#29563](https://github.com/OpenRouterTeam/openrouter-web/pull/29563)). That incident shares the same modeling gap as this one, the value `endpoint_id` holds for a generation with no resolved real endpoint. The coercion in #29375 did not cause it.

## Participants

- **John Krauss** (talos) — incident owner, insert-pipeline; drove diagnosis,
  PII review, merged #29250, reviewed #29375/#29380.
- **James Sterling** — triage direction; requested the code-change
  investigation and the UUID fix PR.
- **Joseph Ciesielski** (`jtcies`, Slack `U0A0ERZF2UV`) — authored & merged the
  primary fix #29375 (producer + consumer nulling).
- **Matthew Young** — owner of the #29170 server-tools area (cc'd). *(Slack ID
  not confirmed against `#alerts-api` workspace.)*
- **Devin** — auto-triage: diagnosis, root cause, #29250 + #29380 (sampled
  diagnostic logging).
- Sam Barnes — intentionally not paged ("let sam sleep").

## References

- PR [#29170](https://github.com/OpenRouterTeam/openrouter-web/pull/29170) —
  root cause (server-tools lineage-root persistence).
- PR [#29250](https://github.com/OpenRouterTeam/openrouter-web/pull/29250) —
  bounded bad-row logging (merged).
- PR [#29375](https://github.com/OpenRouterTeam/openrouter-web/pull/29375) —
  primary fix: null placeholder `endpoint_id` at producer + consumer (merged).
- PR [#29380](https://github.com/OpenRouterTeam/openrouter-web/pull/29380) —
  parallel insert-boundary coercion; rebased to sampled diagnostic logging only
  (open).
- [Slack thread —
  #alerts-api](https://openrouter.slack.com/archives/C0594EAV9U6/p1784383174161789)
- Datadog monitor `1128988` — "Subscription {{subscription_id.name}} has a
  large backlog".
