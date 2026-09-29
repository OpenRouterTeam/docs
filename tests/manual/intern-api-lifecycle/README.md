# Intern API lifecycle acceptance harness

Executable acceptance run for the full public intern API flow: create, retry-safe create checks, write a workspace-owned secret, an intern-owned secret and a borrowed source-vault secret, provision and poll, chat, write a disk marker, suspend and poll, provision/resume and poll, read the marker back, chat again, delete, post-delete checks. It is a manual harness, not part of CI: it creates and destroys a real intern and costs real provisioning time.

Run it with `bun tests/manual/intern-api-lifecycle/run.ts`. It always writes a JSON report, and it exits zero only when every required step recorded a pass. A run whose required steps were skipped or whose routes were missing exits non-zero as `incomplete`, which is what keeps an untested flow from reading as a green run.

## Ownership

Every file here belongs to this harness. It calls the public API over HTTP only, so it shares no implementation file with the ORI-1875 lifecycle routes or the vault routes. When a route path or status name changes, the change lands in `contract.ts` and nowhere else in this directory.

## Environment

| Variable | Required | Meaning |
| --- | --- | --- |
| `INTERN_API_BASE_URL` | yes | Base URL of the intern API, for example `https://<nonprod-host>`. Recorded in the report with userinfo and query string stripped. |
| `INTERN_API_KEY` | yes | Sacrificial API key inside the interns programme. The run creates, mutates and deletes resources with it. |
| `INTERN_ACCEPTANCE_WORKSPACE_ID` | yes | Workspace the intern is created in. Must be a sacrificial workspace. |
| `INTERN_ACCEPTANCE_ENVIRONMENT` | yes | `real-vm` or `local-container`. It labels the evidence class of every VM-state step and nothing else. |
| `INTERN_ACCEPTANCE_SOURCE_INTERN_ID` | no | An existing source-owner intern the borrower attaches to. Its own vault holds the borrowed secret. When it is unset the run creates its own source owner under a separate idempotency key and deletes it at the end; when it is set the run seeds a secret in it and leaves the intern itself alone. |
| `INTERN_ACCEPTANCE_VM_FILE_READ_COMMAND` | no | Command that reads one file off the intern instance, with `{internId}` and `{path}` substituted. Required for `real-vm` evidence: without it the disk-marker steps record as `unsupported` and the run is incomplete. |
| `INTERN_ACCEPTANCE_VM_FILE_READ_TIMEOUT_MS` | no | Budget for that command, default 120000. |
| `INTERN_ACCEPTANCE_CONTROLLED_HOST` | no | Host the intern is asked to call so the runtime's own secret injection can be observed. Operator-supplied, because the injection happens inside the runtime on the egress path and no public route projects the attached namespace. |
| `INTERN_ACCEPTANCE_CONTROLLED_HOST_PORT` | no | Loopback port the tunnel fronting that hostname forwards to. The run starts the receiver on it itself, once the borrower exists and every phase correlation is known, because the receiver reads its expectations only at startup. Without both variables the borrowed-runtime step stays incomplete. |
| `INTERN_ACCEPTANCE_OTHER_WORKSPACE_ID` | no | Second workspace used to check that the same idempotency key cannot be replayed across workspaces. Without it that step records as `skipped`. |
| `INTERN_ACCEPTANCE_POLL_INTERVAL_MS` | no | Poll interval, default 5000. |
| `INTERN_ACCEPTANCE_POLL_TIMEOUT_MS` | no | Poll budget per lifecycle transition, default 600000. A poll that runs out is a failure, never a pass. |
| `INTERN_ACCEPTANCE_MODEL` | no | Model slug for the chat turns. Defaults to `openrouter/intern`. |
| `INTERN_ACCEPTANCE_REPORT_DIR` | no | Where the JSON report is written. Defaults to `./.acceptance-runs`. |
| `INTERN_ACCEPTANCE_WEB_REVISION` | no | Web commit under test, recorded in the report. |
| `INTERN_ACCEPTANCE_RUNTIME_REVISION` | no | ORI runtime commit under test, recorded in the report. |
| `INTERN_ACCEPTANCE_RUNTIME_IMAGE` | no | Runtime image tag or digest the target is actually running. |

The API key is read from the environment and sent as a bearer token. It is never written to the report, and neither are request bodies, response headers or secret values.

## Authorization boundary

The key must authorize the workspace named in `INTERN_ACCEPTANCE_WORKSPACE_ID`. The harness does not test cross-workspace refusal with a second key, so a run says nothing about whether another workspace could have reached these resources.

## Retry-safe creation

The run sends three create requests and expects three different outcomes.

1. The first create, with `Idempotency-Key: intern-acceptance-<runId>`, creates the intern.
2. The second sends the identical key and the identical canonical body. It must replay the first intern, with the same ID and no second intern created.
3. The third sends the same key with a changed name. It must be refused with 409, because the stored request hash no longer matches.

The canonical body is the request object serialized with its keys sorted, so field order cannot change the hash. The harness computes the hash only to record it; the server computes its own.

A source owner the run creates for itself uses its own scoped key, `intern-acceptance-<runId>-source-owner`, so creating it cannot replay or collide with the borrower's create.

Unverified at the time of writing: only the database layer of retry-safe creation exists on the lifecycle branch, so the header name, the refusal status and whether the route derives the hash itself are taken from the database contract and its integration tests, not from a registered HTTP route. The first run against the combined branches settles them, and any step whose route is missing is recorded as `unsupported` rather than failed.

## Vault behavior

Three scopes are exercised separately, because the contract distinguishes them and an earlier version of this harness conflated two of them.

1. **Workspace-owned.** Written through the workspace secret route. It belongs to the workspace and has to outlive the intern.
2. **Intern-owned.** Written into the intern's own vault through the intern secret route. It is destroyed with the intern.
3. **Borrowed.** Owned by a source-owner intern's own vault. The source owner writes the run-unique secret through its own intern-secret route, the borrower is created with that vault as its source attachment, and nothing is ever copied into the borrower's vault. Destroying the borrower closes the grant and must leave the secret in its source, with the fingerprint it was seeded with.

Two things a harness cannot do here, and the run does not pretend otherwise. The copy route's request schema accepts names only, so a source vault id cannot be passed to it, and copying would test copying rather than borrowing. The secret listing is scoped to the caller's workspace and agent, so no reachable read resolves the attached namespace: that merge happens inside the vault worker's secret store on the egress-injection path, for a request the intern itself makes to a bound host.

Borrowed access is therefore checked through the injection path itself rather than through a route added for the harness, and it runs only after the lifecycle has polled the borrower to `running`, since nothing injects for an intern that is not up. The run asks the intern to call `INTERN_ACCEPTANCE_CONTROLLED_HOST` carrying the vault's own placeholder token for the seeded secret in an `Authorization` header, which is what selects that secret on the egress path: a request without a placeholder is never injected into, so calling the host alone would prove nothing. The seeded secret is bound to that host for the same reason.

The receiver is a Tilt-only loopback server fronted by the existing tunnel launcher, and it compares rather than reports. Its config is fixed at startup, so the run creates the borrower first, derives every phase correlation from that borrower and this run, and only then starts the receiver on `INTERN_ACCEPTANCE_CONTROLLED_HOST_PORT` with all of them configured, each carrying the secret name and the SHA-256 digest of the throwaway value, never the value. The correlation names one borrower in one run and one phase, so a later phase against the same host cannot be satisfied by an earlier phase's request. The receiver holds 32 of them, and a thirty-third is refused rather than displacing an earlier phase. The intern's request goes to `/acceptance/<correlation>`, and the run reads back `{ correlation, received, secretName, valueMatches, requestCount }` over loopback. No raw value and no digest cross that boundary. The prompt asks for one request, so the step passes only on the exact correlation and secret name with `received` and `valueMatches` true and exactly one request counted. These are operator-supplied fixtures, so the evidence class of this step follows `INTERN_ACCEPTANCE_ENVIRONMENT` and is fixture-grade outside a real-VM target. With either variable unset the step records the missing seam and the run is incomplete, and the step is not complete until an intern runtime has actually requested that host and the injected secret was observed there.

The create response has to name both vaults: the vault the intern owns and the vault it borrows from. That step is its own required step, so a build that does not yet expose those fields records `unsupported` and the run is incomplete rather than passing.

Every listing is checked as raw JSON before it is parsed, because the projection schema strips unknown keys and would otherwise hide a leaked `value`, `secret` or `plaintext` field. Listings are also required to return the expected status and to decode: an HTTP 500 or a truncated body fails the step instead of decoding as an empty vault, which is what would otherwise let a broken vault read as a clean one. Requested hosts are asserted on write.

A fingerprint is a keyed HMAC over the value under the vault's own data key, so no expected literal holds across vaults: this run creates a fresh borrower vault with its own key, and an environment-wide expected value would be wrong rather than strict. The run therefore checks behaviour within one vault. It writes the same throwaway value under two names and a different value under a third, and requires the first two to match and the third to differ. No operator extracts a vault key for this harness.

That is behavioural evidence and nothing more. Exactness of the construction is a separate, fixed-key test, the RFC 4231 vector in `packages/helpers/vault-fingerprint.test.ts`, and the report labels the two kinds of evidence separately rather than merging them into one claim.

Secret values never enter the report. Only names, hosts and fingerprints do.

## Lifecycle polling

Polling reads the intern on the configured interval until the configured budget runs out, and stops on the wanted status or on any other settled status (`running`, `stopped`, `failed`, `destroy_failed`, `awaiting_slack_install`). `queued` and `provisioning` are in-progress states and never terminate a poll. The report records the observed status sequence, so a run that reached `failed` instead of `running` shows how it got there rather than only that it timed out.

Deletion is polled the same way and is the one case where a 404 is the wanted answer. The run accepts the delete, observes `destroying` as transitional only, and keeps polling until the resource is absent. `destroy_failed`, a still-live status at the end of the budget, and a poll timeout are each explicit failures. A 404 counts as absence only for a route that already answered as itself earlier in the run, so a provisional route that was never registered cannot be mistaken for a deleted intern.

## Chat validation

Each chat turn asks the intern to echo a token unique to this run and this phase. The turn passes only when the stream returns 200, the content contains that token, a `session_id` is present and the stream ends with `[DONE]`. A reply that does not carry the token is treated as a failure, which is what stops a pre-seeded intern's answer from being read as proof of this run's flow.

## Suspend and resume

Suspend is expected to move the intern to `stopped`, and the following provision call to bring it back to `running`. Before suspending, the run asks the intern to write a unique non-secret marker to a file in its home directory, and after resuming it asks for that file back and compares the contents. The marker is derived from the run id, so a stale file from an earlier run does not satisfy it.

The write goes through chat, because that is the only public interface the intern exposes, and the intern's reply is recorded as an acknowledgement step of its own. The acknowledgement is not the evidence. The marker steps read the file back off the instance with `INTERN_ACCEPTANCE_VM_FILE_READ_COMMAND`, once before suspend and once after resume, and compare the contents exactly. Without that command configured both marker steps record `unsupported` and the run is incomplete, so a chat reply can never stand in for a disk read.

Reading a file off an intern instance is not something this harness can arrange for itself. Interns have no external address, and the session identity holds neither IAP nor instance-admin permission, so the command is supplied by an operator, for example a tunnelled SSH into the instance carrying the run's `intern-id` label.

The report records the intern's observed hostname and status sequence separately from `INTERN_ACCEPTANCE_ENVIRONMENT`, because the variable is a label the operator supplies and the statuses are what the run actually saw. Under `local-container` the intern is a container, so suspend and resume results are fixture-grade and must not be reported as VM suspend/resume evidence.

A marker step passes only when the file matched exactly and the run also identified the instance it came from, so a read against an unobserved host is a failure rather than a pass.

## Real nonproduction requirements for VM suspend and resume

A run that can support a real suspend/resume claim needs all of the following.

- A nonproduction deployment whose provisioner creates GCE instances, not local containers.
- A service account with create, stop, start, inspect and delete permission on those instances, in a project separate from production.
- The provisioner and tunnel dependencies reachable from that deployment, since chat after resume goes through the tunnel.
- A sacrificial workspace and a sacrificial API key scoped to it.
- A configured secret vault in that environment, since the vault steps write and read real secrets.
- Authority and a procedure to delete orphaned instances, because a failed run can leave one behind.
- Sanitized logging, so the run's evidence can be attached without redaction work afterwards.

## Local Tilt target

The intended path for combined API, vault and runtime acceptance is the existing stack, `tilt up -- --interns`. It already brings up `intern-api`, the local intern daemon, the vault sidecar with its egress CA and the egress checks, which is every dependency the create, secret, chat, borrowed-secret and controlled-host steps need.

What that stack did not have is the lifecycle half. `intern-api` mounts only the chat completion route under `/api/v1/interns`, so create, provision, suspend, resume and delete have no HTTP route to call there yet, and the one resource that does drive VM lifecycle, `intern-provisioner`, runs against real GCP credentials and is manual-trigger for that reason. Nothing in this harness triggers it.

The stack now carries the container half of that gap as its own resource, `intern-lifecycle-fixture`. It runs the provisioner worker's `e2e` environment, whose upstreams are all loopback, with the Compute verbs performed on containers by `local-fixture/`. It is manual and off by default, because it needs Docker and creates containers, and its worker and stub take ports of their own so neither collides with `internal` or `frontend-api`. Start it from the Tilt UI, and point the enqueue callers at it for the length of a run by setting `INTERN_PROVISIONER_TARGET=lifecycle-fixture` before `tilt up -- --interns`, which moves `INTERN_PROVISIONER_URL` on `frontend-api` and `internal` to the fixture worker and leaves `intern-provisioner` untouched.

What remains missing is the routing half, which belongs with the lifecycle branch: the lifecycle routes registered on `intern-api`. Until they exist a Tilt run exercises the API, vault and runtime steps and records the lifecycle steps as unsupported, which keeps the run incomplete. Container suspend and resume is fixture-grade evidence and does not support a VM suspend and resume claim.

## Local lifecycle fixture

`local-fixture/` answers the Compute REST surface the provisioner already speaks and performs each verb on a container. Instance insert creates a container of its own on a named volume mounted at `/workspace` and publishes a host port for it, stop and start suspend and resume that container while the volume stays attached, reset restarts it, delete removes both the container and the volume, and instance get reports the container's own state as `RUNNING` or `TERMINATED`. Operations carry the caller's `requestId` back as `clientOperationId` and are listable per zone, so the provisioner's durable-command recovery adopts an operation it already issued rather than issuing a verb twice.

Nothing about the public path is simulated. The routes, the database rows, the ownership claim, the workflow and the vault attachment all run as they do in production; only the cloud endpoint is replaced, which is what makes lifecycle actions operate on a real per-borrower runtime with persistent storage instead of on the one seeded daemon.

Two ways to run it. Inside Tilt, start the `intern-lifecycle-fixture` resource, which boots the provisioner worker and the container adapter together. Under `--interns` it has one host prerequisite: the provisioner worker runs on the host and dials the local vault edge as `host.docker.internal`, the one authority the edge's `Host` guard accepts, and Docker resolves that name inside containers only. Add `127.0.0.1 host.docker.internal` to `/etc/hosts` once. The resource checks this at start and fails with that line when it is missing, because without it provision fails after the borrower's container already exists. Standalone, run `bun run tests/manual/intern-api-lifecycle/local-fixture/serve.ts` with `INTERN_FIXTURE_RUNTIME_IMAGE` set to the runtime image the stack already pulls, then point a provisioner at it by setting `GCP_COMPUTE_API_BASE_URL` to the printed origin and using a service account JSON whose `token_uri` is that origin's `/oauth2/token`. Either way the fixture mints its own token, so no credential takes part, and the GCP-capable `intern-provisioner` resource is never triggered against a real project.

Two pieces are still open and belong with lifecycle rather than in this directory. Dialling a borrower needs `intern-api` to resolve each intern's runtime origin from its own lifecycle metadata, because the `--interns` daemon override currently sends every intern's chat to the one seeded daemon, and the fixture's published port per instance is what that resolution would read. A borrower's vault identity likewise needs the sidecar minted per borrower rather than from the seeded identity. Until both land, borrowed egress observed at a controlled host and same-org cross-workspace denial are checked against the seeded runtime, which is weaker evidence than a per-borrower runtime and is recorded as such.

## Readiness of the paused GCP candidate target

Separate GCP test-project preparation is paused in favour of the Tilt path. This section is kept as the record of what was checked, and none of it is scheduled work.

No approved nonproduction target exists yet, so the real-VM run stays blocked. This section records what was checked, what is unknown, and what only an operator can do.

**Checked.** The dev provisioner credentials resolve to the project that runs the live intern fleet, and that project currently carries running customer interns, so it is not an acceptance target. No usable nonproduction target was found anywhere in the accessible dev setup. The candidate project `interns-test-508616` exists and the Compute Engine API is currently disabled on it, so it cannot run an instance as it stands. That observation is about the project's state now and establishes neither its history nor the absence of network resources in it. The session identity can read instances and nothing else: create, start, stop, delete and metadata mutation are all refused.

**Unknown.** Staging and production provisioner configuration could not be inspected at all, because the secret read returned 403. Whether either already has a usable isolated target is unknown rather than disproven.

**Operator-only preparation for `interns-test-508616`.** Every item below requires permissions this session does not hold, and none of it is authorized by the readiness check itself.

1. Enable the Compute Engine API and confirm regional quota for the zone the provisioner defaults to.
2. Create or confirm the `interns` VPC.
3. Create or confirm the regional `interns-<region>` subnet.
4. Create or confirm Cloud NAT and the egress the runtime needs.
5. Create or confirm firewall rules, including tunnel ingress and break-glass administrative access.
6. Confirm Private Google Access where the runtime depends on it.
7. Create a provisioner service account scoped to this project alone, with instance lifecycle, impersonation, logging, storage, tunnel and cleanup permissions and nothing else.
8. Create or confirm the per-VM runtime service account and its bindings.
9. Configure a separate provisioner secret path for that account, without exposing the credential.
10. Configure worker bindings for the API, daemon, vault, tunnel and runtime dependencies of that deployment.
11. Provision an isolated workspace and vault for the harness identity, so borrowed-vault cleanup cannot touch shared data.
12. Confirm the source-owner fixture identity and the borrower's source attachment in that workspace.
13. Confirm the runtime image, egress, tunnel and the marker write and read path end to end on one throwaway instance.
14. Grant cleanup authority over instances, disks, DNS records, vaults, attachments and grants, including orphans from a failed run.
15. Confirm the harness identity can observe instance identity and state while the provisioner identity mutates lifecycle, since the run asserts both.

Acceptance stays blocked until that target exists and is explicitly approved. Running it against the shared dev project is not a substitute and is not authorized.

## Outcomes and evidence classes

Every step records one of four outcomes. `passed` and `failed` are what they say. `unsupported` means the route is not registered on the target build, which is a missing surface rather than a failed assertion. `skipped` means a precondition did not hold, so the step never ran, and the report says which precondition.

The run status is `failed` when any step failed, `incomplete` when no step failed but some required step never passed, and `passed` only when every required step passed. Both `failed` and `incomplete` exit non-zero.

Every step also records one of three evidence classes. `real-vm` means the step observed GCE-backed state. `fixture` means the same step ran against the container stack and proves the API contract only. `not-vm-bound` means the step's result does not depend on VM state at all, which covers the create, retry and vault steps.

## Cleanup

Cleanup runs for everything the run created, on failure as well as on success, and its result is a required step of its own rather than a line in a report written on the way out. A borrower that was never confirmed deleted is deleted again, a source owner the run created is deleted and polled to confirmed absence under its own step name, and a source owner that was supplied keeps its intern while the secret this run seeded into it is removed. Anything cleanup could not complete is recorded as a failed step naming what was left behind, so a leaked resource cannot be silent.

`real-vm` evidence maps to a target whose provisioner creates GCE instances, and `local-container` maps to `fixture` for every step whose result depends on VM state. A step that never depended on VM state stays `not-vm-bound` in either environment.

## Mutation testing

Not measured (draft).
