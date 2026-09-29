# Gateway Benchmark Model Mappings

Instructions for refreshing the `gateway_benchmark_models` table with the current
top-ranked OpenRouter models and their Vercel / Cloudflare equivalents.

Designed to be run by an AI agent (Devin) on demand.

---

## Prerequisites

- Shell access with `curl` and `python3`.
- A valid Clerk user ID for the `created_by` / `updated_by` columns.
  Use `$CLERK_CREDENTIALS_clerk_user_id` from the environment.

## Step 1 — Fetch the top 20 OpenRouter models

```bash
curl -s 'https://openrouter.ai/api/frontend/v1/rankings/model-rankings-chart' \
  | python3 -c "
import json, sys
data = json.load(sys.stdin)
weeks = data['data']['data']
totals = {}
for w in weeks:
    for k, v in w['ys'].items():
        if k == 'Others':
            continue
        totals[k] = totals.get(k, 0) + v
ranked = sorted(totals.items(), key=lambda x: -x[1])[:20]
for i, (m, v) in enumerate(ranked):
    print(f'{i+1}. {m}')
"
```

Aggregates token volume across all weeks in the chart and picks the top 20.
Note: the rankings API returns **permaslugs** (e.g. `anthropic/claude-4.6-sonnet-20260217`).
The `openrouter_model` column needs the canonical **slug** (e.g. `anthropic/claude-sonnet-4.6`).
Resolve permaslugs via `https://openrouter.ai/api/v1/models` — each model's `id` is the slug
and `canonical_slug` is the permaslug.

## Step 2 — Fetch the Vercel AI Gateway model catalog

```bash
curl -s 'https://ai-gateway.vercel.sh/v1/models' \
  | python3 -c "
import json, sys
for m in json.load(sys.stdin)['data']:
    print(m['id'])
" > /tmp/vercel_models.txt
```

Vercel slugs use `provider/model-name` (no date suffixes). Provider name
differences from OpenRouter:

| OpenRouter provider | Vercel / CF provider |
|---------------------|----------------------|
| `x-ai`             | `xai`                |
| `qwen`             | `alibaba`            |
| `meta-llama`        | `meta`               |

All other major providers (anthropic, google, deepseek, openai, mistral,
minimax, xiaomi, stepfun) keep the same prefix.

Gateway model names may reorder tokens, drop suffixes, or abbreviate.
Do **not** rely on hardcoded transformation rules — use fuzzy matching
(see Step 4). Strip `:free` suffixes and date patterns before matching.

## Step 3 — Fetch the Cloudflare AI Gateway model catalog

Cloudflare exposes two kinds of models:

1. **Self-hosted** (`@cf/provider/model`) — on CF's own GPUs.
2. **Third-party** (`provider/model`) — proxied via CF AI Gateway.

The benchmark runner uses the CF REST API at
`/accounts/{id}/ai/v1/chat/completions` which accepts both formats.

Scrape the catalog:

```bash
curl -sL 'https://developers.cloudflare.com/ai/models/index.md' \
  | grep -oP '(?:/ai/models/|@cf/)[a-zA-Z0-9/_.-]+' \
  | sed 's|/ai/models/||; s|/$||' \
  | sort -u > /tmp/cf_models.txt
```

CF uses `xai/` (not `x-ai/`), has fewer models (~180 vs ~280 on Vercel),
and may have different suffixes for some models.

## Step 4 — Build the mapping and generate SQL

For each OpenRouter slug:

1. Strip `:free` suffix and date patterns (`-YYYYMMDD`, `-MM-DD`).
2. Translate provider name (`x-ai` → `xai`, `qwen` → `alibaba`).
3. Filter each gateway catalog to models from the same provider.
4. Look at the candidates and pick the one that refers to the same
   underlying model. Use your judgment — naming conventions differ
   across gateways (reordered tokens, dropped suffixes, abbreviations).
   Set `NULL` when no candidate is clearly the same model.
5. Skip models with no match on *any* gateway.

SQL format — single multi-row INSERT:

```sql
INSERT INTO gateway_benchmark_models (openrouter_model, vercel_model, cloudflare_model, enabled, created_by)
VALUES
  ('<or_slug>', '<vercel_or_NULL>', '<cf_or_NULL>', true, '<CLERK_USER_ID>'),
  ...
ON CONFLICT (openrouter_model) DO NOTHING;
```

`<or_slug>` must be the canonical slug (e.g. `anthropic/claude-sonnet-4.6`),
not the permaslug.

## Step 5 — Return the SQL

Print the generated SQL statements to the user. Do **not** execute them —
the user will review and apply the SQL themselves.

## All-in-one script

`scripts/generate_model_mappings.py` combines steps 1–4 into a single
executable. It fetches all three catalogs, performs matching, and prints
ready-to-execute SQL to stdout (progress to stderr).

```bash
CLERK_USER_ID="$CLERK_CREDENTIALS_clerk_user_id" \
  python3 services/gcp-gateway-bench-coord/scripts/generate_model_mappings.py \
  > /tmp/mappings.sql
```

Review the SQL on stdout, then return it to the user for execution.

The script handles:
- Stripping `:free` suffixes and date patterns (`-YYYYMMDD`, `-MM-DD`)
- Provider name translation (`x-ai` → `xai`, `qwen` → `alibaba`)
- Fuzzy token matching (Jaccard ≥ 0.6) — no hardcoded model name transforms
- Skipping models with no gateway equivalent

## Table schema reference

```sql
CREATE TABLE gateway_benchmark_models (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  openrouter_model  TEXT NOT NULL UNIQUE,
  vercel_model      TEXT,
  cloudflare_model  TEXT,
  enabled           BOOLEAN NOT NULL DEFAULT true,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by        TEXT NOT NULL,
  updated_by        TEXT
);
```

## Filtering

The script skips models that have no equivalent on *any* gateway — there's
no point benchmarking a model we can only test on OpenRouter. Models with a
match on at least one gateway are emitted (the missing gateway column is `NULL`).

Typical skips: `openrouter/owl-alpha` (OR-only), `tencent/hy3-preview`
(no Tencent on Vercel or CF), `x-ai/grok-code-fast-1` (not yet on other gateways).
