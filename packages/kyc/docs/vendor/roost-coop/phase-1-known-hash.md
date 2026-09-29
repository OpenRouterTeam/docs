# Known-image rollout contract

This is the behavior contract for the incremental known-image rollout. It supersedes the earlier observation → Coop media-review plan.

The first application checkpoint, PRs #43461–#43468, is merged but unreleased. Include the runtime/Live Config cleanup in the first release. Start with the [review and rollout guide](../../known-image-review-rollout.md). Later Queue/Sentinel, reporting and surface integrations remain local drafts. US staging HMA is deployed, but local tests do not establish real-bank readiness or authorize traffic activation. Review and enable each stage separately.

## Scope and terminology

- **HMA** (Meta Hasher-Matcher-Actioner) computes PDQ and compares bounded uploaded image bytes with configured known-hash banks. It does not fetch caller-supplied image URLs.
- The initial scope is images in direct **OpenAI provider** traffic, including Global and US processing regions. Evaluate the actual selected provider on each attempt, including fallback into OpenAI. An OpenAI model hosted by another provider does not qualify merely because of its model name.
- Initial EU-restricted requests perform no feature work. Region means the request's processing restriction, not nationality or physical location. Broader-provider and EU implementations belong to later, independently controlled stack layers; video is deferred entirely.
- The client currently reads PDQ matches and defaults to a Hamming distance threshold of `<= 31`. This is perceptual matching, not proof of byte identity. Approved bank compatibility, recommended settings and freshness ownership must be verified before blocking. A harmless local distance-zero fixture does not approve a production bank or threshold.
- **Coop** remains an optional, separately gated media/manual-review integration. The agreed known-image path uses metadata logs, then request blocking, Queue → Sentinel proposals, and direct metadata-only NCMEC reporting. It does not depend on Coop activation or showing known-hash media to reviewers.

## Stages and dependencies

| Stage | Request behavior | Detection handling | Required later work that does not gate this stage |
| --- | --- | --- | --- |
| Observe | Allow requests on matches, errors and incomplete scans. | `wLog` deliberate user/request/generation identifiers and bounded operational metadata. No match alert. First real-traffic observation uses staging HMA. | Blocking, production trust compute, Queue/Sentinel and reporting. |
| Block matches | Await screening before the eligible provider dispatches; earlier out-of-scope attempts may already have dispatched. Any qualifying match blocks the entire request, with no provider fallback. Errors and gaps initially fail open when no match was found. | Generic moderation-style prohibited-content refusal; detections may still go only to logs. | Queue/Sentinel, reporting and account actions. |
| Queue → Sentinel | Request blocking is independent of delivery and review. | Metadata-only Queue delivery creates human-reviewed full account/org ban proposals. Reuse suitable grouping and protections; protected accounts remain visible for manual handling. | NCMEC reporting and automatic account actions. |
| Reporting | No report work delays inference. | Capture incidents, preserve exact report artifacts and field provenance, prepare daily reports, retain submit/finish receipts, and expose one ledger-backed Mission Control entry per report. | Automatic account actions and monthly notices. |
| Account automation and notices | Existing request behavior continues. | Implement auditable account decisions and monthly Customer.io notices after reporting, with their own activation controls and agreed policy. | These remain required later implementation; they are not part of initial logging or human review. |

Real detections can initially remain in logs. This does not complete reporting or preservation, and a temporary manual reporting workflow is not an initial rollout dependency. Creating a Sentinel proposal does not execute an account ban. A matching result is not itself a report or an account decision.

```text
Global / US request, selected direct OpenAI provider
  → bounded image extraction and same-region HMA
      observe: log match/error/gap → provider request continues
      block: any qualifying match → refuse whole request, no fallback
             no match + error/gap → allow initially
             complete no-match → provider request continues
  → later, independently enabled metadata Queue
      → Sentinel proposal or protected-account manual follow-up
      → reporting incident ledger → daily preparation → NCMEC submit/finish
      → staff recovery/preservation and completed-report view
      → later account automation and monthly notices
```

## Runtime controls and precedence

Live Config `known_csam` rates select screening; there is no separate environment scan switch. The same entry owns `scanTimeoutMs` (integer 1–30,000, default 5,000) and `reportingIpCaptureEnabled` (default false). Transport endpoints, banks and credentials remain in the Worker environment. Zero rates in both regions skip scanner loading and credential reads. The two existing Coop handoff switches (`KNOWN_CSAM_COOP_HANDOFF_ENABLED` and `KNOWN_CSAM_COOP_EUROPE_HANDOFF_ENABLED`) belong to the optional Coop workflow. They are not the complete rollout control model, and neither is required for logging, blocking or Queue/Sentinel. Keep them off for the agreed initial path.

The [rollout policy](../../../known-csam/rollout-policy.ts) has separate `observationRate`, `blockingRate` and `failClosedRate` controls, all zero by default. Request cohorts are stable across provider attempts. Blocking does not depend on the observation rate, and fail closed only takes effect within the blocking cohort. Gradual ramps and operational acceptance remain manual decisions.

Blocking takes precedence for the same stable request sample. With observation at 100% and blocking at 1%, 1% block and 99% observe only. Equal rates leave no observation-only group; a blocking-only rollout is valid. The observation-only share is `max(observationRate - blockingRate, 0)`. The fail-closed share is capped at `min(failClosedRate, blockingRate)`. These are shares of eligible traffic, not percentages of one another. See the [operator examples](../../known-image-review-rollout.md#how-the-rates-overlap).

`additionalProvidersRate` independently expands provider eligibility. The optional `europe` configuration supplies its own regional ramps; US rates do not activate Europe. Later surface integrations must preserve these controls and same-region routing. Queue delivery and optional reporting IP capture have separate controls; enabling screening does not implicitly enable either.

| Condition | Early blocking result |
| --- | --- |
| Any qualifying match, including alongside an unscannable image | Block the whole request; never fall back to another provider. |
| Complete scan without a match | Allow. |
| Matcher error/timeout or incomplete coverage, without a match | Allow and log the failure or gap distinctly. Do not call the request clean. |
| Queue enqueue failure after a blocking match | Keep the request blocked; `eLog` the delivery failure and alert in `#alerts-platform-low-signal` when that later stage is implemented. |

Fail closed on internal screening errors is a separate later transition. The draft currently treats both errors and coverage gaps as indeterminate; the long-term treatment of coverage gaps remains a policy question. Request-level blocking applies to every account type. The existing HIPAA/unresolved-posture exemption remains in the draft pending an explicit scope decision; account protections in Sentinel must not be mistaken for new request-screening exemptions.

## Boundaries to preserve

- Keep provider clients transport-only, validate external data with Zod, and consume or cancel every response body. Use bounded bytes, response sizes and deadlines. No database writes or retained request bodies in inference-serving objects.
- Production-shaped HMA ingress uses HTTPS, an exact regional OIDC audience and the allowed caller identity. Plain HTTP is limited to loopback development. Europe must never fall back to US HMA.
- Keep prompts, media, base64, image URLs, credentials, raw vendor objects, bank records and report payloads out of logs, errors and metrics. Log only deliberate scalar identifiers and operational outcomes. Bank names stay out of logs and metric tags. The PDQ distances of confirmed matches are carried into the single `knownCsamScreeningOutcome` log line for the request so disputed matches can be triaged without the media.
- Queue messages and Sentinel proposals contain metadata, not known-hash media. Reuse the existing Sentinel grouping where suitable while preserving individual reporting incidents separately. Enqueue retries must not create duplicate incidents or proposals.
- Reporting retains exact frozen artifacts, authoritative field sources, incident links and supported external IDs/receipts. A Coop report ID is not an NCMEC report ID. Do not assume a PDF receipt or external idempotency guarantee.
- A submit/finish timeout can have an ambiguous external outcome. Existing claims and receipt-based reconciliation fence retries; age alone never permits resending. Staff inspection does not dispatch a report. Staff preservation changes require authenticated identity, an investigation reference and the reviewed revision.
- Required reporting records must survive ordinary account deletion/ban through their preservation deadline and holds. Daily preparation derives shared report preservation from the latest included request's calendar-year anniversary in UTC. Submission and receipt completion must not restart that clock. Explicit extensions and holds remain separate inputs.
- EU prompts, media and review evidence stay in the EU. Ordinary infrastructure state and deployment credentials may use the existing operational setup. Whether content-free EU incident metadata may use US Sentinel/reporting remains unanswered; EU screening must not opt it into that path meanwhile.

## Local acceptance and evidence limits

Start with the [stage-by-stage local acceptance guide](../../../../../tests/manual/2026-09-14-known-image-rollout/README.md). It covers off, observe, block and later fail-closed modes, including provider-dispatch counts, matcher failures, partial-scan match precedence and the initial EU exclusion. Use only the harmless `OPENROUTER_TEST` bank and synthetic upstream responses. The authenticated HTTP suite exercises the Worker entrypoint and isolated Postgres separately from the Router suite.

Later stack layers add actual local Queue/Sentinel acceptance, synthetic report preparation and loopback submit/finish, staff API/Postgres checks, component tests and a signed-in browser checklist. A synthetic payload proves transport and storage behavior; it does not prove approved NCMEC fields or XSD compliance. Component/API tests do not prove the full Clerk → Next → Worker browser path. Every layer must pass its own checks without code from higher layers.

No acceptance test may contain abuse material, mutate a real bank, submit a real report or contact a real inference provider. Local tests do not establish deployed ingress/workload logging, approved bank contents, serving capacity, permissions or apply history.

## Remaining decisions and operational checks

| Workstream | Completion evidence or unresolved decision |
| --- | --- |
| US staging with Bjoern | Infra through #131 applied. Bootstrap, migrations/runtime grants, canary, TLS and missing/invalid-token rejection passed. Allowed-caller match/miss, wrong-audience rejection, real-bank readiness and actual Worker credentials/path remain activation checks. Coop activation is separate. |
| Bank operations | Approved access, compatible algorithm/settings, import/freshness ownership and harmless match/no-match proof. Reporting credentials alone do not establish bank access. |
| Reporting construction | Approved identity and matcher provenance, actual NCMEC field mapping/payload builder, authenticated XSD and sandbox acceptance. Unknown fields stay unknown; IP hashes are not addresses and observed ingress IP is not verified uploader identity. |
| Daily operation | Durable scheduling and handling of incomplete runs/reconciliation. Daily operation groups by authenticated account/org; key creator, authenticated member and supplied end-user IDs remain distinct attribution. Preserve until the request's one-year anniversary. Use account/org report grouping by default. Retain the customer-supplied end-user ID as distinct metadata rather than inventing a verified individual identity. |
| Staff acceptance | Full authenticated browser proof of discovery, recovery, preservation and completed-report listing. Existing staff auth, API and ledger should own this; avoid another review application or synchronization job. |
| Account automation and notices | After reporting, enable automatic actions for personal accounts only, with an explicit TODO to revisit organizations. Require freemail AND cumulative billed inference usage below a configurable $2,500 threshold, plus investigation and protection checks. After those checks pass, act independently of reporting. Reuse Sentinel investigations and the shared PLA-1535 enforcement blocks when landed. For monthly notices, reuse all active org admins, falling back to an eligible org creator. Retain applicable key-creator, member and supplied end-user attribution. |
| Later EU activation | Regional serving/evidence validation and the content-free incident-delivery decision. EU logging, managed Prometheus and secret management need not be disabled solely because they are operational services. |
| Separate fail-closed transition | Operational confidence and a manual ramp, with an explicit decision on permanent coverage-gap behavior. |

Video, near/novel classification, known-hash media review and end-user enforcement are outside the current implementation scope. General legal screening/prohibition/reporting language was merged separately; this stack does not imply that Sam changed it or that operational reporting is complete.

## References

- [ROOST Coop documentation](https://roostorg.github.io/coop/latest/)
- [ROOST Coop source](https://github.com/roostorg/coop)
- [NCMEC CyberTipline API documentation](https://report.cybertip.org/ispws/documentation/index.html)
