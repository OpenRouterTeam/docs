# Impact analysis: explicit credit-limit choice, $100 guided-flow cap, and 180-day default expiry on new API keys

Design-change note (2026-09-16): the measurements below were gathered for an earlier design that pre-filled $250 in the create-key modal. The shipped design differs: the modal has no default and requires an explicit choice ($50, $250, $1,000, a custom amount, or No limit) before a key can be created, and onboarding and quickstart apply a fixed $100 lifetime cap and state it on the key card. The $250 figures therefore describe potential exposure for users who pick the $250 preset, not a silent default. The 180-day expiry default shipped as analyzed.

Data as of 2026-09-13 (ClickHouse `analytics.*`, freshness: `dim_api_keys.created_at` max 2026-09-13 02:28 UTC). Scope: inference keys created through the dashboard/onboarding/quickstart paths. Excludes provisioning keys, keys created via the provisioning API (`parent_api_key IS NOT NULL`), Connect keys, and MCP-client keys, which are not touched by this change.

## Conclusion

The 180-day expiry default will interrupt a meaningful, measurable slice of real workloads unless the user changes it at creation time. The credit limit no longer has a silent default in the modal, so its exposure is bounded to users who explicitly pick a preset that is too small for the workload, and to onboarding and quickstart keys, which get a fixed $100 cap. Both limits bite hardest on the largest accounts, and today those accounts almost never set a limit or an expiry themselves.

- **$250 lifetime cap (if explicitly chosen).** For accounts spending >= $10k/90d, 36% of the keys they create go on to cumulatively spend >= $250, with a median time-to-$250 of 15 days (enterprise: 32%, median 8 days). 36% of those keys cross $250 inside the first week. Historically 51% of those accounts' active keys have no limit set at all. Under the shipped design a big-account user reaches this exposure only by selecting the $250 preset; the modal does not pre-fill it. Guided-flow keys ($100 cap) belong to brand-new accounts, which fall in the < $1k/90d tier where 0.8% of keys reach $250.
- **180-day expiry.** In the cohort of keys created 200-300 days ago, ~25% of keys owned by >= $10k/90d and enterprise accounts were still in use after day 180 and spent ~$10.7M after that point. 89% of those big-account keys had no expiry set, so under the new default they would have hard-stopped on day 180.
- **Today's steady state.** 25.7% of all inference spend in the last 90 days runs on keys older than 180 days; for >= $10k/90d accounts it is 32.8%.
- **Account-level policy is not a mitigating factor.** Only 166 accounts (of 13.6M) have `max_api_key_expiry_seconds` set. The code shortens the default to the policy when the policy is stricter, so the 82 accounts with a <180d policy are handled, but this covers almost no one.
- **Likelihood of silent breakage.** There is no low-balance or approaching-expiry notification today. Enterpret shows 204 feedback records in the last 180 days on "API Key Expiration And Revocation" and 5 on "Per-api Key Limits And Overruns (402)", so users already hit these failure modes and report them reactively. The $250 cap fails fast (median 8-15 days for big accounts, 12% within the first day), which makes it likely to be noticed during development rather than in production. The 180-day expiry fails long after the creation decision and is the higher silent-breakage risk.
- **Counter-signal in favor of the change.** 78 Enterpret records in 180 days on "Abnormal charges from compromised API keys". A lifetime cap directly bounds that loss.

## Recommendation

Ship the explicit-choice modal and the $100 guided-flow cap as-is (a finite cap fails fast, and the modal makes the choice visible and required). Pair the 180-day default with, at minimum, an approaching-expiry notification before rollout, or ship the expiry default behind a flag for non-enterprise accounts first. Both notifications are out of scope for this PR.

## Measurements

All queries run read-only against ClickHouse Cloud via the analytics MCP. `dim_api_keys.usage` (lifetime counter) undercounts pre-cutover usage, so spend is measured from `fact_daily_generations_activity` instead.

### M1. Active keys in the last 90 days by account tier

Tier = owning account's `dim_users.usage_90d` (enterprise = `is_enterprise = 1`). "keys > $250" = key's own 90-day spend > $250.

| tier | active keys | accounts | usage 90d | keys > $250 | share of keys | share of usage on those keys | keys > 180d old | share of usage on keys > 180d old | share with limit set | share with expiry set |
|---|---|---|---|---|---|---|---|---|---|---|
| acct >= $10k/90d | 22,064 | 2,452 | $84.2M | 8,616 | 39.1% | 99.3% | 3,546 | 32.8% | 48.6% | 10.3% |
| enterprise | 8,836 | 299 | $55.6M | 1,854 | 21.0% | 99.6% | 585 | 27.8% | 34.6% | 17.0% |
| acct $1k-10k/90d | 81,195 | 17,981 | $48.9M | 25,744 | 31.7% | 96.0% | 12,608 | 18.4% | 39.5% | 8.2% |
| acct $250-1k/90d | 133,042 | 38,753 | $17.5M | 30,299 | 22.8% | 78.9% | 17,819 | 17.4% | 34.0% | 8.3% |
| acct < $250/90d | 4,406,760 | 3,073,505 | $19.7M | 0 | 0% | 0% | 418,282 | 14.5% | 16.3% | 6.1% |

### M2. Keys created 90-270 days ago: how many reach a cumulative $250, and how fast

| tier | keys with usage | keys reaching $250 | share | median days to $250 | p90 days | within 1 day | within 7 days | after 30 days | spend on those keys |
|---|---|---|---|---|---|---|---|---|---|
| acct >= $10k/90d | 17,819 | 6,399 | 35.9% | 15 | 86 | 777 | 2,314 | 2,159 | $77.6M |
| enterprise | 4,479 | 1,415 | 31.6% | 8 | 87 | 377 | 689 | 410 | $57.4M |
| acct $1k-10k/90d | 62,271 | 16,245 | 26.1% | 27 | 104 | 870 | 3,721 | 7,621 | $39.2M |
| acct < $1k/90d (current) | 5,476,534 | 44,823 | 0.8% | 32 | 123 | 3,198 | 10,280 | 22,874 | $54.3M |

Roughly 69k keys reached $250 in a six-month creation window, about 2,650 per week, of which ~300/week belong to >= $10k or enterprise accounts.

### M3. Keys created 200-300 days ago: still in use after day 180?

| tier | keys with usage | still active after day 180 | share | active in last 20 days | spend after day 180 | of which on keys with no expiry set | share with expiry set |
|---|---|---|---|---|---|---|---|
| acct >= $10k/90d | 4,972 | 1,227 | 24.7% | 952 | $7.98M | $7.80M | 10.8% |
| enterprise | 1,248 | 294 | 23.6% | 237 | $2.76M | $2.63M | 11.7% |
| acct $1k-10k/90d | 19,344 | 5,045 | 26.1% | 3,922 | $2.47M | $2.43M | 7.7% |
| acct < $1k/90d | 1,875,660 | 131,922 | 7.0% | 56,655 | $1.47M | $1.44M | 7.1% |

### M4. Account-level expiry policy prevalence

`stg_users`: 166 accounts with `max_api_key_expiry_seconds` set (7 distinct values), 82 stricter than 180 days, out of 13,647,618 accounts.

### M5. Customer feedback (Enterpret, last 180 days, subtheme record counts)

- API Key Expiration And Revocation: 204 (https://dashboard.enterpret.com/openrouter/citations/e5b20f92-3e7a-4a15-8e1f-c7b872cb5828)
- Abnormal charges from compromised API keys: 78 (https://dashboard.enterpret.com/openrouter/citations/072733a3-9591-4c78-b09c-cd746bcefc32)
- API Key Limit Semantics: 5 (https://dashboard.enterpret.com/openrouter/citations/0ac75807-4e64-4001-b741-3de6b7ce0671)
- Per-api Key Limits And Overruns (402): 5 (https://dashboard.enterpret.com/openrouter/citations/9006dcfa-2c33-40fc-9f91-4b8da72c2607)
- Delayed Api Key Limit Enforcement: 2
- Enable API Key Expiration: 1
- Api Key Limits Fail To Prevent Overspending: 1

## Limitations

- Tier is by the account's current 90-day spend, so accounts that were large 6-9 months ago and have since shrunk appear in the small tier in M2/M3. This understates big-account exposure, it does not overstate it.
- The analysis measures how many keys would have hit a $250 cap or a 180-day expiry if nothing else changed. It cannot measure how many users will pick a preset, a custom amount, or No limit in the shipped modal, nor how many will change the expiry dropdown from its 180-day default (a "Never" option remains). M1-M3 were gathered for the earlier pre-filled-$250 design; read the $250 columns as exposure for explicit $250 choices. Onboarding and quickstart keys have no form, so those keys always get the $100 cap and the 180-day expiry.
- Enterpret counts are tagged feedback records, not distinct customers.
- The M2 window (keys 90-270 days old) gives every key at least 90 days to reach $250. Some keys would cross later; M2 is a lower bound on the eventual share.

## Queries

<details><summary>M1</summary>

```sql
WITH k AS (SELECT api_key_id, created_at, `limit`, expires_at, clerk_user_id FROM analytics.dim_api_keys
  WHERE is_provisioning_key = 0 AND parent_api_key IS NULL AND deleted = 0 AND is_connect_key = 0 AND mcp_client_id IS NULL),
a AS (SELECT api_key_id, sum(`usage`) AS usage_90d FROM analytics.fact_daily_generations_activity
  WHERE date >= now() - INTERVAL 90 DAY GROUP BY api_key_id),
u AS (SELECT clerk_user_id, any(is_enterprise) AS is_enterprise, any(usage_90d) AS acct_usage_90d FROM analytics.dim_users GROUP BY clerk_user_id)
SELECT multiIf(u.is_enterprise = 1, 'enterprise', u.acct_usage_90d >= 10000, 'acct >=$10k/90d', u.acct_usage_90d >= 1000, 'acct $1k-10k/90d', u.acct_usage_90d >= 250, 'acct $250-1k/90d', 'acct <$250/90d') AS tier,
  count() AS active_keys, uniq(k.clerk_user_id) AS accounts, round(sum(a.usage_90d)) AS usage_90d,
  countIf(a.usage_90d > 250) AS keys_90d_over_250, round(countIf(a.usage_90d > 250)/count(),4) AS share_keys_over_250,
  round(sumIf(a.usage_90d, a.usage_90d > 250)/sum(a.usage_90d),4) AS usage_share_over_250,
  countIf(k.created_at < now() - INTERVAL 180 DAY) AS keys_older_180d,
  round(sumIf(a.usage_90d, k.created_at < now() - INTERVAL 180 DAY)/sum(a.usage_90d),4) AS usage_share_older_180d,
  round(countIf(k.`limit` IS NOT NULL)/count(),4) AS share_with_limit, round(countIf(k.expires_at IS NOT NULL)/count(),4) AS share_with_expiry
FROM a INNER JOIN k USING api_key_id LEFT JOIN u ON u.clerk_user_id = k.clerk_user_id
GROUP BY tier ORDER BY usage_90d DESC
```
</details>

<details><summary>M2</summary>

```sql
WITH k AS (SELECT api_key_id, created_at, clerk_user_id FROM analytics.dim_api_keys
  WHERE is_provisioning_key = 0 AND parent_api_key IS NULL AND is_connect_key = 0 AND mcp_client_id IS NULL
    AND created_at >= now() - INTERVAL 270 DAY AND created_at < now() - INTERVAL 90 DAY),
d AS (SELECT f.api_key_id, toDate(f.date) AS day, sum(f.`usage`) AS u FROM analytics.fact_daily_generations_activity f
  INNER JOIN k ON k.api_key_id = f.api_key_id WHERE f.date >= now() - INTERVAL 270 DAY GROUP BY f.api_key_id, day),
c AS (SELECT api_key_id, day, sum(u) OVER (PARTITION BY api_key_id ORDER BY day) AS cum FROM d),
hit AS (SELECT api_key_id, min(day) AS hit_day, 1 AS did_hit FROM c WHERE cum >= 250 GROUP BY api_key_id),
tot AS (SELECT api_key_id, sum(u) AS total FROM d GROUP BY api_key_id),
u AS (SELECT clerk_user_id, any(is_enterprise) AS is_enterprise, any(usage_90d) AS acct_usage_90d FROM analytics.dim_users GROUP BY clerk_user_id)
SELECT multiIf(u.is_enterprise = 1, 'enterprise', u.acct_usage_90d >= 10000, 'acct >=$10k/90d', u.acct_usage_90d >= 1000, 'acct $1k-10k/90d', 'acct <$1k/90d') AS tier,
  count() AS keys_created_with_usage, countIf(hit.did_hit = 1) AS keys_hit_250, round(countIf(hit.did_hit = 1)/count(),4) AS share_hit_250,
  quantileIf(0.5)(dateDiff('day', toDate(k.created_at), hit.hit_day), hit.did_hit = 1) AS median_days_to_250,
  quantileIf(0.9)(dateDiff('day', toDate(k.created_at), hit.hit_day), hit.did_hit = 1) AS p90_days_to_250,
  countIf(hit.did_hit = 1 AND dateDiff('day', toDate(k.created_at), hit.hit_day) <= 1) AS hit_250_within_1d,
  countIf(hit.did_hit = 1 AND dateDiff('day', toDate(k.created_at), hit.hit_day) <= 7) AS hit_250_within_7d,
  countIf(hit.did_hit = 1 AND dateDiff('day', toDate(k.created_at), hit.hit_day) > 30) AS hit_250_after_30d,
  round(sumIf(tot.total, hit.did_hit = 1)) AS usage_on_keys_that_hit
FROM tot INNER JOIN k USING api_key_id LEFT JOIN hit USING api_key_id LEFT JOIN u ON u.clerk_user_id = k.clerk_user_id
GROUP BY tier ORDER BY keys_hit_250 DESC
```
</details>

<details><summary>M3</summary>

```sql
WITH k AS (SELECT api_key_id, created_at, clerk_user_id, `limit`, expires_at FROM analytics.dim_api_keys
  WHERE is_provisioning_key = 0 AND parent_api_key IS NULL AND is_connect_key = 0 AND mcp_client_id IS NULL
    AND created_at >= now() - INTERVAL 300 DAY AND created_at < now() - INTERVAL 200 DAY),
a AS (SELECT f.api_key_id, sum(f.`usage`) AS total,
  sumIf(f.`usage`, f.date >= k.created_at + INTERVAL 180 DAY) AS usage_after_180,
  sumIf(f.`usage`, f.date >= k.created_at + INTERVAL 180 DAY AND f.date >= now() - INTERVAL 20 DAY) AS usage_last_20d,
  countIf(DISTINCT toDate(f.date), f.date >= k.created_at + INTERVAL 180 DAY) AS active_days_after_180
  FROM analytics.fact_daily_generations_activity f INNER JOIN k ON k.api_key_id = f.api_key_id
  WHERE f.date >= now() - INTERVAL 300 DAY GROUP BY f.api_key_id),
u AS (SELECT clerk_user_id, any(is_enterprise) AS is_enterprise, any(usage_90d) AS acct_usage_90d FROM analytics.dim_users GROUP BY clerk_user_id)
SELECT multiIf(u.is_enterprise = 1, 'enterprise', u.acct_usage_90d >= 10000, 'acct >=$10k/90d', u.acct_usage_90d >= 1000, 'acct $1k-10k/90d', 'acct <$1k/90d') AS tier,
  count() AS keys_with_usage, countIf(a.active_days_after_180 > 0) AS keys_still_active_after_180d,
  round(countIf(a.active_days_after_180 > 0)/count(),4) AS share_still_active, countIf(a.usage_last_20d > 0) AS keys_active_now,
  round(sum(a.usage_after_180)) AS usage_after_180d, round(sumIf(a.usage_after_180, k.expires_at IS NULL)) AS usage_after_180d_no_expiry_set,
  round(countIf(k.expires_at IS NOT NULL)/count(),4) AS share_with_expiry_set
FROM a INNER JOIN k USING api_key_id LEFT JOIN u ON u.clerk_user_id = k.clerk_user_id
GROUP BY tier ORDER BY usage_after_180d DESC
```
</details>

<details><summary>M4</summary>

```sql
SELECT countIf(max_api_key_expiry_seconds IS NOT NULL) AS accounts_with_policy, count() AS accounts,
  uniqExactIf(max_api_key_expiry_seconds, max_api_key_expiry_seconds IS NOT NULL) AS distinct_values,
  countIf(max_api_key_expiry_seconds IS NOT NULL AND max_api_key_expiry_seconds < 180*86400) AS policy_stricter_than_180d
FROM analytics.stg_users
```
</details>

<details><summary>M5 (Enterpret Cypher)</summary>

```cypher
MATCH (nli:NaturalLanguageInteraction)-[:SUMMARIZED_BY]->(fi:FeedbackInsight)-[:HAS_TAGS]->(cft:CustomerFeedbackTags)-[:HAS_SUBTHEME]->(st:Subtheme)
WHERE st.type != 'MISC' AND nli.record_timestamp >= now() - INTERVAL 180 DAY AND st.display_name IN [ ...key limit / expiry subthemes... ]
RETURN st.display_name AS subtheme, COUNT(DISTINCT nli.record_id) AS total ORDER BY total DESC
```
</details>
