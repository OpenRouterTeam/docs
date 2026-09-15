---
name: verify-byok-declared-zdr
description: Verify the BYOK provider-agreement declarations (tri-state ZDR and declared data region) end to end across admin radio controls, frontend API persistence, and routing, including inheritance and explicit non-ZDR shared-capacity fallback.
user-invocable: true
---

# Verify BYOK declared ZDR

`provider_api_keys.declared_zdr` is nullable with no default: NULL inherits the platform endpoint's effective policy, true declares the customer's account ZDR, and false explicitly declares it non-ZDR. The declaration applies only to BYOK copies, never the platform original. Video remains retaining. All BYOK providers may declare; provider identity is not an attestation allowlist.

`provider_api_keys.declared_region` sits in the same **Provider agreement** section as a **Data region** radio group (`global` / `europe` / `us`, each with its hostname hint). NULL means undeclared and renders as **Global**; NULL and `global` are behaviorally identical, so the form only sends the field once the admin changes it. A `europe` or `us` declaration lets a BYOK copy minted from that key serve requests on the matching regional host even when the platform endpoint is out of region. It is never honored for private rows, `global.` cross-region inference profiles, endpoints pinned to a cloud region outside the declared one, or video output models.

The acceptance matrix is in [features/README.md](features/README.md).

## Automated checks

Run the full routing suite, not only the policy slice: the full pipeline includes HIPAA passes and fallback slicing.

```bash
(cd packages/db && bun test provider-api-keys/declared-zdr.test.ts provider-api-keys/declared-region.test.ts endpoints/zdr.test.ts)
(cd packages/routing && bun test)
(cd packages/video-generation && bun test routing)
(cd packages/frontend && bun test provider-api-keys/schemas.test.ts)
```

Run DOM tests in separate processes because existing module mocks in ProviderKeyCard tests replace the collapsed row globally. Use the DOM preload; a plain `bun test` has no document.

```bash
cd projects/web
for file in KeyCardProviderAgreement.dom.test KeyCardDataRegionField.dom.test KeyCardCollapsedRow.dom.test ProviderKeyCard.dom.test build-upsert-payload.test key-form-state.test; do
  RTL_SKIP_AUTO_CLEANUP=true bun test --preload ./bun-test.dom-setup.ts "$file"
done
```

For real Postgres tests, use `bun run db:start` and `bun run db:migrate`, then the package integration scripts. Read `.agents/skills/db-integration-tests/SKILL.md` for preload/environment details. The frontend API uses its existing Vitest worker integration runner:

```bash
(cd packages/db && bun run test:integration -- --test-name-pattern='declared_')
(cd services/cfw-frontend-api && bun run test:integration integration/provider-api-keys.test.ts)
```

Do not report integration proof when database setup was unavailable.

## Launch and doctor

Follow `local-dev-env` and `testing-byok-page` for local web, cfw-api, cfw-frontend-api, dev-fs-logs and Postgres. Use the seeded Clerk test account. Confirm the provider list loads and the migration is applied as nullable, with existing rows NULL. A locally applied older boolean migration must be reset/reapplied through the DB scripts; its previous NOT NULL false default is not the tri-state schema.

## Browser walkthrough

1. Open a provider's BYOK page and expand an existing undeclared key. Under Provider agreement, **Use OpenRouter's default** is selected. No declaration badge appears. Saving an unrelated edit omits `payload.declared_zdr`.
1. Check the inheritance hint under that option: retaining defaults show **{Provider} currently retains prompts.**, ZDR defaults show **{Provider} currently has zero data retention.** If the provider default is unknown, no hint is rendered.
1. Select **My account has ZDR** (hint: *Allowed when a ZDR guardrail is on for {Provider}.*). Save sends `payload.declared_zdr: true`. Reload preserves the selection and the collapsed row shows **ZDR**.
1. Select **My account does not have ZDR** (hint: *Blocked when a ZDR guardrail is on for {Provider}.*). Save sends false, not omission. Reload preserves it and the badge reads **Not ZDR**.
1. Select **Use OpenRouter's default**. Save sends null, clearing the prior declaration; reload selects inheritance and removes the badge.
1. Repeat on a different provider and at a narrow viewport. Radio labels must be readable and clickable. The video exclusion remains visible.
1. Move the key into the fallback section: declaration controls remain available, while the shared-capacity prohibition controls do not. A new key is not saveable until its secret is entered.
1. Below the ZDR radios, **Data region** lists **Global** `openrouter.ai`, **European Union** `eu.openrouter.ai`, **United States** `us.openrouter.ai`. An undeclared key shows **Global** selected with no badge, and saving an unrelated edit omits `payload.declared_region`.
1. Select **United States**. Save sends `payload.declared_region: "us"`. Reload preserves the selection and the collapsed row shows **US** beside any ZDR badge. Repeat with **European Union** (`"europe"`, badge **EU**).
1. Select **Global** on a declared key. Save sends `"global"` (not omission, not null); reload selects **Global** and removes the badge.

Record request method, status, and sanitized declaration payload; never capture credentials or cookie values. Repeat create with omitted/null/true/false, edit omission from all three states, clearing true and false to null, and copy-to-workspace from all three states. For the region, repeat create with omitted/null/`global`/`europe`/`us`, edit omission from each state, and copy-to-workspace from each state.

Verify the persisted rows directly:

```bash
docker exec openrouter-web_db psql -U postgres -d postgres -c "select id, provider, declared_zdr, declared_region from provider_api_keys order by id desc limit 3"
```

## Routing walkthrough

Send a request with `provider: { zdr: true }`, then repeat without ZDR and with account-level ZDR. Inspect the final candidate pool in local routing diagnostics, not just the provider name (platform and BYOK copies share a provider).

| Platform policy | Declaration | Shared capacity | ZDR request outcome |
|---|---|---|---|
| Retaining | null | Any | Cannot rescue this endpoint; other eligible providers may serve |
| ZDR | null | Allowed or prohibited | Existing BYOK inheritance unchanged |
| Retaining | true, prioritized or fallback | Allowed | Declared copy survives; retaining original drops |
| Retaining | true | Either prohibition | Declared prioritized copy survives without platform capacity |
| ZDR | false, prioritized or fallback | Allowed | BYOK copy drops; platform capacity survives |
| ZDR | false | Either prohibition | Policy-specific ZDR rejection if no alternative survives |
| Either | false | Any | Without ZDR enforcement, retaining BYOK copy remains usable |
| Retaining | null required prioritized + true fallback | Required models | Required-key behavior blocks fallback copies; ZDR rejection |

Do not create impossible fallback + BYOK-only fixtures; the DB rejects that combination. The UI normalizes required keys to prioritized. HIPAA-refused/unknown posture never projects a declared copy; verify with the real full-pipeline regression. Training policy is independent and unchanged.

### Region walkthrough

Send the same request to `us.openrouter.ai` (or the local equivalent host) with a model whose only platform endpoint is out of region, then repeat on `eu.` and on the global host. A declaration saved through the UI reaches routing only after the per-user auth cache entry expires (about 90 seconds; nothing invalidates it on write, same as `declared_zdr` and `allowed_*`), so wait that long or bypass the cache before judging a routing outcome against a fresh save.

| Host | Declaration | Platform endpoint region | Outcome |
|---|---|---|---|
| `us.` | null or `global` | Out of region | 404 "No endpoints found supporting your data region." |
| `us.` | `us`, prioritized or fallback | Out of region | Declared BYOK copy serves; platform original drops |
| `us.` | `europe` | Out of region | 404, same as undeclared |
| `eu.` | `europe` | Out of region | Declared BYOK copy serves |
| Global | Any | Any | Pool identical to the undeclared run |
| `us.` | `us` | Private row, `global.` inference profile, pinned non-US cloud region, or video model | Not honored; fail closed |

A region declaration never widens ZDR: a `us`-declared key with `declared_zdr` null still fails a `zdr: true` request on a retaining platform row. Guardrail `allowed_data_regions` still judges OpenRouter's own classification of the endpoint: the pre-BYOK guardrail step skips that check, and `dropGuardrailRetainingEndpointsAfterBYOK` runs it on the post-BYOK pool whenever a request key declares ZDR or the request's region, so a region-declared copy of an out-of-region row is dropped under that guardrail whether or not the key also declares ZDR (fail-closed until ECO-3922). On a routing checkout older than `8ddb282a381` the step only ran for a ZDR declaration and the `declared_zdr` null case served; check the step history before judging.

## Evidence and cleanup

Attach automated counts, desktop/narrow screenshots, a save/reload recording covering all three ZDR states and the three region choices, persisted values, and sanitized final-pool evidence. Mark browser or database checks unrun when unavailable. Delete only test keys this run created, via the UI or approved DB scripts, and stop locally launched services.
