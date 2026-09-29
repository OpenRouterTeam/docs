# BYOK provider-agreement acceptance matrix

Covers both declarations on `provider_api_keys`: the tri-state `declared_zdr` and the `declared_region` (`global` / `europe` / `us`, NULL = undeclared).

## State and persistence

| Case | Expected | Automated owner |
|---|---|---|
| Existing key or create omits declaration | null, inherit existing endpoint policy | DB get-public-provider-keys integration; frontend API provider-api-keys integration |
| Create explicitly supplies true/false/null | Exact supplied value persisted | Frontend API provider-api-keys integration; frontend schemas.test.ts |
| Edit omits declaration from any prior state | Prior state unchanged | Frontend API provider-api-keys integration |
| Edit supplies null after true or false | Clear to inherit | Frontend API provider-api-keys integration |
| Copy to workspace | Preserve true/false/null verbatim | Frontend API provider-api-keys integration |
| Runtime/header key | null, no self-declaration | DB create-runtime-key.test.ts |
| Create omits region | null | Frontend API provider-api-keys integration |
| Create supplies `global` / `europe` / `us` / null | Exact supplied value persisted; `US`, `eu-west-1`, `true` rejected | Frontend API provider-api-keys integration; frontend schemas.test.ts |
| Edit omits region from any prior state | Prior state unchanged | Frontend API provider-api-keys integration |
| Edit supplies null after a region | Clear to undeclared | Frontend API provider-api-keys integration |
| Copy to workspace | Preserve region verbatim | Frontend API provider-api-keys integration |
| Region predicates | `hasRegionDeclaration` false for null / `global` / unknown / undefined; `isKeyDeclaredInDataRegion(key, Global)` always false | DB declared-region.test.ts |

## Admin UI

| Case | Expected | Automated owner |
|---|---|---|
| Persisted true/false/null | Corresponding radio selected | KeyCardProviderAgreement.dom.test.tsx |
| Click each radio | Exact boolean/null callback | KeyCardProviderAgreement.dom.test.tsx |
| Untouched declaration during unrelated save | Field omitted | ProviderKeyCard.dom.test.tsx; build-upsert-payload.test.ts |
| Clear a declared key to inherit | Explicit null payload | ProviderKeyCard.dom.test.tsx; build-upsert-payload.test.ts |
| Badge true/false/null | ZDR / Not ZDR / none | KeyCardCollapsedRow.dom.test.tsx |
| Provider retention default true/false/unknown | Retains / ZDR / no invented hint | KeyCardProviderAgreement.dom.test.tsx |
| Any BYOK provider, prioritized or fallback | Declaration controls remain available | ProviderKeyCard.dom.test.tsx |
| New key without a secret | Declaration alone does not enable Save | ProviderKeyCard.dom.test.tsx |
| Three region radios with hostnames | Global `openrouter.ai`, European Union `eu.openrouter.ai`, United States `us.openrouter.ai` from `HOSTNAME_BY_DATA_REGION` | KeyCardDataRegionField.dom.test.tsx |
| Persisted null or `global` | Global selected; form stays clean; field omitted | KeyCardDataRegionField.dom.test.tsx; ProviderKeyCard.dom.test.tsx |
| Persisted `europe` / `us` | Matching radio selected | KeyCardDataRegionField.dom.test.tsx; ProviderKeyCard.dom.test.tsx |
| Click a region radio | Enum value callback; form dirty; `declared_region` sent | KeyCardDataRegionField.dom.test.tsx; ProviderKeyCard.dom.test.tsx; key-form-state.test.ts |
| Untouched region during unrelated save | Field omitted | build-upsert-payload.test.ts |
| Explicit Global on a declared key | `'global'` sent, not omitted | build-upsert-payload.test.ts; ProviderKeyCard.dom.test.tsx |
| Region badge | `EU` / `US` for `europe` / `us`; none for `global` / null | KeyCardCollapsedRow.dom.test.tsx |
| Region field in the fallback section | Remains available | ProviderKeyCard.dom.test.tsx |

## Routing

`packages/routing/endpoints/declared-zdr-byok-routing.test.ts` contains a readable full-production-pipeline matrix grouped first by declaration, then the exact shared-capacity UI label, then platform retention. Each case names the expected final pool. `declared-zdr-byok-pipeline.test.ts` retains full-order HIPAA and fallback-slice regressions.

| Declaration | Retaining platform + ZDR request | ZDR platform + ZDR request | No ZDR requirement |
|---|---|---|---|
| null | No rescue | Inherited ZDR copy remains eligible | Existing behavior |
| true | Declared copy survives, original removed | Declared copy remains eligible | Ordering unchanged |
| false | Retaining copy ineligible | Copy drops; platform survives only if permitted | Copy usable with retaining policy |

Cross with **Use shared capacity**, **Never use shared capacity for models this key applies to**, and **Never use shared capacity for any model on this provider**. Fallback is valid only for the first UI setting; required is normalized to prioritized and fallback + BYOK-only is DB-invalid. With either prohibition and only explicit-retaining copies, reject early with the ZDR policy message rather than generic empty-pool error. Null success pools compare against the same pipeline without declaration post-checks.

Additional owners: apply-declared-data-policy.test.ts pins immutable stamping and video exclusion; with-expected-byok-copy-data-policy.test.ts pins key eligibility, required-key fallback suppression and HIPAA refusal; policy post-step tests pin retaining sibling removal. The video routing suite confirms declarations cannot make video ZDR. Training declarations are out of scope.

## Region routing

`packages/routing/endpoints/declared-region-byok-routing.test.ts` runs the production pipeline with literal pools. `project-declared-region-byok-copy.test.ts` pins the pre-BYOK keep-through, `is-byok-copy-in-data-region.test.ts` the post-BYOK judge, and `can-honor-declared-region.test.ts` the fail-closed carve-outs.

| Host | Declaration | Out-of-region platform endpoint | Outcome |
|---|---|---|---|
| `us.` | null or `global` | Yes | 404 region error, no fall-through |
| `us.` | `us`, prioritized or fallback | Yes | Declared copy serves; fallback copy ranks behind in-region platform rows |
| `us.` | `europe` | Yes | 404 region error |
| `eu.` | `europe` | Yes | Declared copy serves |
| Global | Any | Any | Pool identical to the undeclared run |
| `us.` | `us` | Private row, `global.` inference profile, pinned non-US `provider_region`, or video model | Not honored |
| `us.` | `us` + `declared_zdr` null, `zdr: true` | Retaining | ZDR error; region does not widen ZDR |

Guardrail `allowed_data_regions` continues to judge the endpoint's own `provider_region`; the post-BYOK guardrail pass runs for a region declaration as well as a ZDR one, so `us` + any `declared_zdr` value is dropped under an `allowed_data_regions: ['us']` guardrail when the platform row is out of region (fail-closed until ECO-3922).

## Manual evidence still required

Database integration and browser save/reload must run against a migrated environment before merge-ready status. Unit and DOM tests alone do not prove persistence, auth-service propagation, or live upstream behavior.
