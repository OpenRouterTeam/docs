# Data Policies — Resolving a `data_policies` UUID

An endpoint's `override_datapolicy_id` is a UUID foreign key into the `data_policies` table. The table row looks like:

```
data_policies: {
  id, name, training, training_openrouter,
  retains_prompts, can_publish, prompt_retention_days
}
```

**ZDR (Zero Data Retention) ⟺ `retains_prompts: false`.** The public ZDR endpoint list filters endpoints on `!data_policy.retainsPrompts`, so a policy with `retains_prompts: false` is what makes an endpoint ZDR-eligible.

Turn a bare UUID like `4ed640a7-6e81-40ab-8e70-37ddb8958bf7` into the actual policy before you set an override or reason about one.

## Source of truth — read it live

Never keep a baked-in policy map. `GET /api/v1/internal/buddy/data-policies` returns every non-deleted row of the `data_policies` table — the canonical source — including policies no endpoint currently references.

```bash
curl -s -H "Authorization: Bearer $BUDDY_API_KEY" \
  https://openrouter.ai/api/v1/internal/buddy/data-policies \
  | jq '.data[] | {id, name, retains_prompts, prompt_retention_days}'
```

Resolve one UUID:

```bash
curl -s -H "Authorization: Bearer $BUDDY_API_KEY" \
  https://openrouter.ai/api/v1/internal/buddy/data-policies \
  | jq --arg id "4ed640a7-6e81-40ab-8e70-37ddb8958bf7" '
      .data[] | select(.id == $id) | . + { zdr: (.retains_prompts == false) }'
```

If the route is unavailable, the lossy fallback is to scavenge hydrated `data_policies` objects off the `/endpoints` response — it only sees policies at least one endpoint already references, so a miss there means "not in use", not "does not exist".

To pick an override target, list every policy with how many endpoints reference it (as an override or as a provider default) by joining the two responses.

## Per-endpoint questions

For "what's the data policy of *this* endpoint?", resolve the endpoint ([`find-endpoint.md`](find-endpoint.md)) and overlay the provider default with the endpoint's `override_datapolicy_id`. Come here when you hold a bare UUID, or when enumerating policies to choose an override target.

## ⚠️ Writes are gated

Setting an endpoint's `override_datapolicy_id` is an endpoint **mutation**. Per [`guardrails.md`](guardrails.md) → Preview gate, always preview the exact change (`override_datapolicy_id: old → new`, plus the resolved effective `retains_prompts` / ZDR state), get explicit human approval, and surface the Mission Control link before applying. Everything above is read-only; the PATCH itself goes through [`staging-workflows.md`](staging-workflows.md).
