# Worker-enforced HIPAA writes with MC Google OIDC

## Trust boundary

Mission Control checks `hipaa-admins@openrouter.ai` membership server-side using its attached Cloud Run identity. This is the group's email address, not its display name or the MC service-account email. Only after that check succeeds does MC obtain a Google OIDC identity token for the worker's audience and make the server-to-server request. No downloaded Google service-account key or IAM `signJwt` call is used.

The worker remains the write boundary. It requires the service admin key, independently authenticates the person with Clerk and the existing Postgres internal-admin gate, verifies the Google OIDC identity of MC, checks the action and target, re-reads the person's verified primary email from Clerk, and rejects a mismatch with MC's supplied subject. Organization and personal entitlement grants enter `src/hipaa-management/grant.ts`; endpoint eligibility changes enter `src/hipaa-management/endpoint-eligibility.ts`. Both modules check the request deadline immediately before persistence.

**Google OIDC authenticates MC, not the person's group membership.** The worker trusts the authenticated MC backend to have performed the group check. The subject/action/target fields are not custom signed JWT claims; they are metadata on a private, authenticated server-to-server request over TLS. MC must derive them server-side, never forward browser-provided permission or identity fields. The MC identity token must never be returned to the browser, logged, or persisted in KV.

## Request contract

All paths below are under `/api/v1/internal`.

| Operation | Behavior |
| --- | --- |
| `GET /org-hipaa/capabilities` | Authenticated MC request for the viewer, with no target. Returns `{ "data": { "can_grant_hipaa": true } }` or `false` based on the worker's checks. All responses use `Cache-Control: no-store`. If MC's own group check denies access, its server action returns an advisory `false` without calling this endpoint. |
| `POST /org-hipaa/enable` | Authenticated MC enable request. Preserves the non-expiring, idempotent, existing-note-preserving mutation and posture response. |
| `POST /user-entitlements` with `feature: "hipaa"` | Authenticated MC grant request. Preserves explicit expiry/note upsert semantics. The required compatibility field `granted_by` is ignored; the verified Clerk employee is persisted and logged. |
| `POST /org-hipaa/endpoint-eligibility` | Authenticated MC request with a strict body containing `endpoint_id` (UUID) and `is_hipaa_eligible` (boolean). Both enabling and disabling require the `set-endpoint-eligibility` action and matching endpoint target. Returns previous/current eligibility and endpoint identifiers; attributes the write to the verified Clerk employee. |
| Other generic grants, reads and manual revokes | Existing admin authorization and persistence. No Google OIDC token or HIPAA group check is added to these paths. The non-HIPAA writer rejects HIPAA at runtime. |

HIPAA requests carry:

| Header | Value |
| --- | --- |
| `x-openrouter-admin-key` | Existing service admin key. An explicitly present invalid/empty header never falls back to the legacy bearer path. |
| `Authorization` | `Bearer` Clerk session token or personal employee API key; retained separately from Google identity. Ambient cookies and organization-owned Clerk keys do not establish employee identity. |
| `x-openrouter-mc-identity-token` | Google-issued OIDC identity token authenticating `mission-control-worker@openrouter-core.iam.gserviceaccount.com`. |
| `x-openrouter-hipaa-subject-email` | The normalized, verified primary email resolved server-side from the signed-in person. The worker independently resolves and compares it. |
| `x-openrouter-hipaa-action` | `capabilities`, `enable`, `grant`, or `set-endpoint-eligibility`; must match the route operation. |
| `x-openrouter-hipaa-target` | The target `clerk_user_id` for `enable`/`grant`, or the `endpoint_id` UUID for `set-endpoint-eligibility`; must match the validated body. Omitted for capabilities. |

The audience is `urn:openrouter:hipaa-mc:v1:<OR_ENV>`, using each deployment's `production`, `staging`, `development`, or `test` environment. MC and the worker must agree. The worker reuses `verifyGoogleOidcToken`, pinning Google's issuer and RS256 keys, requiring expiry, checking the audience and allowlisting the exact MC service-account email. The shared verifier's standard clock-skew tolerance applies.

Audience strings alone do not isolate workloads that share a service account: the metadata service can mint tokens for a requested audience. Do not attach the production MC service account to untrusted development or preview workloads. Before introducing a separate non-production MC deployment, give it a separate identity and review the corresponding worker allowlist. Every workload holding the currently allowlisted identity is inside this service-auth trust boundary.

Invalid/missing MC or Clerk credentials are rejected. Authenticated non-staff people receive 404. Subject/action/target mismatches receive 403. Worker deadline expiry is 408. MC group/metadata lookup failures return errors, never permission. A missing or invalid employee primary email cannot authorize a HIPAA write. The existing deployment-based local-development bypass remains; requests cannot turn it on, and it does not bypass lifetime safety.

## Keyless Google access and retired configuration

MC's existing `utils/helpers/google-group-membership.ts` obtains an OAuth access token from the Cloud Run metadata `/token` endpoint and queries Cloud Identity. `features/hipaa-management/worker-authorization.ts` then obtains a plaintext ID token from the metadata `/identity` endpoint using the worker audience. Tokens remain inside the server-to-server path. This does not require exporting the service account's private key or granting IAM `signJwt` permission.

`HIPAA_GROUP_READER_CREDENTIALS_JSON` and the worker's old private-key token exchange and membership cache are removed. MC checks membership for every attempted HIPAA write; Google's own membership propagation delay still applies. An OIDC token's lifetime is not a cached group-membership lease.

The now-unused `KV_HIPAA_MEMBERSHIP` binding is removed from the worker configuration. **The actual namespace `a648e458e4104563b0977a3e72249e48` is not deleted by this change.** Any later resource cleanup is a separate approved infrastructure operation. The request-deadline and bounded Google-fetch infrastructure remain in use for worker verification.

## Deadlines and ambiguous outcomes

The worker installs one absolute 10-second deadline before body validation and employee authentication. Google OIDC verification uses the bounded Google fetch transport; late verification or Clerk results cannot start a new write. The final deadline check has no intervening awaited preparation before the database operation. MC's preceding group and metadata calls have their own request limits; the worker's 10 seconds is not the entire MC server-action duration.

A timeout does not roll back a database transaction that already started. If a write began in time, it may finish after the caller sees 408 or loses the connection. Refetch authoritative posture, entitlements, or endpoint eligibility as appropriate before retrying; do not automatically resubmit or claim no write happened solely because the response timed out.

## Rollout and verification

Local tests exercise real signatures, worker handlers, Postgres and rejection behavior with external Google/Clerk responses substituted. They do not prove the deployed service account's permissions or the Cloud Run metadata path. Implementation assumes the service-account holder configured Groups Reader as requested; live GCP verification remains explicitly outstanding.

1. Confirm MC is deployed on Cloud Run with `mission-control-worker@openrouter-core.iam.gserviceaccount.com` attached, and that this identity can read the HIPAA group. No private-key secret is required.
1. Confirm MC and the worker use the same intended `OR_ENV` audience and retain the existing Clerk/admin-key configuration. Use the normal TLS-protected internal worker origin.
1. Deploy worker enforcement, then the MC client promptly. Old HIPAA clients without MC OIDC metadata fail closed; unrelated grants, reads and revokes remain unchanged. HIPAA is not live, so this prelaunch transition is intentional—not an admin-only fallback.
1. On the GCP-hosted MC environment, verify a group member can enable an isolated test entity, a non-member cannot, and Google/metadata failure prevents a write. Verify persisted actor/state after reloading. Never use a production customer for one-way enable testing.
1. Verify direct worker requests with missing/invalid MC tokens, wrong audience/account, expired tokens, and subject/action/target mismatches are rejected. Browser recordings and this live identity check remain separate from passing local tests.

```bash
bun test packages/helpers/auth/hipaa-management-contract.test.ts packages/helpers/auth/hipaa-mc-authorization.test.ts
cd packages/oidc && bun run test
cd ../../services/cfw-internal
bun test src/hipaa-management src/middlewares/request-deadline.test.ts src/middlewares/clerk-employee-auth.test.ts
bun run test:integration integration/org-hipaa integration/user-entitlements
```

The dedicated action and Google-helper tests in `projects/mission-control` cover group denial, upstream failures, server-derived subjects, token non-disclosure, and the preserved non-HIPAA/revoke paths. A local laptop does not acquire the deployed MC service identity by running the app; local fixtures are not evidence of live IAM access.

## History

This replaces the downloaded-key credential path introduced by #42473 while retaining worker enforcement in #42267 and MC integration in #42336. The earlier #41475 requirement placed the security boundary in the worker; that requirement is retained. No cloud resource, service account, IAM grant, or deployed credential was created or deleted by this code change.
