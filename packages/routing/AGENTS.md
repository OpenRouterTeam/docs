# Regional Routing & Data Residency

**CRITICAL:** OpenRouter promises customers that _their prompt and
completion data never leaves the data region their request landed in._
A region missing a feature is acceptable; a region that leaks data
outside itself is catastrophic. When in doubt, disable, don't leak.

This applies to **every** code path that touches prompt/completion
data: inference, server tools that see prompts (web search, file
parsing), prompt storage (store and retrieve), classification,
moderation, and anything that ships prompt/completion bytes to extra
infrastructure or an external service.

## The default rule for new work

If your change introduces **new infrastructure, a new outbound network
destination, or a new external service** that handles prompt/completion
data, it must be **disabled for every non-global data region** until
you can prove that infra and network call stay entirely in-region.
Dealing with an in-region _company_ is not enough — the data itself
must be processed in-region.

Close the feature-parity gap later by adding real in-region support;
never close it by letting a region reach out to global infra.

## How the data region is determined

The region comes from the request hostname (`eu.` → Europe, `us.` → US,
otherwise Global). Do not re-derive it from anything else.

```typescript
import { DataRegion, getDataRegionFromRequest }
  from '@openrouter-monorepo/helpers/data-regions';

const dataRegion = getDataRegionFromRequest(c.req.raw);
// DataRegion.Global | DataRegion.Europe | DataRegion.Us
```

Inside the router/plugins, use the region already resolved on the
router — do not re-parse it. `initPlugins` threads `router.dataRegion`
into every plugin that needs it
(`packages/router/plugins/base/init-plugins.ts`).

## Patterns for guarding a feature

Pick the pattern that matches your surface. Add a
block-comment explaining _why_ the out-of-region infra forces the guard.

For the `dataRegion` field on opts types: make it **required**
(`dataRegion: DataRegion`) when the component always runs in a request
pipeline context where the region is known. Make it **optional**
(`dataRegion?: DataRegion`) when the component can be constructed in a
context where no region is specified yet (e.g. auto-router, web-search).
In the optional case, treat `undefined` as **not global** — an
unspecified region must fail closed (skip or reject the feature), not
silently pass through as global. Guard with
`if (dataRegion !== DataRegion.Global)` (not
`if (dataRegion !== undefined && dataRegion !== DataRegion.Global)`,
which lets `undefined` through as global).

### 1. Skip silently (feature is optional / best-effort)

Use when the feature can simply not run in-region without failing the
request (moderation preflight, async classification).

```typescript
/* NOTE: Moderation sends request content to the OpenAI moderation API,
 * which runs outside the request's data region, so it is skipped for
 * non-global regions. */
if (this.opts.dataRegion !== DataRegion.Global) {
  return ok(requestFragment);
}
```

See `packages/router/plugins/moderation/index.ts` and
`packages/queues/tasks/classify.ts` (`enqueue` opts regional requests
out of the global PubSub → Azure classifier path).

### 2. Reject with an error (feature is user-requested)

Use when the user explicitly asked for something we cannot honor
in-region — fail loudly with a clear message instead of degrading
silently (`openrouter/auto` → task-type classifier, external web search).

```typescript
/* NOTE: Task-type classification runs outside the request's data
 * region, so auto-routing is only available in the global region. */
if (this.opts.dataRegion !== DataRegion.Global) {
  return errT({
    location: 'AutoRouterPlugin.resolveEndpoints',
    rawError: new Error(
      'The openrouter/auto router is not available in your data region. ' +
        'Choose a model directly or use the global API endpoint (openrouter.ai).',
    ),
    status: HTTPStatus.S400_Bad_Request,
  });
}
```

See `packages/router/plugins/auto-router/index.ts` and
`packages/router/plugins/web-search/index.ts`.

### 3. Gate a whole ingress

If an entire worker/route has no in-region deployment yet, reject
regional hostnames at the door with the shared middleware instead of
guarding each handler:

```typescript
import { createDataRegionGateMiddleware } from '@openrouter-monorepo/routing/middlewares/data-region-gate';

app.use('*', createDataRegionGateMiddleware({
  message: 'This endpoint is not yet available in your data region.',
}));
```

`packages/routing/middlewares/data-region-gate.ts`.

### 4. Per-capability availability table

When some variants of a feature are in-region and others are not, model
availability explicitly with an exhaustive `switch` (both `DataRegion`
and the capability enum end in `value satisfies never`) so a newly added
region or engine fails to compile until someone decides its residency.

```typescript
// packages/router/plugins/file-parser/is-pdf-parser-engine-available-in-data-region.ts
// Europe → only the Native engine; MistralOCR / CloudflareAI are out-of-region.
```

## Background and async tasks

Queue handlers, cron jobs, and scheduled tasks that process
prompt/completion data must also respect the data region — take
`dataRegion` as a required parameter and return early for non-global
regions (see `classify.ts`).

## Endpoint routing: the provider must be physically in-region

Region-locking inference is not just about our own infra — the chosen
provider endpoint must run in a data center inside the region. Endpoint
filtering lives in `packages/routing/filters/by-data-region.ts` using
`isProviderRegionInDataRegion`
(`packages/providers/configs/region-base-url.ts`), which matches the
endpoint's `provider_region` against known in-region cloud prefixes. A
null/unknown or `global` provider region is **not** treated as in-region
(it could route anywhere). If no endpoint qualifies, the request 404s
rather than falling back to an out-of-region endpoint.

### Provider regional hosts vary by API path and region

A provider's regional host does not automatically cover every API path.
Its regional guarantee varies along four axes, verified for OpenAI
against
<https://developers.openai.com/api/docs/guides/your-data#which-models-and-features-are-eligible-for-data-residency>:

1. **API path.** Path varies by region: eu.api.openai.com supports
   /v1/images/generations regional processing but ae.api.openai.com
   does not (AE processes only /v1/chat/completions, /v1/embeddings and
   /v1/responses).
2. **Storage vs processing.** Regional storage alone does not keep the
   prompt in-region during inference. Storage-only regions such as
   au.api.openai.com do not qualify for in-region routing.
3. **Account approval.** Same path, different account terms:
   us.api.openai.com and eu.api.openai.com both process images, but EU
   requires enhanced Zero Data Retention or enhanced Modified Abuse
   Monitoring approval on the customer's account. For BYOK that is the
   customer's OpenAI account and we do not verify it. Platform keys
   would need our own approved regional projects and keys per region.
4. **Model snapshot.** A path may be regionally processed only for
   specific snapshots.

The `(region, path)` allowlist
(`packages/providers/key-schemas/openai-byok-upstream.ts`) is the
enforcement point and the pattern to copy for other providers. It may
only contain pairs with documented regional processing. Adding a
provider, region or path means rereading the provider's residency table
and pinning every pair in `it.each` tests. Unlisted pairs and
key/request region mismatches fail closed before fetch, with no fallback
to the global host. EU additionally documents no `store=true` and no
`background=true`. Do not describe provider-side rejection behaviour as
fact, it is undocumented. We forward the provider's response unchanged.

### Proving the selected OpenAI BYOK host in production

Once a direct OpenAI BYOK key resolves, the adapter emits the
`byok_upstream_region` breadcrumb (`global`, `us` or `eu`) from
`packages/router/adapters/openai/byok-upstream-region.ts`. It is derived
from the resolved upstream, not from the customer's declared input, so a
request that fails closed before upstream selection carries no value,
and no other provider emits the field. Breadcrumbs merge across the
invocation, so when an OpenAI BYOK attempt fails and a later endpoint
serves the request, the serving attempt's log still carries the failed
attempt's region. Query it with
`@breadcrumbs.generation_id:<gen_id>` and read it on the OpenAI
attempt's own transaction attempt log, comparing it with the request
hostname's required region and the key's `declared_region`. It proves
which OpenAI host we selected for that attempt. It
does not prove OpenAI's processing location or a project-level
data-residency guarantee, which is a customer attestation we do not
verify. The full upstream URL stays in the local and preview
`adapters/base-fetch-request` FS log only.

### Baseten: URL-derived region, URL-validated declaration

Source: [Baseten regional deployments](https://docs.baseten.co/deployment/regional-deployments).

- On private-deployment create and on every URL update, the management handler derives `provider_region` from a regional deployment host, `model-{model_id}-region-{slug}.api.baseten.co`, and writes `null` for any other Baseten host (`packages/providers/configs/provider-region-from-base-url.ts`, `services/cfw-frontend-api/src/routes/private-deployments/management-handler.ts`).
- Slugs are the doc's Available regions table, currently `us` and `eu`, allowlisted via `MULTI_REGIONS`. A new Baseten slug must be added there explicitly. Unknown slugs derive `null`.
- On create and on every update, including one that omits the declaration and keeps the stored value, `isDeclaredRegionConsistentWithBaseUrl` checks the effective `declared_region` against the host. A `us` host accepts only a `us` declaration and an `eu` host only `europe`. A mismatch is a 400 with reason `declared_region_base_url_mismatch`.
- Shared Model APIs (`inference.baseten.co`), non-regional dedicated hosts (`model-{model_id}.api.baseten.co`), `chain-` hosts, and [regional environments](https://docs.baseten.co/deployment/regional-environments) with a customer-chosen `env_name` derive no region. A regional declaration on such a URL is rejected because the URL carries no evidence of a region. A `global` or empty declaration is always accepted.
- The region is fixed per deployment. Changing it creates a new deployment with a new URL, so `provider_region` is re-derived whenever the URL changes, and a move to a non-regional host clears it to `null`.
- Rows with a non-null `provider_region` route and slug by it. A private row with a null `provider_region` falls back to its declaration for `isEndpointInDataRegion` and for the `/eu` or `/us` slug tag (`packages/providers/slug.ts`), so `provider.only: ["baseten/eu"]` matches either kind of row.

## Entitlement

Regional routing is a gated feature. Requests on a regional hostname
must pass the region-lock eligibility check
(`services/cfw-api/src/middlewares/region-lock-eligibility.ts`,
`regionalRoutingGate` from
`packages/entitlements/gates/regional-routing.ts`); ineligible accounts
get a 403. Entitlement is derived from plan tier (business/enterprise)
or the `is_eu_routing_enabled` user flag — see
`packages/entitlements/derive.ts`. Global requests pass through
untouched.

## Zero Data Retention (ZDR) — related but distinct

ZDR (`isZdrEnforced` from
`@openrouter-monorepo/guardrails/helpers/is-zdr-enforced`) is a separate
concern: it ensures a provider does not retain prompt/completion data
after the request completes. Regional routing ensures the data stays
in-region _during_ processing. Do not conflate the two — ZDR applies to
the provider endpoint, not to e.g. prompt storage or other opt-in
features. A feature can be ZDR-compliant but still leak data
out-of-region, and vice versa.

## Cloudflare Durable Objects

For features that use Cloudflare Durable Objects (e.g. session storage,
rate-limit state), use `JURISDICTION_BY_DATA_REGION` from
`@openrouter-monorepo/helpers/data-regions` to map the data region to a
`DurableObjectJurisdiction` (`'eu'` for Europe, `undefined` for Global).
This ensures the Durable Object itself runs in the correct jurisdiction.

## Testing (required)

Every guard ships with tests. Add a `data region gating` /
`data region guard` describe block that proves:

- **Global** → the feature runs as before.
- **Non-global (Europe)** → the feature is skipped or rejected, and the
  out-of-region dependency is **never called** (assert the mock /
  external client was not invoked, e.g.
  `expect(resolveRouterModelsMock).not.toHaveBeenCalled()`).

Availability tables get exhaustive `it.each` coverage over every
`(region, variant)` pair. See the `.test.ts` files next to each source
referenced above.

## Development checklist

Before writing code for a feature that touches prompt/completion data:

1. Does your change touch prompt/completion data? (inference, server
   tools, storage, classification, moderation, anything that ships
   prompt bytes externally)
2. Does it introduce new infra, a new outbound destination, or a new
   external service?
3. Which guard pattern applies? (skip-silently / reject / gate-ingress /
   availability-table)
4. Have you added `dataRegion` to the opts type (required or optional
   per the convention above)?
5. Have you written a gating test that asserts the out-of-region
   dependency is never called?
6. If adding a new `DataRegion` or capability variant: do all exhaustive
   switches still compile?
