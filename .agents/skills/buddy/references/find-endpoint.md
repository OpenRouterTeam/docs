# Resolving a Natural-Language Endpoint Reference

`GET /api/v1/internal/buddy/endpoints` has no server-side filtering: resolving "the SambaNova DeepSeek-V3.2 endpoint" means pulling the full list and filtering locally. The conventions that make that filter correct:

- **Provider names are case-sensitive in the DB** — `"SambaNova"`, not `"sambanova"`.
- **Multi-account providers keep the base `provider_name`.** `"Anthropic 2"` has `provider_name == "Anthropic"`; the differentiator lives in `provider_overrides.displayName` and `provider_overrides.slug` (`"anthropic/2"`). Match all three fields.
- **Permaslugs often carry a date suffix** the requester won't include: `deepseek/deepseek-v3.2-20251201` for "deepseek v3.2". Match on a normalized substring, not equality.
- **Tombstones and deprecations clutter results.** Exclude `deleted: true` and non-null `deprecation_date` unless you specifically want them.
- **`provider_model_id` is worth matching too** — the requester may quote the upstream model ID (`DeepSeek-V3.2`) rather than the permaslug.

## Recipe

Normalize both sides by lowercasing and stripping non-alphanumerics, so `"deep-infra"`, `"DeepInfra"`, `"anthropic 2"`, and `"anthropic/2"` all behave:

```bash
PROVIDER="sambanova"
MODEL="deepseek v3.2"

curl -s -H "Authorization: Bearer $BUDDY_API_KEY" \
  https://openrouter.ai/api/v1/internal/buddy/endpoints \
  | jq --arg p "$PROVIDER" --arg m "$MODEL" '
      def norm: ascii_downcase | gsub("[^a-z0-9]"; "");
      [ .data[]
        | select(.deleted == false and .deprecation_date == null)
        | select(
            ($p | norm) as $pn
            | ((.provider_name // "") | norm | contains($pn))
              or ((.provider_overrides.displayName // "") | norm | contains($pn))
              or ((.provider_overrides.slug // "") | norm | contains($pn))
          )
        | select(
            ($m | norm) as $mn
            | ((.model_permaslug // "") | norm | contains($mn))
              or ((.provider_model_id // "") | norm | contains($mn))
          )
        | {
            id, model_permaslug, provider_name, provider_model_id, variant,
            hidden, deleted, deprecation_date,
            display_name: .provider_overrides.displayName,
            provider_slug_override: .provider_overrides.slug,
            mission_control_url: ("https://internal.openrouter.ai/endpoint/edit/" + .id)
          }
      ]'
```

Then:

- **One match** — proceed with `.id`.
- **Several matches** — do not guess. Show the candidates with their `variant`, `display_name`, `provider_slug_override`, and Mission Control links, and ask which one. Extra context often disambiguates (they said "free" → filter `variant == "free"`).
- **No match** — retry with a shorter model fragment, then with `deleted`/`deprecation_date` included, before concluding it doesn't exist.

Add `variant` to the filter (`select(.variant == "standard")`) when the request names one: `standard`, `free`, `extended`, `thinking`, …

## Data policy at a glance

An endpoint's retention state is the provider default overlaid by the endpoint's override. Fetch both and compute it — `override_datapolicy_id` is the FK into `data_policies`, null when there is no override, and ZDR means effective `retains_prompts === false`. See [`data-policies.md`](data-policies.md) for resolving a policy UUID and the field-by-field overlay rules.

## "Link me to <endpoint>" means the Mission Control URL

When someone asks to be *linked to* an endpoint ("link me to siliconflow's GLM-5.1", "send me the endpoint for X"), they want the admin page:

```text
https://internal.openrouter.ai/endpoint/edit/<endpoint-id>
```

Not the public marketplace page (`https://openrouter.ai/<slug>`) — the team manages endpoints from Mission Control. Use the public URL only when they ask for it explicitly, or when sharing with someone outside the team.

> ⚠️ Surface the Mission Control link on every model/endpoint operation, read or
> write, and preview + get approval before any mutation on an endpoint you
> resolved here. See [`guardrails.md`](guardrails.md) → Preview gate.

## When to skip this

- You already have the UUID.
- You want the *full* endpoint list for a survey-style query — filter it yourself for the survey, don't narrow to one row.
- You're looking for a model rather than an endpoint — use `GET /buddy/models`.
