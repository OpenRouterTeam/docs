---
name: azure-model-launch
description: Launch or clone a model on an Azure or Azure AI Foundry endpoint. Tracks Azure identity, permaslug-based key routing, resource setup, Buddy staging, deployment gates, and image/TTS validation.
user-invocable: true
---

# Azure Model Launch

Use this skill when a model will route through Azure or Azure AI Foundry,
including a clone of an existing Azure model or a new image/TTS sibling.

## Record the Azure identity

Keep these values as separate fields in the staging plan:

| Field               | Meaning                                         |
| ------------------- | ----------------------------------------------- |
| `permaslug`         | Immutable dated OpenRouter model identifier     |
| public `slug`       | Marketplace/API model slug                      |
| `provider_model_id` | Azure deployment or upstream model ID           |
| resource            | Azure/Foundry resource serving the model        |
| region              | Resource and model availability region          |
| base URL            | Endpoint host in `provider_overrides.baseUrl`   |
| env key             | OpenRouter secret used for Azure authentication |

Choose the public slug with the provider-mirrored numbering rule in
`stage-endpoint`, checking the exact `provider_model_id`, announcement, and
same-family siblings before staging.

Azure resources are region-scoped. Check the model's available regions before
choosing a resource. Confirm that the resource, region, base URL, deployment
ID, and env key describe the same serving path. A voice sibling may reuse an
East US 2 resource while an image model requires a West Central US resource.

For regional endpoints, inspect the regional routing branch first:
`getAzureAPIKey` returns the Sweden Central key for Europe-region endpoints
before it evaluates model-specific cases.

## Gate the Azure control plane

Treat these as independent gates, in order:

1. Subscription allowlist
2. Catalog visibility
3. Model/version/SKU/region capacity
4. Deployment policy validation
5. Deployment `Succeeded` and `Running`
6. Resource-key authentication
7. Runtime request and artifact validation

A passing gate doesn't establish the next one. A healthy existing deployment
doesn't prove that the account can accept a new preview deployment.

Record the release status before provisioning: GA, public preview, or private
preview. A private-preview model stays hidden and unroutable to external
traffic until the vendor authorizes production use.

`hidden=true` rows are excluded from the public KV catalog and from the
request-time private catalog (`packages/routing/endpoints/cache.ts`,
`createPrivateEndpointsCache` fetches with `showHidden: false`). A row that is
both hidden and private is unroutable except through the internal
`X-OR-Endpoint-Id` pin. Plan the staff smoke test as `hidden=false,
is_private=true` with the internal org grant, then un-private for public
launch, and state that sequence in the staging plan.

## Identify the Foundry resource correctly

A Microsoft Foundry resource is an Azure
`Microsoft.CognitiveServices/accounts` resource with `kind: AIServices`.
Azure OpenAI uses the same provider namespace with `kind: OpenAI`. Projects
and workspaces are optional child resources under
`Microsoft.CognitiveServices/accounts/projects`.

Inspect the account's `kind`, region, provisioning state,
`allowProjectManagement`, custom subdomain, child projects, and existing
deployments. An account whose project or workspace was deleted can pass
read-only health checks and show the model in its catalog while deployment
policy validation fails with `InvalidResourceProperties`.

For a contaminated account, use a clean resource created with
`--allow-project-management false` and `--custom-domain <resource>`. The
resource-specific inference host is
`https://<resource>.cognitiveservices.azure.com`; the endpoint form and custom
subdomain must agree.

Use the resource naming pattern `foundry-<exact-azure-region>-<ordinal>`.
Keep model identity in the deployment name, such as `maiimage25pro`, rather
than in the resource name. Leave a working predecessor resource untouched
during a preview launch.

## Discover the catalog schema before filtering

Inspect raw Azure CLI output before writing `--query` filters. Vendor guides
may use stale nested paths such as `.model.name` when the response exposes
top-level `.name`, `.version`, and `.format`.

Start with the first record's keys:

```bash
az cognitiveservices account list-models \
  --name "$RESOURCE" \
  --resource-group "$RESOURCE_GROUP" \
  --output json \
  | jq '.[0] | keys'
```

Then search broadly without assuming field paths:

```bash
az cognitiveservices account list-models \
  --name "$RESOURCE" \
  --resource-group "$RESOURCE_GROUP" \
  --output json \
  | jq --arg needle "$MODEL_NAME" \
      '.[] | select(tostring | test($needle; "i"))'
```

Use a narrow `--query` only after confirming the raw schema. A malformed
filter can produce a false “not allowlisted” result.

## Check model-specific capacity

Capacity belongs to the exact model, version, SKU, and region. It doesn't
transfer from a sibling deployment. Query the `modelCapacities` REST API and
the Foundry quota UI for the launch tuple, record the available amount and
scope, and start at the vendor-recommended minimum.

Capacity availability and quota approval are related checks with separate
owners. Record both before deployment; classify a later `429` as capacity
pressure rather than an auth or adapter failure.

## Choose the endpoint form and account key

Azure may expose either a regional host such as
`https://<region>.api.cognitive.microsoft.com` or a resource-specific host
such as `https://<resource>.cognitiveservices.azure.com`. Record which form
the endpoint row and adapter use. The key must belong to the account behind
that chosen endpoint.

Keys are account-scoped. Deployments in one account can share its key; a new
account receives new keys even when it reuses an old account name. Account
names, deployment names, permaslugs, environment variables, and endpoint
hosts are separate namespaces.

## Capture control-plane failure evidence

For every Azure deployment or policy failure, save a redacted record with:

- UTC timestamp
- Correlation ID
- Operation name
- Resource ID and deployment name
- HTTP/result code
- Exact error code and message
- Whether a failed child resource persisted

Keep confirmed facts, working hypotheses, and vendor-confirmed root cause in
separate fields. `InvalidResourceProperties` identifies the policy-validation
stage; it doesn't identify the underlying account condition by itself.

## Protect secrets and scope repository work

Never print or paste Azure keys in chat, commands, tickets, or PRs. Load them
through command substitution into a resource-scoped environment variable,
store them in Infisical before merging code that requires them, and clear
temporary variables afterward. Treat keys found in shell history as exposed
and coordinate safe rotation without disrupting the predecessor.

Before planning repository changes, search open, draft, merged, and closed PRs
for the model name, permaslug, deployment ID, provider model ID, and env key.
Confirm whether the remaining work belongs in provider code, seeds, the Buddy
API, or Mission Control. An existing mapping PR can reduce the work to a narrow
credential-routing follow-up.

## Save a deployment receipt

Every launch should leave a sanitized Markdown receipt containing:

- Resource, region, kind, SKU, project-management setting, custom subdomain,
  and provisioning state
- Model, version, format, deployment name, deployment SKU, capacity, RAI
  policy, and `Succeeded`/`Running` state
- Exact commands with secrets removed
- Endpoint form and base URL
- Secret name and every manifest path
- Repository PRs and Mission Control changes
- Redacted test result and generated-artifact check
- Preview restrictions and rollback plan

## Inspect the key resolver before staging

Read `packages/providers/configs/azure.ts` and its focused tests before writing
the staging plan. `getAzureAPIKey` dispatches on `model.permaslug`, including the
exact dated suffix. It does not dispatch on the public slug or
`provider_model_id`.

Add the exact new permaslug to the established hard-coded switch case. An
unmatched model falls through to `AZURE_EAST_US_2_API_KEY`. Authentication with
that default key can succeed while the intended resource-specific wiring is
missing, so accidental default-key success does not close the check.

The deployment ID and permaslug have separate jobs:

- `provider_model_id` feeds the Azure deployment/request URL.
- `permaslug` selects the credential case.

Test both mappings. Keep the predecessor's mapping unchanged.

## Lock the permaslug before merging code

Use this order:

1. Preview the hidden model through the `buddy` skill with the intended
   public slug and dated permaslug.
2. Apply the hidden model only after the human approves its preview.
3. Re-read the persisted model and copy the exact permaslug, character for
   character.
4. Match the resolver PR's hard-coded string to that persisted value.
5. If the launch date slips and the model apply assigns a different
   `YYYYMMDD` suffix, update the PR and its focused test.
6. Stage the endpoint against the persisted permaslug, then stage pricing
   after the endpoint UUID exists.

Create the model first when the code mapping depends on its dated permaslug.
A clean public slug does not lock the value used by `getAzureAPIKey`. A
predecessor with an undated permaslug (`microsoft/mai-transcribe-1.5`) does
not exempt the successor: the Buddy API's staging invariant still assigns
`<slug>-YYYYMMDD` to every new model, so never copy the sibling's shape.

## Choose same-resource or dedicated-resource handling

### Same Azure resource

Use the existing env key only after confirming the new model uses the same
resource, region, and base URL as its sibling. Add the new exact permaslug to
that key's case and add a focused test for the new model plus the predecessor.
No new secret or manifest entry is needed.

### Dedicated Azure/Foundry resource

Keep the original model's deployment and key untouched. Add the dedicated key
to all of these code/config surfaces:

- `packages/providers/env.ts`
- `packages/providers/mock-env.ts`
- `env.manifest.json` under each relevant `links` path:
  `/projects/mission-control`, `/services/cfw-api`, and
  `/services/cfw-image-api`
- `packages/providers/configs/azure.ts`
- focused resolver tests, including the predecessor mapping and regional
  fallback behavior

Populate the new Infisical secret for every manifest path before deploying the
resolver. A key present in one service does not configure the other workers.
Preserve the existing resource, key, base URL, deployment ID, and mapping for
the original model.

Verify these paths in the repository before writing the staging plan. The current
manifest stores them under `env.manifest.json.links`; the image API path is
present at `/services/cfw-image-api`.

## Stage records separately from runtime deployment

The Buddy API's model, endpoint, and pricing writes update database records.
The resolver PR updates runtime credential selection. They can proceed in this
order:

1. Preview and apply the hidden model.
2. Re-read its persisted fields and permaslug.
3. Preview and apply the hidden endpoint.
4. Obtain the endpoint UUID, then preview and apply pricing using the exact
   billing unit and current provider rate card.
5. Merge and deploy the resolver/configuration PR.
6. Run live endpoint validation.
7. Unhide only after the human approves the launch state.

Each mutation has its own preview and human approval. Re-read the persisted
record after every apply and compare it with the approved preview. Check that
`stripped_fields` is empty or understood.

Hold pricing when the provider's rate card is unsettled. Pricing versions take
effect immediately and have no Buddy API delete route. Convert the provider's
unit exactly: image rates may be per token, while TTS rates may be per
character.

The Buddy API cannot persist an endpoint `internal_note`. Set it by hand in
Mission Control after the apply if the launch needs one.

After the applies, have the human run the `Refresh Models and Endpoints`
workflow (`.github/workflows/refresh-models-endpoints.yaml`). It exports the
hidden rows from prod into the seed CSVs through a generated PR on
`automated/refresh-models-endpoints`. The seeds land when that PR merges. Never
hand-edit the seed CSVs.

To exercise the hidden rows through the local STT worker before unhide, merge
the generated seed branch into a throwaway local branch, run
`bun run x scripts/seed/seed-models-endpoints.ts`, then flip `hidden` to
`false` on the local Postgres rows only and rewarm KV
(`curl 'http://localhost:8794/__scheduled?cron=*/5+*+*+*+*'`, then
`tilt trigger stt-api`). The seeded `sk-or-v1-unlimitedkey` user is not an
internal entity, so the `X-OR-Endpoint-Id` pin path does not resolve hidden
models locally. Confirm `provider_model_id` and `endpoint_id` in
`services/dev-fs-logs/.logs/default/stt/transaction-attempt.log`.

For image endpoints the same flow runs through `cfw-image-api` (`tilt trigger
image-api`, port 8797). The worker caches the `modality_image` KV blob per
isolate for five minutes, so a rewarmed catalog that still lists only the old
models is a cache miss, not a warmer failure. Confirm the dated permaslug,
`provider_model_id`, adapter, upstream URL, and SKU items in the generation's
`image-generation/endpoint-resolved.log`, `upstream-request.log`, and
`billing-result.log`. Delete the local rows afterwards.

A green DB baseline or pricing check does not exercise the production
`getAzureAPIKey` path. Do not run inference, baseline-unhide, or public unhide
until the resolver mapping is deployed. Track deployment state, rather than
merge state alone.

## Validate the provider behavior

For image endpoints, require a real generated image. For TTS endpoints, require
a real audio artifact and verify the requested voice. Check the concrete
deployment/model ID, adapter, base URL, billing SKU, and charged amount.
HTTP 200 from a control-plane or baseline request is insufficient.

For Speech enhanced-mode (MAI-Transcribe) endpoints, a 200 does not prove the
pinned model served the request. Send the same clip three ways against the
target resource: the pinned model id, a bogus model id (expect an
`InvalidRequest` 400), and `enhancedMode.enabled: false` (base model), and
confirm the pinned transcript differs from the base one. Also send the pinned
request to the previous resource and confirm it returns 400 rather than a
base-model 200.

Treat copied modality metadata as pending until tested against the new model.
For example, a copied TTS voice list can be staged on a hidden model, but each
voice must be live-tested before unhide. Preserve the pending status in the
staging plan instead of presenting copied identifiers as provider-confirmed.

Classify failures by cause:

- `429` or quota errors, such as a provider limit of 12 RPM, indicate capacity
  pressure. Record the limit and decide whether a low-limit launch is
  authorized.
- Authentication failures indicate key, resource, secret propagation, or
  resolver mapping problems.
- Adapter/request failures indicate protocol, deployment ID, base URL, or
  modality-contract problems.

Mission Control's eye-icon unhide path can bypass a baseline-unhide gate when
the human explicitly authorizes that exception for a quota-constrained launch.
It does not replace deployed key verification, real artifact validation,
pricing checks, or launch approval.

## Precedents

- PR [#29881](https://github.com/OpenRouterTeam/openrouter-web/pull/29881):
  image clone mapped its dated permaslug to the existing image key.
- PR [#29995](https://github.com/OpenRouterTeam/openrouter-web/pull/29995):
  image moved to a dedicated Foundry resource and added env, mock-env,
  manifests, Infisical, and focused mapping tests.
- PR [#30043](https://github.com/OpenRouterTeam/openrouter-web/pull/30043):
  voice sibling reused East US 2 and the existing adapter/key, with an
  explicit new permaslug mapping.
- [Video walkthrough: Azure EU endpoint onboarding](https://openrouter.slack.com/archives/C0BB2TQ657D/p1782484780985789)
  (Tomas, pinned in Slack) — end-to-end screen recording of onboarding an
  Azure EU (Sweden Central) endpoint, including
  [Buddy staging the EU endpoints](https://openrouter.slack.com/archives/C0AE75NKXJB/p1782483535504059?thread_ts=1782393887.367489&cid=C0AE75NKXJB).
- [Azure Foundry deployments portal (non-EU, global endpoints)](https://ai.azure.com/nextgen/r/stRnRs08TdOHGcoKh6wuAg,OpenRouter,,openrouter-foundry-east-resource,openrouter-foundry-eastus2/build/models/deployments)
  — main onboarding entry point for the `openrouter-foundry-eastus2` resource
  ([Slack context](https://openrouter.slack.com/archives/C0BB2TQ657D/p1783379367301079)).

## Related skills

- `onboard-frontier-model`: broader model registration checklist. Its Azure
  checklist already requires checking `packages/providers/configs/azure.ts`
  and every model switch, including the API-key and completion-URL switches.
  Use this skill for the Azure resource, secret, staging, and runtime gates.
- `buddy`: stage the confirmed endpoint fields, pricing, provider overrides,
  and visibility in prod through the Buddy API, with PR deployment state,
  assumptions, and deferred scope called out in each preview.
- `stage-endpoint`: local database staging and local endpoint testing.

## Improve this skill

Apply the universal checklist in `.agents/skills/AGENTS.md` before finishing:
remove stale paths, add newly discovered Azure sites, and keep one-time launch
details out of this skill.
