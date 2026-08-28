# Platform Credential Review

This class applies when a change:

- Passes a caller-supplied identifier or object into a call made with a
  server-held credential whose authority spans all tenants: the platform
  Stripe secret key, `OPENROUTER_PROVISIONING_KEY`, or any vendor management
  API client constructed from server configuration.
- Passes caller-influenced input to a decrypt or sign operation performed
  with a platform-wide key such as `PROVIDER_ENCRYPTION_KEY`.
- Attaches an identity token the service mints for itself (a GCP ID token,
  an OIDC token, a signed header) to an outbound request whose destination
  derives from caller or operator input.
- Spreads or forwards a caller-supplied object into a vendor SDK call.
- Verifies a JWT or OIDC token minted by an external issuer, or changes the
  parameters of that verification.
- Adds or changes a Next.js API route handler (`app/api/**/route.ts`) that
  reaches such a credential.
- Passes a validated URL, host, or destination field across a serialization
  boundary (Temporal activity args, a queue payload, a Durable Object RPC)
  before a credential is attached to a request against it.

## Rule

**A platform credential must not lend the caller more authority than the
caller proved.** The ownership predicate of the authorization class cannot
apply here because there is no database query to scope: the object lives in
the vendor's system, so the binding between caller and object must be
established explicitly before the privileged call.

## Failure modes to reject

### The caller names the object, the platform key acts on it

`removePaymentMethodSA` detached whatever `pm_...` id the client sent using
the platform Stripe key. The wrapper resolved the caller's own Stripe
customer id, and the handler ignored it; Stripe's `detach` takes only the
payment-method id, so the platform key reached every customer (SEC-173, PR
[#31175](https://github.com/OpenRouterTeam/openrouter-web/pull/31175)).

The accepted remedy is retrieve-and-compare: fetch the object from the vendor
and require its owner field to equal the caller's resolved identity before
any write. Evidence: `verifyPaymentMethodOwnership` in
`services/cfw-frontend-api/src/routes/billing/payment-methods/route.ts`. Copy
two details: run the check before every side effect, database write included,
and collapse "not yours" and "does not exist" into one refusal so the
response is not an existence oracle. Ownership comes from the vendor's own
record, never from a tracked list in our database, which would turn tracking
state into an authorization input.

### The caller supplies the fields, the server spreads them

Stripe customer creation spread the entire client-supplied billing object
into `customers.create({ ...customerAddress, ... })`, so a hand-crafted
request could plant fields the form never sends, such as `tax_exempt` and a
negative `balance`. The update path in the same module already sanitized
through an allowlist; the create path did not (SEC-76, PR
[#29356](https://github.com/OpenRouterTeam/openrouter-web/pull/29356)).

The accepted remedy is an explicit field pick applied to every path that
reaches the vendor call, `pickPublicUpdateCustomerData` in
`packages/db/users/customer-utils.ts`, combined with runtime validation via
`withValidatedContextSA`. A compile-time input type is erased at runtime and
validates nothing. When one sibling path sanitizes and another spreads, the
spread is the finding.

### The caller supplies the ciphertext, the platform key decrypts it

A platform-wide encryption or signing key is a platform credential, and a
function that applies it to caller-influenced input is an oracle for it.
`mergeAzureKeysWithStored` accepted `storedCipher` and `storedNonce` straight
from its arguments, decrypted them with `PROVIDER_ENCRYPTION_KEY`, and
returned the plaintext `api_key` when a caller-supplied hash matched, and it
was reachable as an unauthenticated server action (PR
[#33965](https://github.com/OpenRouterTeam/openrouter-web/pull/33965)). The
accepted remedy removes the endpoint (a `server-only` module) and keeps the
key behind functions whose ciphertext inputs come only from rows the caller
already proved ownership of.

### The minted token follows the caller's destination

A token the service mints for itself lends the platform's identity to
whatever request carries it, so the destination must be pinned before the
token is attached. The Switchyard diversion path minted a GCP ID token for a
validated audience, then sent it to a destination rebuilt from an
operator-supplied path that had relocated the authority (PR
[#33966](https://github.com/OpenRouterTeam/openrouter-web/pull/33966)). The
accepted remedy asserts the final URL's origin equals the audience origin
before token acquisition; the URL-identity mechanics are the SSRF class's
rebuilt-URL failure mode.

### The token is accepted without pinning its algorithm and issuer

A minted token is a credential in the other direction too: a service that
verifies one decides, in the verify call, whose signature it will honour. A
`jwtVerify` without `algorithms` accepts whatever the token's header names, and
one without `issuer` accepts a correctly signed token from any issuer whose key
the JWKS endpoint serves (PR
[#34902](https://github.com/OpenRouterTeam/openrouter-web/pull/34902)).

The accepted remedy pins the algorithm list, the issuer, and the audience in
the same call, per RFC 8725. Evidence:
`packages/oidc/verify-google-oidc-token.ts:69-74`, whose pinned values are
module constants, and `packages/oidc/verify-vercel-oidc-token.ts:46-50`. Pin at
the verify call rather than only checking claims afterwards: a claim check runs
on a payload whose signature was already accepted under the attacker's chosen
algorithm.

### The constraint stayed on the far side of a serialization boundary

A schema on the producer's type is not a gate: once a validated value crosses
a serialization boundary as plain data, nothing on the consuming side has run
the validation. The benchmark workflow's `baseUrl` was Zod-constrained on
`BenchmarkChildWorkflowInputSchema`, but Temporal hands activity args over as
plain JSON without re-parsing, so the activity attached the shared
benchmarking key to whatever host the start request named (PR
[#35340](https://github.com/OpenRouterTeam/openrouter-web/pull/35340)).

The accepted remedy re-checks the value at the call site that attaches the
credential, sharing one allowlist predicate with the schema so the two cannot
drift. Evidence: `isAllowedBenchmarkBaseUrl` in
`packages/temporal/src/benchmark-base-url.ts` and `requireAllowedBaseUrl` in
`packages/temporal/src/activities/benchmark/run-benchmark.ts:129-142`. The
same skip already appeared without a serialization boundary: `classes/ssrf.md`
records a `saferURL().default()` whose default bypassed the refinement. The
URL-identity mechanics (lookalike hosts, embedded credentials, encoded hosts)
are the SSRF class's rebuilt-URL failure mode.

### The proxy authenticates but never authorizes

The demo-hub route handlers proxied the OpenRouter management API with the
server's provisioning key behind middleware that required only a Clerk
session, so any authenticated user could mint org-funded keys, manage
guardrails, and destroy workspaces (SEC-128, SEC-129, SEC-131, PR
[#31904](https://github.com/OpenRouterTeam/openrouter-web/pull/31904)).
Route handlers are not server actions: the `'use server'` wrapper convention
does not cover them, and middleware that admits any session is not a gate.

The accepted remedy is the shared internal-admin gate called first in every
handler method. Evidence: `requireInternalAdmin` in
`projects/mission-control/app/admin-utils/demo-hub/lib/requireInternalAdmin.ts`
and its use at the top of every method in
`projects/mission-control/app/api/demo-hub/demos/workspaces/route.ts`.

## What the primitives do not give you

Retrieve-and-compare proves ownership of one object for one call; it does not
constrain which fields a subsequent create or update sends, so the allowlist
is still required alongside it. The internal-admin gate proves privilege, not
ownership: an admin-gated proxy still forwards whatever object id the admin
supplies, which is acceptable only because the gate's population is trusted
with the whole credential. And none of these primitives limit blast radius at
the credential itself; a maximally scoped vendor key stays maximally scoped,
so prefer a narrower key when the vendor offers one.

## Test requirement

A change in scope ships a test in which a caller supplies another tenant's
vendor object id, or an unexpected extra field, and the vendor client is
proven not to have been called with it. A token-verification change ships
cases proving an unpinned algorithm and a foreign issuer are both rejected;
copy `packages/oidc/verify-google-oidc-token.test.ts`. For an admin-gated route
handler, add a non-admin denial test per method, copying
`projects/mission-control/app/admin-utils/demo-hub/lib/internalAdminGate.test.ts`.
Report a missing test as `TEST GAP`, never as a vulnerability finding.

## Calibration

Seven incidents as of 2026-08-14: SEC-76 and SEC-173 against the platform
Stripe key, SEC-128, SEC-129, and SEC-131 against the provisioning key, the
decryption oracle against the provider encryption key (PR
[#33965](https://github.com/OpenRouterTeam/openrouter-web/pull/33965)), and
the minted-token diversion (PR
[#33966](https://github.com/OpenRouterTeam/openrouter-web/pull/33966)). The
first five were reachable by any authenticated user, and the decryption
oracle by an unauthenticated one. The three provisioning-key incidents were
route handlers, which no `'use server'` signal covers, and the two Stripe
incidents were server actions whose auth wrapper passed: the wrapper proves
identity and role, and every one of these findings lived after that point,
in the binding between the caller and the vendor-side object or fields. The
two newest incidents show the credential need not be a vendor API key: any
secret whose authority spans tenants qualifies.
