# Phase 1 known-hash image workflow

> **Status:** architecture contract and local-integration target. The dual-region production topology (`us-central1`, `europe-west4`) is recorded in a separately linked infrastructure draft stack that remains dark and unapplied. Nothing here authorizes production deployment, evidence retention, reporting, or enforcement.

## Terminology

- **HMA** (Meta Hasher-Matcher-Actioner) is the detector. It computes PDQ and synchronously compares uploaded image bytes with configured known-hash banks over a private multipart lookup.
- **Coop** (ROOST) queues confirmed matches for restricted human review. It is never called for a clean image.
- Phase 1 performs **known-bank PDQ matching**, not cryptographic exact matching. The normal threshold is Hamming distance `<= 31`; only the harmless deterministic acceptance fixture is required to match at distance `0`.
- A match is a strong signal, not a legal conclusion, a report, or an account action.

## Non-goals

This stack does not implement or authorize synchronous pre-provider blocking, production evidence storage or retention, automated CyberTip submission, account bans or restrictions, database writes in an inference path, user or organization notices, a review-decision callback or policy engine, or near-match, novel-content, or video classification.

## Phase 1 contract

1. The fail-open observer receives bounded image bytes from the request path and schedules a fully caught, deadline-limited background task. Eligible images are processed sequentially inside that task; the observer never delays provider dispatch or changes inference behavior.
2. Three independent gates control the runtime: `KNOWN_CSAM_HMA_SCAN_ENABLED` for scanning, `KNOWN_CSAM_COOP_HANDOFF_ENABLED` for the default-region handoff, and `KNOWN_CSAM_COOP_EUROPE_HANDOFF_ENABLED` for the Europe handoff. Either handoff enabled while scanning is disabled is invalid configuration. Production defaults keep all three dark; HMA is dark-launched and measured first, in shadow, before any handoff is considered.
3. When scanning is enabled, the observer sends bytes to the same-region private HMA `POST /m/lookup` with multipart field `photo` and an explicit bank query. HMA never fetches caller-supplied URLs; remote-URL lookup is deliberately unsupported. A Europe observation never falls back to the default deployment.
4. Production ingress uses HTTPS to `*.trust.openrouter.ai` and validates a JWT for the exact regional audience and caller identity. Plaintext HTTP is accepted only for loopback hosts in local development.
5. The client validates HMA's dynamic response, parses string-valued distances, applies the configured threshold, and immediately reduces the result to match, no-match, or indeterminate. It exposes no hashes, bank content IDs, or raw records. A validated bank name and distance may cross only into restricted review metadata and never into logs, metrics, or errors.
6. Clean media is discarded. Indeterminate observations stay fail-open and are measured without being called clean.
7. When a match is confirmed and the same-region Coop handoff is enabled, an approved evidence component supplies a retrievable reference and the runtime creates a Coop review item. The payload carries the request-receipt occurrence time, never callback completion time. HMA's URL-hash allowlist must restrict Coop retrieval to one exact non-redirecting evidence origin. Local acceptance uses Coop's normal queue (`csam: false`); production CSAM/NCMEC routing is not configured.
8. Every match that enters Coop requires human review. A reviewer records a disposition; any policy outcome belongs to a separately approved downstream workflow.
9. Evidence, Coop state, reviewers, case data, delivery journals, and any reporting records stay in the originating region with no Europe-to-US failover. A legally mandated external transfer needs its own owner, legal basis, approved field set, and auditable delivery path.

```text
inference image bytes
  -> bounded, fail-open background observer
  -> private HMA multipart lookup
       -> no match: discard media; emit only aggregate outcome metrics
       -> match: create approved evidence reference
                 -> optional same-region Coop handoff
                 -> mandatory human review
```

## Benign local acceptance

The local runtime seeds an `OPENROUTER_TEST` HMA bank with a harmless fixture's PDQ value, waits for full index readiness, and asserts that the seeded fixture matches at distance `0` under the `<= 31` policy while an unrelated harmless fixture does not. With Coop handoff enabled, exactly one match creates one review item and the clean fixture creates none; with handoff disabled, matching completes without creating evidence or a review item; with scanning disabled, no matcher or Coop call occurs. A Coop failure must not erase the confirmed HMA match, and the registered background task must still fulfill. Acceptance verifies deterministic correlation, the request-receipt occurrence time, restricted bank and distance metadata, and `csam: false`, and that OpenRouter-owned errors, logs, and metrics contain no media, base64, request bodies, hashes, content IDs, bank names, distances, evidence URLs, credentials, authorization headers, raw HMA/Coop bodies, or HMA bank query strings.

No acceptance test may contain abuse material, call an unknown public URL, submit a production report, or mutate a real hash bank. Local acceptance does not prove the content of deployed workload, ingress, or access logs; capturing those during a benign production-shaped run remains an activation gate.

## Launch gaps

| Gap | Owner / approval | Status |
| --- | --- | --- |
| Regional topology, ingress, and network activation (DNS, certificates, JWT issuer/audience/caller policy, NetworkPolicy, reversible activation) | Platform, Security, T&S | Recorded in the dark infrastructure draft; no region may receive production traffic |
| Regional residency, backup, and failover controls | Legal, Privacy, Security, T&S | Not approved; Europe must not fail over to the US |
| Regional observability and logging (log-content prohibition, Europe-resident Cloud Logging, telemetry field allowlist and egress review) | Platform, Security, Privacy, T&S | Not approved; Europe activation blocked until proven |
| Egress policy and workload supply chain (destination allowlists, digest pins, provenance, SBOMs, rollback) | Platform, Security | Not implemented |
| Schema and index lifecycle (region-by-region migrations, HMA index rebuild ordering, restore tests) | Platform | Not implemented |
| Evidence preservation (match-only storage, exact-origin retrieval, retention, legal hold, deletion, access audit) | Security, Legal, Privacy, T&S | Not implemented; production handoff stays off. The brief's one-year retention proposal is unapproved |
| Durable review delivery (region-local journal/outbox, idempotency, retries, dead-letter, reconciliation) | Platform, T&S | Not implemented; Coop `noop` warehouse/analytics adapters and hourly Redis RDB snapshots are insufficient |
| Capacity, SLOs, and reconciliation alerts | Platform, T&S | Not implemented |
| Reviewer operations (Coop roles, access, queues, guidelines, calibration, escalation, wellness, staffing) | T&S | Not implemented |
| Review-decision return (authenticated ingest, allowed transitions, replay rejection, idempotency, audit) | Owning service, T&S | Not implemented |
| Authoritative identity and report enrichment from server-side sources; adversarial attribution tests | Engineering, T&S | Not implemented; caller payloads and headers never steer reporter identity, disposition, or report fields |
| Eligible population and coverage evidence (surfaces, model classes, aggregate eligible/scanned/skipped/indeterminate counts) | Product, Engineering, T&S | Not defined; observer metrics describe work presented to it, not population coverage |
| Partner commitment and launch governance (reconcile the brief's pre-provider language, acceptance criteria, approval history) | Product, Legal, T&S, partner owner | Unresolved; this stack is not pre-provider enforcement |
| Acceptable Use Policy, Terms, and privacy language for review and preservation | Legal, T&S | Not implemented |
| Hash-bank eligibility and operations (data-use approval, NCMEC credentials, imports, provenance, freshness, curator access) | Legal, T&S, bank owner | Only the harmless test bank is used locally; no production bank access |
| CyberTip responsibility (who reports, human approval, liaison, certification, retries, Europe-origin legal basis) | Legal, T&S | No credentials or automatic reporting authorized |
| Enforcement policy, future blocking contract, and notice policy | Product, Legal, T&S, Security, Support, API owners | Not implemented; no request is blocked, no account is changed, no notice is sent |
| Metadata retention and prior-report linking | Legal, Privacy, T&S | Not implemented; no hot-path database writes |
| Video coverage and near/novel follow-up | Product, T&S | Out of Phase 1 |

## References

- [ROOST Coop documentation](https://roostorg.github.io/coop/latest/)
- [ROOST Coop source](https://github.com/roostorg/coop)
