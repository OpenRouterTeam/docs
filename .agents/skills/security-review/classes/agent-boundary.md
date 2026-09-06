# Agent Boundary Review

This class applies when a change:

- Interpolates text from outside the platform (CRM fields, repository
  content, applicant submissions, tool or model output) into a prompt for a
  model or agent that runs with platform credentials or internal data access.
- Adds or changes anything under `services/cfw-secret-vault` or
  `services/cfw-intern-provisioner`, or the enqueue signature in
  `packages/helpers/intern-enqueue-signature.ts`.
- Decides which secrets, tools, or data an agent runtime, a skill it loads, an
  MCP server it connects, or a subprocess it spawns may reach.
- Gates an agent's request on an allowlist the request itself selects from
  (a destination host, a statement class, a placeholder name) rather than on
  a binding the operator made when the resource was provisioned.
- Mints, derives, or shares a platform identity (a service account, an API
  key, a signing token) across more than one tenant's agent.

## Rule

**Authority inside an agent context is bound by the operator at provisioning
time, never by the content the agent reads or the request the agent makes.**
The authorization class scopes a query to a caller the platform
authenticated; here the caller is an agent the platform itself provisioned,
so its identity proves nothing about what it should reach. Everything that
enters the context is data, and everything it asks for is checked against
what was bound to it, not against what it names.

## Failure modes to reject

### Outside text enters the prompt as prose

A prompt builder concatenated CRM free text into the instructions of a Devin
session that held the platform Devin key and internal ClickHouse and HubSpot
access, so whoever wrote the CRM field wrote part of the agent's
instructions (SEC-226, PR
[#36587](https://github.com/OpenRouterTeam/openrouter-web/pull/36587)). That
feature has since been removed (PR
[#40488](https://github.com/OpenRouterTeam/openrouter-web/pull/40488)), so
its fix is not in-repo evidence.

The accepted remedy serializes outside text as data inside a delimited,
labeled block, neutralizes anything that could pass for the delimiter, and
tells the model in trusted prose that the block is data. Evidence:
`neutralizeFenceMarkers` and `sanitizeInline` in
`services/cfw-synapse/src/uses/review/untrusted.ts`, applied to every
`--- BEGIN UNTRUSTED ... ---` fence in
`services/cfw-synapse/src/uses/review/prompt.ts`, and the
`PROMPT-INJECTION GUARDRAIL` note in
`packages/startups/submission-handler.ts`. A prompt builder that joins
outside text into its own instruction lines, or a second builder that
reimplements the fence without the neutralizer, is the finding. The block
does not make the text safe; it keeps the text from becoming instructions.

### The agent names the destination, the platform credential follows

The vault resolved secret placeholders for any destination host the agent
named, so an agent could send `Authorization: __name__` to a host it
controlled and read the resolved secret (SEC-287). A shared ClickHouse skill
bounded an intern's queries by statement class alone, so a prompt-injected
intern could run unbounded reads, protected-table reads, and outbound table
functions (SEC-309).

Neither has an accepted in-repo remedy yet. Current-branch evidence of the
open shape: the Mode 2 comment in
`services/cfw-secret-vault/src/routes/resolve.ts` and its counterpart in
`services/cfw-secret-vault/src/container/outbound-handler.ts` record that the
route-level `isInjectableDestination` gate does not hold system-wide and that
per-secret destination binding is the fix. The proposed remedy is the same in
both incidents: bind the resource to its permitted destinations, tables, or
functions when the operator writes it, and check the agent's request against
that binding. A gate keyed on something the agent supplies is a routing
decision, not an authorization one.

### Tenants share one platform identity

Every intern VM ran under one GCP service account with Compute Engine API
access, so a VM could read the instance metadata, and with it the Slack
credentials, of another tenant's VM (SEC-288, PR
[#38933](https://github.com/OpenRouterTeam/openrouter-web/pull/38933)).
Intern API keys derived deterministically from the BYOK master key, so
possession of the derivation and the master key yielded every tenant's key
(SEC-294).

The accepted remedy removes the cross-tenant permission from the shared
identity and strips bootstrap secrets from the instance once consumed.
Evidence: `stripInstanceMetadataKeys` and `PARTIAL_FAILURE_METADATA_KEYS` in
`services/cfw-intern-provisioner/src/clients/gcp/gcp-instance-metadata-strip.ts`,
and the IAM bindings in `services/cfw-intern-provisioner/infra/iam.tf`. A
permission added to the shared identity that reaches another tenant's
resource, or a per-tenant credential derived rather than generated, is the
finding. SEC-294 has no in-repo remedy yet.

### Secrets are forwarded to a sub-context with no declared need

The intern runtime forwarded eight secrets to every Claude subprocess it
spawned, though no installed skill read them, so any injected instruction
inside the subprocess had them (SEC-310). No in-repo remedy yet. The
proposed remedy hands a subprocess, skill, or MCP server only the secrets its
manifest names; an environment spread into a child process is the finding.

### The control-plane peer is authenticated by fallback

The provisioner's enqueue endpoint accepted a request whose HMAC signature
was missing, expired, or wrong by falling through to a shared-secret check,
so a caller holding the legacy secret bypassed the signature entirely
(SEC-269). Current-branch evidence of the open shape: `authenticateEnqueue`
in `services/cfw-intern-provisioner/src/http/enqueue-auth.ts`, whose docblock
records the fall-through as a rollout posture. The accepted shape is that a
failed strong check rejects, and a legacy branch exists only with a named
removal condition in the same change. A fallback taken on verification
failure, rather than on the absence of the stronger credential's
configuration, is the finding.

## What the primitives do not give you

A delimited data block bounds instruction injection; it does not make the
enclosed text safe to act on, and the model may still be persuaded by it. A
destination or table binding constrains what a compromised agent can reach;
it does not detect the compromise. Stripping bootstrap metadata protects
secrets after consumption, not during the window before the strip runs, and
it does not narrow what the shared identity can do elsewhere. None of these
primitives substitute for the authorization class's ownership predicate on
the platform side of the boundary: a vault route still scopes every read to
the authenticated agent and workspace.

## Test requirement

A prompt-assembly change ships a test in which an outside payload carrying
a fence-lookalike line and an instruction is proven to land inside the fence
as data; copy `services/cfw-synapse/src/uses/review/untrusted.test.ts`. A
vault or provisioner change that decides what an agent may reach ships a
denial test for a destination, tenant, or secret the agent did not earn; copy
`services/cfw-secret-vault/src/routes/resolve.test.ts` or
`services/cfw-intern-provisioner/src/clients/gcp/gcp-instance-metadata-strip.test.ts`.
Report a missing test as `TEST GAP`, never as a vulnerability finding.

## Calibration

Seven incidents as of 2026-09-05: SEC-226, SEC-269, SEC-287, SEC-288,
SEC-294, SEC-309, and SEC-310. Two are fixed in-repo (SEC-226, whose fix was
later removed with its feature, and SEC-288), two are in progress (SEC-309,
SEC-310), and three are open (SEC-269, SEC-287, SEC-294), so most of this
class's evidence is the open shape rather than the accepted remedy. Every
incident sat on the intern or internal-agent platform, and none was
reachable by an ordinary API user. The platform-credential class covers a
platform key acting on a caller-named object on a user-facing route; this
class covers the same trust error when the caller is an agent the platform
provisioned.
