# SSRF Review

## Rule

**The URL that was validated must be the URL that is actually fetched.**
Everything below is a way that identity breaks.

## Failure modes to reject

### The authority is not what the check thought

A caller-supplied fragment is interpolated into the host after being validated
only as an unconstrained string. Because a URL's authority ends at the first
slash, at-sign, or colon, the fragment relocates the host.

SEC-119 covers BYOK `region` reaching Vertex and Bedrock hosts. SEC-120 covers
the same region reaching the Gemini cache-write fetch. SEC-122 covers
Snowflake `account` reaching the Snowflake host.

#### The accepted remedy, now on main

The remedy from PR
[#31282](https://github.com/OpenRouterTeam/openrouter-web/pull/31282) has
three layers, and the third is the one worth understanding. Schema tightening
alone leaves values that were stored before the change, and it does not cover
the other construction sites, each of which is independently reachable.

1. A shared syntax pattern, `PROVIDER_REGION_PATTERN` in
   `packages/providers/configs/provider-region.ts`.
2. Schema validation on stored keys via `StoredProviderRegionSchema`, which
   tolerates an empty string as unset so existing fallback behavior keeps
   working. Evidence: `packages/providers/key-schemas/bedrock.ts`.
3. A runtime `isValidProviderRegion` check at every URL construction site.
   Evidence: `packages/providers/configs/google-vertex.ts:38` and
   `packages/providers/configs/provider-url.ts:93`.

Snowflake's `account` got the same treatment with a provider-specific pattern
and a comment stating what the character set is guarding
(`packages/broadcast/destinations/snowflake/schemas.ts`, PR
[#31902](https://github.com/OpenRouterTeam/openrouter-web/pull/31902)). A new
schema field that reaches a URL host needs this pairing: a syntax constraint
at the schema and a check at the construction site.

### The rebuilt URL is not the validated URL

Validating a URL and then reconstructing it from parsed parts breaks
identity: `new URL(pathname + search, base)` re-parses the pathname, and a
leading `//` relocates the authority. The Switchyard diversion path validated
`https://openrouter.ai//attacker.example` against its origin, which parses as
`https://openrouter.ai`, then rebuilt the destination from the pathname and
sent a freshly minted GCP ID token to `attacker.example` (PR
[#33966](https://github.com/OpenRouterTeam/openrouter-web/pull/33966)).

The accepted remedy: construct from the trusted origin and assign `pathname`
and `search` as properties rather than re-parsing a composed string, reject
protocol-relative pathnames at input validation, and assert the final URL's
origin equals the expected origin before attaching any credential. Evidence:
`services/gcp-bench-worker/src/switchyard/http-client.ts` and its tests in the
same PR.

### The URL comes from an upstream response

Provider adapters download artifact and asset URLs taken from upstream
provider responses. Those URLs are attacker-influenceable through the
provider and must go through the guard like caller-supplied URLs. Image
adapters were guarded first (PR
[#33568](https://github.com/OpenRouterTeam/openrouter-web/pull/33568)) while
eleven video adapters kept the identical raw `globalThis.fetch` block until
SEC-191, PR
[#33655](https://github.com/OpenRouterTeam/openrouter-web/pull/33655).

The accepted primitive is `fetchProviderContent` in
`packages/supersize-streaming/provider-content-download.ts`, with
`fetchVideoArtifact` in
`packages/video-generation/adapters/fetch-video-artifact.ts` as the shared
adapter entry point. A new adapter that downloads an upstream-supplied URL
through bare `fetch` is a finding.

### The URL changes after the check

`saferURL()` and `validateUrlForSSRF` validate the initial literal URL string,
then a raw `fetch` with default redirect following goes wherever a 3xx points.
This is the shape covered by SEC-121, SEC-123, SEC-124, SEC-125, SEC-126, and
SEC-127 across the observability destinations (PR
[#32509](https://github.com/OpenRouterTeam/openrouter-web/pull/32509)), and
again by SEC-168 across eight more destinations (PR
[#33116](https://github.com/OpenRouterTeam/openrouter-web/pull/33116)).

The accepted primitive inside `packages/broadcast` is
`BaseDestination.guardedFetch`
(`packages/broadcast/destinations/base-destination.ts`), which delegates to:

```ts
import { fetchWithSsrfGuard } from '@openrouter-monorepo/helpers/fetch-with-ssrf-guard';
```

It manually handles redirects, validates every redirect target, resolves and
checks the target hostname, caps redirect hops at five, and rejects
cross-origin redirects.

Evidence: `packages/helpers/fetch-with-ssrf-guard.ts` (moved from
`packages/supersize-streaming` by PR
[#33649](https://github.com/OpenRouterTeam/openrouter-web/pull/33649),
together with the pinned-address transport).

Adoption is opt-in: `guardedFetch` is a protected method a subclass may
simply not call, and after SEC-168 a minority of destination directories
still call bare `fetch`. The existence of the guard is therefore no evidence
about any particular destination; a new or changed destination that sends a
configuration-derived URL through bare `fetch` is a finding even though the
safe primitive sits one method away.

### Enforced egress boundaries and their baselines

Where opt-in adoption failed, the accepted end state is a choke point plus a
lint rule with a burndown baseline driven to zero. Mission-control server
code has exactly two egress paths (SEC-185, SEC-187, PRs
[#33888](https://github.com/OpenRouterTeam/openrouter-web/pull/33888) and
[#33891](https://github.com/OpenRouterTeam/openrouter-web/pull/33891)):

- `fetchPublicUrl` / `probePublicUrl` in
  `projects/mission-control/utils/helpers/public-egress.ts` for
  caller-supplied or stored URLs, built on `fetchWithSsrfGuard` with pinned
  transport.
- `fetchInternalUpstream` for fixed first-party upstreams whose authority is
  never caller-derived.

The `no-bare-fetch-in-mission-control-server` and `no-bare-fetch-in-broadcast`
rules in `scripts/oxlint/rules-security.ts` enforce the boundaries. Adding an
entry to a `scripts/oxlint/*-baseline.ts` file grants a security exemption
and is itself a finding to justify, not a formality.

### The test connection reflects the response

Every redirect-SSRF finding above was amplified by the same second defect:
the destination test server actions returned the upstream response body to
the caller on non-2xx, turning a blind SSRF into a read side-channel against
internal services. When a diff adds or changes a connection-test or preview
path that fetches a user-configured URL, require a status-only result; the
upstream body must not reach the client.

### The default value skips the refinement

The Phoenix schema uses:

```ts
baseUrl: saferURL().default('http://localhost:6006')
```

Evidence: `packages/broadcast/destinations/phoenix/schemas.ts:10`.

With the repository's Zod version, `4.4.3`, parsing
`PhoenixConfigSchema.safeParse({ apiKey: 'x' })` returned:

```json
{"success":true,"data":{"apiKey":"x","baseUrl":"http://localhost:6006"}}
```

The default was supplied without running the inner `saferURL` refinement.
The version evidence is the `zod` entry in `package.json`.

### The family predicate is not wired into the validator

`packages/helpers/ssrf-protection.ts` holds one predicate per internal-name
family (`isCloudMetadataHost`, `isKubernetesInternalHost`,
`isInternalDnsHost`, `isCloudflareTunnelHost`). Defining a predicate and
reaching the shared validator are separate changes: `isInternalDnsHost` sat in
that file with a single bench-runner caller, so `.internal` and `.local` hosts
passed `validateUrlForSSRF` on every gated path (PR
[#38031](https://github.com/OpenRouterTeam/openrouter-web/pull/38031)). When a
diff adds or changes a host-family predicate, enumerate its callers and treat
the denylist as incomplete for every validator that does not call it. The
resolution layer is not the backstop: several call sites validate without
resolving, and the resolver degrades open where `node:dns` is unavailable.

Hostname normalization is part of the predicate. `replace(/\.$/, '')` strips
one trailing dot, so `host.internal..` survives the suffix test; every
host-family predicate and the name branch of `isLocalhost` must go through
the shared `normalizeHostname` (all trailing dots plus case folding) — a new
predicate that inlines its own trim reintroduces the gap. Test spelling
variants against each predicate directly, not only through
`validateUrlForSSRF`: the validator's `isInternalDnsHost` check masks a
broken `.internal`/`.local` suffix test in a sibling predicate, while
non-`.local` families (`.svc`, `openrouter.ai`, `cfargotunnel.com`,
`localhost`) have no such backstop. Families this layer does not refuse:
`.home.arpa`, `.corp`, `.lan`, single-label intranet names, and Cloudflare
tunnel hosts.

## What the primitives do not give you

`validateUrlForSSRF` is a syntactic check plus a hostname denylist covering
only the families wired into it. It does
not resolve DNS, follow redirects, or make a network request. Its import path
is:

```ts
import { validateUrlForSSRF } from '@openrouter-monorepo/helpers/ssrf-protection';
```

Evidence: `packages/helpers/ssrf-protection.ts:25-66`.

`fetchWithSsrfGuard` resolves DNS and passes the resolved addresses to its
`PinnedFetch` callback. Its default callback is:

```ts
pinnedFetch = (url, init) => fetch(url, init)
```

The default fetch does not honor the pinned addresses. DNS rebinding between
validation and connection therefore remains possible unless the caller
supplies a real `PinnedFetch` implementation.

The resolver also degrades to hostname-only validation when DNS is unavailable.
Evidence: `packages/helpers/ssrf-resolved-host.ts:17-23`,
`packages/helpers/ssrf-resolved-host.ts:35-47`, and
`packages/helpers/ssrf-resolved-host.ts:76-80`.

Seeing `fetchWithSsrfGuard` in a diff is necessary but not sufficient. Review
the supplied fetch implementation and the full URL construction path.

## Calibration

Raw `fetch` is the norm inside the broadcast destinations package, so its mere
presence is not the signal. The signal is a raw fetch whose URL derives from
stored configuration.

As measured on 2026-07-31, the package contained 83 bare `fetch(` call sites
and zero `globalThis.fetch(` call sites. These counts are calibration evidence,
not review rules.
