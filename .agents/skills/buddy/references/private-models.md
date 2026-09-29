# Staging Private Models

A *private model* is a model with `is_private: true` and one or more `private_access_grants`. It is invisible to anyone who isn't in the grant list; the slug returns 404 in the public model directory and the model can't be routed to.

This is a heavier version of a private endpoint. The endpoint flag locks down a single deployment of a model; the *model* flag locks down the slug itself. Use a private model when:

- You want a slug that doesn't exist for the rest of the world (e.g. an internal-only experimental model — "openrouter/fusion").
- You want the freedom to attach multiple private endpoints under one identity, all gated by the same access list.
- You want pricing, capability flags, and provider routing to be controlled centrally on the model rather than per-endpoint.

The mechanics are otherwise identical to a public model. **Read [`staging-workflows.md`](staging-workflows.md) first** for the canonical Buddy API reference, model field checklist, and Mission Control links — everything there still applies. This document only covers what's *different* about private models.

If you also need to attach a private endpoint to the new model (the common case), see `references/private-endpoints.md` for the endpoint side of the flow.

---

## The Request Shape

Private models are created via the same `POST /api/v1/internal/buddy/models` route as public ones. The two extra fields are:

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `is_private` | `boolean` | Yes — must be `true` | Marks the model private. Without this, `private_access_grants` are ignored. |
| `private_access_grants` | `Array<{ entity_id: string }>` | Yes | One entry per Clerk org or user that should have access. `entity_id` is the Clerk ID — `org_...` for orgs, `user_...` for individuals. |

A minimal private model payload looks like:

```json
{
  "slug": "openrouter/fusion",
  "permaslug": "openrouter/fusion",
  "name": "OpenRouter: Fusion",
  "group": "Other",
  "context_length": 128000,
  "input_modalities": ["text"],
  "output_modalities": ["text"],
  "is_private": true,
  "private_access_grants": [
    { "entity_id": "org_2uMVNwONqhSdZXQy1QtyWuCjTxZ" }
  ]
}
```

Multiple grants are permitted:

```json
"private_access_grants": [
  { "entity_id": "org_2uMVNwONqhSdZXQy1QtyWuCjTxZ" },
  { "entity_id": "org_3aB9CdEfGhIjKlMnOpQrStUvWxYz" },
  { "entity_id": "user_2sBcDeFgHiJkLmNoPqRsTuVwXyZ" }
]
```

> **Note**: the `POST /models` apply response does not echo back
> `private_access_grants`. Only `is_private: true` and `owner_clerk_user_id`
> are returned. The grants are written to a join table server-side. Verify
> them through `GET /api/v1/internal/buddy/models`, which projects
> `private_access_grants` onto every row (filter on `permaslug` client-side).

---

## End-to-End Workflow

### Step 1: Decide the model fields

The same field checklist applies — `slug`, `permaslug`, `name`, `group`, `context_length`, `input_modalities`, `output_modalities`, plus reasoning + parameter count where relevant. See "Model fields checklist" in [`staging-workflows.md`](staging-workflows.md) for the full table.

A few extra notes for private models:

- **The slug doesn't have to be a real upstream identity.** It can be a pure-internal name like `openrouter/fusion` or `org-name/internal-v1`. The model is a façade; the upstream is determined by whatever endpoint(s) you attach.
- **Author auto-creation still happens.** A new author slug is created from the permaslug prefix (e.g. `openrouter/fusion` creates the `openrouter` author if it doesn't already exist). This author is shared with all other models under that prefix — pick carefully or re-use an existing author.
- **`group` is required.** For a fully-internal model with no real lineage, `Other` is the safest pick. For a private fork of an existing family, match the parent's group.
- **`description` is optional but recommended.** Even for internal models, someone is going to look at it in Mission Control. A one-line hint about what it routes to and why it's private saves time.
- **Exclude `model_version_group_id` by default.** When you build the private model by cloning a public model's record, drop this field — do not copy it across. See [`guardrails.md`](guardrails.md) → Private / BYOK staging invariants Rule 1. Only include it when the requester explicitly asks to group the private model with specific other records and names the group.

### Step 2: Verify access entities

For OpenRouter's own internal testing, default the ACL to the OpenRouter Clerk organization unless the requester specifies a different scope:

```json
[{ "entity_id": "org_2uMVNwONqhSdZXQy1QtyWuCjTxZ" }]
```

This lets anyone operating in the OpenRouter organization context access the private model. Still show this exact grant in the required preview and get approval before writing. Do not silently add a personal user grant, and do not use this default for customer, partner, sponsored, or otherwise externally scoped private resources. For those cases, get the exact Clerk org/user IDs from the requester.

Clerk IDs look like `org_...` or `user_...`. Without at least one grant, `is_private: true` locks everyone out — including the bot account that created the model. If the intended scope is ambiguous and the request is not clearly for OpenRouter internal testing, ask explicitly before staging.

### Step 3: Build the preview & confirm (REQUIRED)

Same hard stop as any other staging flow: **never apply `POST /models` without explicit human approval**. Run the call without `apply` first, post the payload and the preview response, then ask for confirmation in a separate message.

Things to call out in the preview:

- The proposed `slug` and `permaslug` — make sure they don't collide with an existing public slug (run a `GET /buddy/models` lookup before previewing).
- Every entity_id in `private_access_grants`.
- Default field values you picked (group, context_length, modalities) so the user can correct them before you stage.
- The fact that the model will be `hidden: true` and `is_private: true` until manually unhidden in Mission Control.

### Step 4: Create the model

Only after explicit approval:

```bash
curl -X POST https://openrouter.ai/api/v1/internal/buddy/models \
  -H "Authorization: Bearer $BUDDY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "apply": true,
    "slug": "openrouter/fusion",
    "permaslug": "openrouter/fusion",
    "name": "OpenRouter: Fusion",
    "group": "Other",
    "context_length": 128000,
    "input_modalities": ["text"],
    "output_modalities": ["text"],
    "is_private": true,
    "private_access_grants": [
      { "entity_id": "org_..." }
    ]
  }'
```

Buddy API mutation routes are preview-by-default: omitting `apply` returns a preview (`{ "applied": false, "preview": { ... } }`) without writing. Since Step 3 already gathered explicit approval, send `apply: true` here.

### Step 5: Attach endpoint(s) — usually private too

A private model with no endpoints is unroutable. Almost every private model needs at least one endpoint. The endpoint can be public *or* private, but since the model itself is private, in practice you almost always want the endpoint to also be private (with the same grant list) so the access scope is consistent.

For each endpoint you want to attach, follow [`private-endpoints.md`](private-endpoints.md) — including its own preview-and-confirm step. The model permaslug goes into `model_permaslug` on the endpoint payload.

Common patterns:

- **Single private endpoint cloning a real provider's config** — e.g. a private "Fusion" model whose only endpoint points at first-party Anthropic Opus 4.7 with Anthropic SKU pricing. The org sees the private model slug; bytes flow through the cloned upstream.
- **Multiple private endpoints, different upstreams** — e.g. a "Fusion" model with one endpoint on FakeProvider (for testing) and another on real Anthropic. The router picks based on its own logic; both are gated to the same orgs.
- **Stub model + FakeProvider endpoint** — the simplest pattern, useful for reserving a slug or running fake-traffic tests. Pricing on the FakeProvider endpoint is technically optional but staging it anyway makes Mission Control look correct.

### Step 6: Post Mission Control link & next steps

Always post the link after a successful create:

```
https://internal.openrouter.ai/model/edit/{model-permaslug}
```

Use the complete permaslug exactly as returned, including its author prefix and any date suffix. For example, `openrouter/fusion` → `/model/edit/openrouter/fusion`.

Remind the user that:

- The model is **`hidden: true`** after creation. It can be unhidden in Mission Control or through `PATCH /api/v1/internal/buddy/model/{author}/{slug}` while it remains private and has at least one effective grant.
- The model is **`is_private: true`** — it will not appear in any public listing and is invisible to non-granted entities.
- Existing-model PATCH supports `is_private`, `hidden`, and `private_access_grants` under the private-resource guardrails in [`guardrails.md`](guardrails.md). Grant updates have **replacement semantics**: always send the complete desired ACL, because any omitted entity loses access. A private, visible model must retain at least one grant.
- When privatizing, granting, and unhiding a hidden model, prefer one previewed request so the resolved state is reviewed together.
- If endpoints haven't been attached yet, either walk through [`private-endpoints.md`](private-endpoints.md) next, or chain the endpoint preview right after the model summary.

---

## Unhiding an Existing Private Model

A model that is already `is_private: true` and has at least one effective access grant can be unhidden directly through the ordinary model PATCH. Models do not use endpoint baseline tests.

1. Read the model through `GET /api/v1/internal/buddy/models`, filtering by its exact permaslug.
2. If `hidden: false`, report that it is already unhidden and do not write.
3. If `hidden: true`, confirm `is_private: true` and that `private_access_grants` in the models-list response is non-empty. Preserve the ACL by omitting that field from the PATCH.
4. Preview `PATCH /api/v1/internal/buddy/model/{author}/{permaslug-suffix}` with only `{"hidden": false}` and no `apply`.
5. Post `hidden: true → false`, `is_private: true (unchanged)`, the exact permaslug, and the model Mission Control link. Confirm `stripped_fields` is empty, then ask the human for explicit approval in a separate message.
6. Repeat with `{"apply": true, "hidden": false}` plus `X-Buddy-Actor-Email` set to the approver, and re-read the model to verify it remains private and is now visible to granted entities. Without the header the apply is refused with `403` and nothing is written.

```bash
# Preview — no write
curl -X PATCH \
  "https://openrouter.ai/api/v1/internal/buddy/model/openrouter/fusion" \
  -H "Authorization: Bearer $BUDDY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"hidden": false}'

# Apply only after the preview is approved
curl -X PATCH \
  "https://openrouter.ai/api/v1/internal/buddy/model/openrouter/fusion" \
  -H "Authorization: Bearer $BUDDY_API_KEY" \
  -H "X-Buddy-Actor-Email: approver@openrouter.ai" \
  -H "Content-Type: application/json" \
  -d '{"apply": true, "hidden": false}'
```

Direct unhide does not make the model public. The API permits the visibility change only when the resulting model remains private, and a visible private model must retain an effective grant. If the preview strips `hidden` or the model has no effective grants, stop and repair the privacy configuration first.

---

## Common Patterns

### "Create a private model called X scoped to org Y"

The bare-bones case. Pick reasonable defaults for all the model fields, preview them, and confirm with the user. After model creation, ask whether any endpoints should be staged immediately — usually yes.

### "Create a private model that routes to upstream Z's pricing"

Two-step: create the private model with whatever façade slug the user wants, then create a private endpoint that points `provider_model_id` at upstream Z, with pricing cloned from Z's first-party endpoint. The model carries the identity; the endpoint carries the routing + price.

### "Same private model, different endpoints over time"

Private models can have endpoints added or removed without re-staging the model itself. Each endpoint is independent. To swap one out, hide the old endpoint via Mission Control and stage a new one.

### "Clone public model X into a private BYOK model for customer Y"

The customer-onboarding shape: a private slug per customer deployment, each with one BYOK endpoint, all cloned from an existing public model. Copy the public model's capability fields verbatim — `context_length`, `input_modalities`, `output_modalities`, `supports_reasoning`, `total_parameters`, `group`, `license` — so the private slug behaves identically. Then change exactly three things and drop one:

| Field | Action |
|---|---|
| `slug` / `permaslug` | New private identity (e.g. `private/<model>-<customer>`), clean slug + `-YYYYMMDD` on the permaslug |
| `name` | Prefix with the customer (e.g. `Cline: Kimi K3`) so Mission Control is readable |
| `is_private` + `private_access_grants` | `true`, granting the customer's Clerk org |
| `model_version_group_id` | **Drop it.** Never carry the public model's group across. |

Do the same on each endpoint: clone the public sibling's `features`, `provider_overrides`, `additional_parameters`, `excluded_parameters`, quantization and context, and set `is_private` + `is_byok_only` + the grant. Pick the sibling carefully — a provider often has several endpoints on one model (e.g. a standard Fireworks endpoint *and* a `fireworks/fast` sub-provider endpoint). Confirm which one you are mirroring rather than taking the first match.

Batch each model with its endpoint **and its pricing version** in one apply, per [`guardrails.md`](guardrails.md) → Private / BYOK staging invariants Rule 2 — pricing is not retroactive, so an unpriced window is unrecoverable revenue.

### "Add a new entity to an existing private model"

Don't re-create the model. Read its current grants, then PATCH `private_access_grants` with the **complete desired ACL**: every existing entity that should keep access plus the new entity. PATCH uses replacement semantics, so sending only the new entity removes all omitted grants. Preview the resulting ACL and get approval before applying.

---

## Gotchas

- **`is_private: true` without any grants** locks the model out of every account, including the bot's. Always include at least one grant before setting `is_private: true`.
- **Slug collisions with public models** are silent — `POST /models` will fail with a permaslug constraint error. Always run a lookup first:
  ```bash
  curl -s -H "Authorization: Bearer $BUDDY_API_KEY" \
    https://openrouter.ai/api/v1/internal/buddy/models \
    | jq '.data[] | select(.permaslug == "<proposed-permaslug>")'
  ```
- **Filter the models list client-side — the server ignores `?permaslug=`.** `GET /buddy/models?permaslug=…` returns **200 with the entire catalog**, newest-first, silently discarding the filter. Code that reads `.data[0]` from such a response gets the most recently created model in the catalog, not the one it asked for. Always fetch the full list and match on exact `permaslug` yourself (as the snippet above does). Related quirks on the same route: `?limit=N` is rejected outright with a Zod validation error, and `GET /buddy/model/{permaslug}` does not exist (`404`) — the list route is the only read path.
- **Never copy `model_version_group_id` onto a private clone.** It drops the private slug into the public model's version group and makes it a candidate in that group's `~latest` resolution. Exclude by default — see [`guardrails.md`](guardrails.md) → Private / BYOK staging invariants Rule 1.
- **`POST /models` with `apply: true` returns no `id`.** Reading `data.id` gives `undefined`. This is cosmetic, not a failure — use `permaslug` as the model's identifier for every downstream call (it is what `model_permaslug` on the endpoint payload wants anyway). Endpoint creates *do* return `data.id`.
- **Author auto-creation is permanent.** Picking a new author prefix creates a new `model_authors` row that won't be cleaned up if the model is later deleted. Re-use an existing author when possible.
- **Hidden flag is automatic.** All models created via the Buddy API are `hidden: true`. Tell the user explicitly — they need to unhide in Mission Control before routing works.
- **`POST /models` doesn't echo `private_access_grants`.** The apply response shows `is_private: true` and `owner_clerk_user_id` but not the grant list. Don't treat this as a failure — the grants are written to a join table. Verify through `GET /api/v1/internal/buddy/models`, which returns the projected ACL per row.
- **Pricing lives on the endpoint, not the model.** Even though the model is private, pricing versions attach to endpoints. There's no model-level pricing API.

---

## Reference

- [`staging-workflows.md`](staging-workflows.md) — canonical model + endpoint API reference, field checklists, Mission Control URLs, error codes.
- [`private-endpoints.md`](private-endpoints.md) — private endpoint flow; almost always run after this one to attach endpoints to the new private model.
- [`guardrails.md`](guardrails.md) — the three silent-damage private/BYOK rules: exclude `model_version_group_id`, non-zero BYOK reference pricing, and omit `private_access_grants` on every non-ACL PATCH.
