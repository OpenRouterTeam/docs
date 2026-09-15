# cfw-intern-provisioner

Cloudflare Worker that drives the per-intern provisioning workflow.
One Workflow instance per intern. The HMAC-signed
`POST /api/v1/interns/enqueue` HTTP endpoint dispatches the
Workflow directly via `dispatchToWorkflow`
(see `src/workflow-dispatch-runtime.ts`) —
there is no internal Cloudflare Queue layer.

The worker is exposed via a Cloudflare Route on the shared
`openrouter.ai` zone at `openrouter.ai/api/v1/interns/*` (NOT a
dedicated subdomain). The route is attached manually in the
Cloudflare dashboard for the `intern-provisioner` worker —
`wrangler.toml` intentionally has no `[[routes]]` block, matching
the `cfw-api` convention. CF Routes do NOT strip the matched
prefix; the worker matches the full pathname literally.

## Slack app: minted + installed BEFORE enqueue (web tier)

Slack is optional per intern. When an intern links a Slack workspace,
the per-intern Slack app is **not** created inside this workflow; the
web tier mints it and gates VM creation on a completed OAuth install:

1. `POST /api/frontend/interns` creates the intern row
   (`status=awaiting_slack_install`) and immediately mints the
   per-intern Slack app via `apps.manifest.create`
   (`mint-slack-app.ts`). It does **not** enqueue provisioning.
2. The wizard's "Install in Slack" step runs the OAuth flow; the
   callback writes the real `bot_token` + signing secret onto the
   intern's `slack` credential and stamps `installed_at`.
3. Only then does the Review step call
   `POST /api/frontend/interns/{internId}/start-provisioning`,
   which is **hard-gated on `installed_at != null` + a present
   encrypted bot token** before it dispatches the enqueue.

By the time `enqueue` reaches this worker the real Slack tokens for
a Slack-linked intern are already in the DB — there is no
placeholder boot, no in-workflow `create-slack-app` step, and no
async resync (the retired #22702 path). `create-gcp-vm` bakes the
real tokens into the VM when the intern has a Slack app; an intern
created without a Slack workspace is born `queued` and boots without
Slack.

## Workflow

3 steps, mirrored onto `interns.status`:

1. `ensure-openrouter-api-key` — fetch-or-mint per-intern OR sk.
2. `create-cf-tunnel` — `cfd_tunnel` + DNS CNAME.
3. `create-gcp-vm` — GCE create instance. For an intern with a
   linked Slack app, reads the REAL
   `intern_slack_apps.bot_token_encrypted` (guaranteed present by
   the pre-enqueue install gate) and bakes the bot token + signing
   secret into `/etc/<bot>/env` and instance metadata; an intern
   created without a Slack workspace boots with no Slack env or
   token-sync timer. A linked credential whose token is somehow
   absent (install incomplete or revoked) fails loudly
   (`NonRetryableError`) rather than booting a half-configured VM.
   Then polls `/health` and flips status to `running`.

## VM runtime (Container-Optimized OS + Docker)

The intern runtime runs **entirely in Docker on Container-Optimized
OS (COS)** — there is no host-installed bun/ori/cloudflared and no
host `ori init` workspace. The VM boots
`projects/cos-cloud/global/images/family/cos-stable` (Docker +
containerd pre-installed, read-only rootfs, no `apt`/`python3`).

The startup script (`src/clients/gcp-startup-script*.ts`) is a bash
bootstrap that runs as root on first boot and is idempotent across
reboots:

1. **prepare-features-volume** — creates the persistent
   `/var/lib/interns/<bot>/workspace` dir (under `/var`, the only
   writable + reboot-persistent tree on COS), `docker pull`s the
   pinned `INTERN_RUNTIME_IMAGE`, and seeds the ori workspace by
   running `docker run <image> init /workspace/<bot>` against the
   bind-mounted volume. First boot scaffolds it; reboots re-run
   `ori init` which idempotently re-syncs (preserving features the
   intern added at runtime).
2. **write-runtime-image** — writes `/etc/<bot>/runtime-image`, a
   one-line `ORI_RUNTIME_IMAGE=<ref>` file that BOTH the runtime unit
   and the vault sidecar name as their systemd `EnvironmentFile`. The
   units are static and resolve `${ORI_RUNTIME_IMAGE}` from here at
   start time, which is what makes an image swap a one-line rewrite
   rather than a pattern-edit of two `ExecStart` lines.
3. **write-env** — writes `/etc/<bot>/env` (`docker --env-file`
   shape, `chmod 600`, `chattr +i`) with `OPENROUTER_API_KEY`,
   `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`,
   `ORI_STATE_DIR=/workspace/<bot>/.ori`, and
   `ORI_PI_INSTALL_DIR=/workspace/<bot>/.ori/pi-runtime` (which keeps
   ori's `pi` harness install on the persistent volume instead of the
   container's ephemeral layer, where `--rm` + `Restart=always` would
   re-fetch it from npm on every restart).
4. **install-ori-runtime** — a systemd unit whose `ExecStart` is a
   foreground `docker run --rm --name ori-<bot> --network host
--env-file /etc/<bot>/env -v /var/lib/interns/<bot>/workspace:/workspace
${ORI_RUNTIME_IMAGE} start --features /workspace/<bot>/features --host
127.0.0.1 --port 7070 --auto-update-restart exit`.
   `--network host` + loopback bind means cloudflared is the only
   ingress. `Restart=always`; `systemctl restart` recreates the
   container so `--env-file` is re-read (the Slack rotation path).
5. **install-sync-slack-tokens-timer** — polls instance metadata
   every 30s; on a version bump rewrites `/etc/<bot>/env` and
   `systemctl restart ori-<bot>.service` (NOT `docker restart`,
   which would reuse the container's baked-in env).
6. **install-sync-runtime-image-timer** — polls instance metadata
   every 60s and moves the intern onto a new runtime image. See
   "Upgrading an intern's runtime image" below.
7. **install-cloudflared** — a systemd unit running `docker run
--rm --name cloudflared-<bot> --network host --env-file
/etc/cloudflared-<bot>/env <INTERN_CLOUDFLARED_IMAGE> tunnel
--no-autoupdate run`. The connector token is fed via env-file
   (never argv). Skipped when `INTERN_SKIP_CF_TUNNEL=true`.
8. **self-cleanup-metadata** — strips the secret-bearing
   `startup-script` metadata key (happy path) or `startup-script`
   - `SLACK_*_B64` (partial-failure). COS has no host python3/gcloud,
     so the strip runs `gcloud compute instances remove-metadata`
     inside the `INTERN_CLOUD_SDK_IMAGE` container (`--network host`
     so gcloud auto-auths as the VM service account).

Per-intern uniqueness is the bind-mounted `/workspace/<bot>` volume
only; every intern runs the SAME generic runtime image (no per-intern
image builds). The runtime image is built + published by
`OpenRouterIncubator/ori` (`.github/workflows/runtime-image.yml`), not by
this repo — see `docker/AGENTS.md`.

## Which runtime image is an intern on?

`interns.runtime_metadata.vm_birth_config.runtime_image` records the
image ref the VM was **created** with, stamped by `stampInternVm`
alongside the project/zone/machine-type. That is a birth value and does
not change when the intern is later moved onto a different image.

On the VM, the answer is `/etc/<bot>/runtime-image` (configured) and
`docker inspect --format '{{.Config.Image}}' ori-<bot>` (actually
running). Those two disagreeing is precisely the `unchanged` failure
described below.

## Upgrading an intern's runtime image

### First check whether the intern can be upgraded at all

The reconcile subsystem (#34610, #34611, both merged 2026-08-18)
installs `sync-runtime-image-<bot>.timer` from the VM's **startup
script, at creation time**. That script is baked into instance metadata
when the VM is created and stripped after a successful boot, so a VM
created without the timer does not have one and cannot be given one by
writing metadata at it.

**It CAN be repaired by re-bootstrapping the instance, and that keeps
the workspace.** This section previously said there was no migration
path; that was wrong (corrected 2026-09-08, ORI-1461). A reprovision of
a **Live** instance takes `resolveLiveVmRefresh` in `create-gcp-vm.ts`:
the create path 409s on the existing name, which re-stamps the CURRENT
metadata — `startup-script` included — over the live VM, and
`resetRestampedVm` then resets it so that script runs. The boot
installs the missing units. The instance is reset, never deleted, so
the boot disk survives, and the workspace seed is skipped when the
directory already exists (`startup-script/features.ts`, and
`archive.ts` logs "workspace already restored on a previous boot").

**Restart** in the dashboard is NOT this request. It re-requests the
running image through the runtime-image endpoint and the VM's reconcile
timer bounces the agent's unit in place, so it needs the timer and
never touches the instance. The dashboard's reprovision route 409s a
`running` intern, and the provisioner refuses one at the dispatch stamp
(`running_refused`, checked under OCC so a VM that came up between the
route's read and the dispatch is not reset). To re-bootstrap a live VM
on purpose, enqueue with both flags (the shared-secret header is the
legacy auth path `authenticateEnqueue` still accepts):

```bash
curl -X POST "$INTERN_PROVISIONER_URL/enqueue" \
  -H "X-Provisioner-Secret: $INTERN_PROVISIONER_ENQUEUE_SECRET" \
  -H 'content-type: application/json' \
  -d '{"internId":"<uuid>","entityId":"<entity>","clerkUserId":"<user>","reprovision":true,"allowLiveVmReset":true}'
```

The destructive reading applies to a VM that is NOT live: a dead or
unreachable instance goes down the `recreating_dead_vm` branch, which
rebuilds the machine and loses the disk with it. So "reprovision" costs
the workspace only once the VM has stopped responding.

The test is whether the VM carries the two keys the timer reads:

```bash
gcloud compute instances describe <vm> \
  --project=ext-interns-spawner-000 --zone=us-central1-a \
  --format='value(metadata.items[].key)' | tr ';' '\n' | grep RUNTIME_IMAGE
```

`RUNTIME_IMAGE` + `RUNTIME_IMAGE_VERSION` back means the swap endpoint
will work. Nothing back means it will not — and the endpoint still
writes the metadata and still returns 200, because it does not check
for a timer. **A 200 from the swap endpoint is not evidence that the
intern can be upgraded**; on a VM without the timer the request is
silently a no-op.

Observed across the fleet on 2026-08-19: of the nine intern VMs in
`ext-interns-spawner-000`, the two created after the subsystem shipped
carried both keys and the other seven carried neither.

For an intern without the timer, re-bootstrap it (the `allowLiveVmReset`
enqueue above; dashboard Restart needs the timer it lacks) and then
upgrade it. The swap endpoint refuses such a VM with
**422 `no_reconcile_timer`** rather than accepting a request nothing
will read, and the dashboard withholds Update and says the same thing
before the click (ORI-1461).

Reserve the "expendable workspace" framing for a VM that is already
dead, where recovery genuinely rebuilds the machine.

### How the swap works on a VM that has the timer

`sync-runtime-image-<bot>.timer` polls two instance-metadata keys every
60s:

| Key                                    | Direction        | Meaning                            |
| -------------------------------------- | ---------------- | ---------------------------------- |
| `RUNTIME_IMAGE_VERSION`                | provisioner → VM | opaque token, bumped on every write |
| `RUNTIME_IMAGE`                        | provisioner → VM | desired image ref                  |
| `intern-runtime-image-applied-version` | VM → provisioner | version the last reconcile ran for |
| `intern-running-runtime-image`         | VM → provisioner | ref actually running afterwards    |
| `intern-runtime-image-state`           | VM → provisioner | `applied` / `unchanged` / `failed` |
| `intern-runtime-image-observed-at`     | VM → provisioner | ISO stamp of the read-back         |

The version key is separate from the ref for a reason: the VM's
`/var/lib/<bot>/last-runtime-image-version` marker keys on the VERSION,
so re-requesting the SAME image after a failed swap still reconciles. If
the marker keyed on the ref, a stuck intern would have no way out.

On a version bump the timer pulls, rewrites `/etc/<bot>/runtime-image`,
restarts the vault sidecar (vault mode only — it runs off the same
image) and then `ori-<bot>.service`, and finally reads the container
back. Three outcomes, all reported to instance metadata:

- **`applied`** — the running container's image ID matches the pulled
  image's ID.
- **`unchanged`** — the container is up on DIFFERENT bits than were
  pulled. This is the failure worth knowing about: the agent looks
  healthy and its logs read as "the new image is broken" when it is in
  fact still on the old one.
- **`failed`** — the pull exhausted its 5 attempts (the service was
  never bounced, so the intern is still serving on its previous image),
  or nothing came back up after the restart.

`applied` compares image **IDs**, not ref strings, so a moved tag
cannot read as success.

To debug on the VM: `journalctl -u sync-runtime-image-<bot>`. Every
decision the script makes is logged there.

Two deliberate non-behaviours:

- The runtime unit has **no `--pull`**, and must not get
  `--pull=always`. A crash-looping unit would hammer the registry on
  every `Restart=always` cycle, and a registry outage would then block
  an ordinary restart entirely. The reconcile pulls explicitly instead.
- A **reprovision resets the image**. `createComputeInstance`'s 409
  branch re-merges the create-time metadata over the live VM's, so
  `RUNTIME_IMAGE` goes back to the deployment's `INTERN_RUNTIME_IMAGE`.
  That is the intended reading of "reprovision".

Known gap: the units live in `/etc/systemd/system/`, which COS does not
persist across reboots, and `startup-script` is stripped after a
successful boot — so a rebooted intern loses its units entirely,
upgraded or not. That is the unattended-boot problem, not an upgrade
problem, and it is why the eligibility check above is necessary but not
sufficient: such a VM still carries both metadata keys, so it reads as
eligible and its swap is a no-op that surfaces later as `stalled`. The
repair is the same re-bootstrap.

The gap is still open — nothing makes the units survive a reboot — but
since ORI-1771 it is no longer silent. The fleet health sweep names the
signature (edge answering 530, past the boot grace window, GCE reporting
the instance Live), emits
`openrouter.interns.health_sweep_empty_reboot{outcome:rebooted_empty}`,
and logs `cfw-intern-provisioner: intern rebooted empty` carrying
`intern_id`, `entity_id`, `previous_live_health` and the repair. A VM
that is merely still booting serves the same 530 and is excluded by the
grace window, so the check does not fire on an ordinary slow boot.

The log line fires once per fault, not once per sweep: the sweep
persists its verdict on the row (`runtime_metadata.empty_reboot`) and
logs only on entry into the state. That marker is cleared whenever the
provisioning `/health` gate re-settles, so an intern that is repaired
and later reboots empty again alerts again.

**There is deliberately no monitor yet.** The metric ships here and the
monitor follows once the series can be read in Datadog, per
`configs/terraform-monitors/AGENTS.md` ("a new metric has no baseline to
set a threshold from, so chart it first"). Two things have to be settled
against a live series rather than asserted: whether a sustained-window
gate on a one-point-per-five-minute gauge evaluates at all under
`require_full_window`, and what a fleet-scalar gauge tagged by outcome
alone can honestly claim — `min(...) > 0` says "at least one intern was
in the state throughout the window", never "the same intern for N
sweeps", because the metric carries no intern id and deliberately never
will. Until then this condition is detected and logged, and nothing
pages: search the log line above.

### Testing an unreleased build on one intern

Moving `:stable` is the release path, it is fleet-wide, and cutting one is reserved to a single person (see ori's `docs/engineering/releasing.md`). None of that is what you want when you are verifying a fix. The two downward keys above are writable by hand, so a candidate build can be put on exactly ONE intern, watched, and taken off again, without a release and without touching a moving tag.

This is the loop to reach for whenever the question is "does this change work on a real VM". It was reconstructed during the 2026-09-11 egress outage, where the bug was in the sidecar and a Tilt run could not see it.

**1. Build the candidate for GCE.** Intern VMs are x86, so this is NOT the arm64 recipe used for a local Tilt run — the target, the platform and the bun asset all change. `.github/workflows/runtime-image.yml` in the ori repo is the authority; from an ori checkout on the branch under test:

```sh
STAGE="$HOME/.cache/ori-runtime-candidate-amd64"
rm -rf "$STAGE" && mkdir -p "$STAGE"
bun run compile:cli -- --compile --target=bun-linux-x64-baseline \
  --outfile="$STAGE/ori" --version=<candidate-version> </dev/null
chmod +x "$STAGE/ori"
docker build --platform linux/amd64 --file Dockerfile \
  --tag us-central1-docker.pkg.dev/ext-interns-spawner-000/interns/ori-runtime:<scratch-tag> \
  "$STAGE"
```

Three things that will waste your time otherwise:

- **`--target` takes a *bun* target, and the x64 one is the `-baseline` variant.** `findCliReleaseTarget` keys the table on `bunTarget`, so `bun-linux-x64` and the release-target name `ori-linux-x64` are both rejected with the same unhelpful "requires one of the supported release targets". The accepted values are the `bunTarget` fields in `tools/scripts/release-targets/index.ts`.
- **The build context is the staging directory, not the repo.** The image wants exactly one file. The Dockerfile's default `BUN_ASSET` is already `bun-linux-x64-baseline`, so unlike the arm64 build there is no build-arg to override.
- **On Apple Silicon the amd64 image runs under emulation.** The build is fine, but `docker run` against it is slow enough that a verification step can look like a hang. Confirm the compiled binary is `ELF 64-bit LSB executable, x86-64` with `file` before blaming the image.

**2. Prove the image is what you think before it leaves your machine.** Two checks, because the first one alone has been wrong:

```sh
docker run --rm -e ORI_OUTPUT=json <tag> --version     # the version you compiled
docker run --rm --entrypoint ori <tag> vault-tunnel --help
```

The second is the one that catches a stale layer: read which behaviour the help text describes, or run the command with no environment and read which variable it demands. A tag is a label, not evidence.

**3. Push it under a scratch tag.** Never `:stable`, never `:alpha` — nothing else consumes a scratch tag, so the blast radius is whatever you point at it:

```sh
docker push us-central1-docker.pkg.dev/ext-interns-spawner-000/interns/ori-runtime:<scratch-tag>
```

The VM pulls with `docker-credential-gcr`, minting from its own service account, so any tag in this repository works with no additional grant.

**4. Point one intern at it.** Both keys, one command. The ref may be a tag or a digest; prefer the digest the push reports, since a scratch tag is as movable as any other:

```sh
gcloud compute instances add-metadata intern-<bot> \
  --project=ext-interns-spawner-000 --zone=us-central1-a \
  --metadata "RUNTIME_IMAGE=<ref>,RUNTIME_IMAGE_VERSION=<any-new-token>"
```

`RUNTIME_IMAGE_VERSION` is **opaque to the VM** — it is compared as a string against `/var/lib/<bot>/last-runtime-image-version` and nothing parses it. The provisioner happens to write `provisioned:<ref>`, but any value the VM has not already applied forces a reconcile. Use something that says who wrote it and why, for example `manual-<ticket>-1:<ref>`, so the next person reading instance metadata can tell a hand-driven swap from a provisioner-driven one.

**5. Watch it land.** The timer fires every 60s and reports back into metadata, so this needs no SSH:

```sh
gcloud compute instances describe intern-<bot> \
  --project=ext-interns-spawner-000 --zone=us-central1-a \
  --format='value(metadata.items)' | tr ';' '\n' | grep -i 'runtime-image'
```

Wait for `intern-runtime-image-state`. Read `applied` / `unchanged` / `failed` exactly as the section above defines them — `unchanged` in particular is the one that will otherwise waste an afternoon, because the intern looks healthy while running the old bits.

**6. Roll back the same way.** Write the previous ref with ANOTHER new version token. Re-writing the old ref with the OLD token does nothing, because the VM's marker still matches it:

```sh
gcloud compute instances add-metadata intern-<bot> \
  --project=ext-interns-spawner-000 --zone=us-central1-a \
  --metadata "RUNTIME_IMAGE=<previous-ref>,RUNTIME_IMAGE_VERSION=<another-new-token>"
```

Three things to know before relying on this:

- **A reprovision resets it.** As noted above, `createComputeInstance`'s 409 branch re-merges create-time metadata, so `RUNTIME_IMAGE` reverts to the deployment's `INTERN_RUNTIME_IMAGE`. A hand-written swap is a test fixture, not a durable pin.
- **The sidecar is swapped too, and first.** In vault mode both the `ori vault-tunnel` sidecar and the agent run off the same image, and the reconcile restarts the sidecar before the agent so the two cannot end up on different builds. A sidecar-only change still goes through this same loop.
- **Confirm the container was actually replaced**, not just that the state says `applied`. The agent container's PID changes across the restart, which is visible in Cloud Logging as the `docker[<pid>]` prefix on its log lines.

Verified end to end on 2026-09-11 against a live intern: a hand-written token reconciled within 60s, metadata reported `applied` with the token echoed into `intern-runtime-image-applied-version`, and the agent container's pid changed.

## The vault CA (there is nothing to rotate)

Since ORI-1912 there is no shared root, and so no rotation procedure.
The `ori vault-tunnel` sidecar terminates the agent's TLS itself, under
a CA it MINTS on its own VM at first boot, into
`/etc/intern-vault/root.crt` + `root.key`. Every intern therefore has a
CA of its own, trusted by one agent on one host and by nothing else.

What this service still owns is the directory, and only the directory.
The `prepare-vault-ca-dir` step creates `/etc/intern-vault` root-owned
755 and the sidecar bind-mounts it writable, because it mints there.
The agent bind-mounts `root.crt` ALONE, read-only
(`src/startup-script/service.ts`). It runs as uid 0, so `root.key` being
mode 600 root does not keep the sidecar's CA private key from it, and
`:ro` bars writes rather than reads — leaving the key outside the mount
is the only thing that protects it (ORI-1943). Anything able to write
that directory could also substitute a CA the agent would then trust,
which is why the asymmetry is deliberate.

The agent unit carries an `ExecStartPre` refusing to start when
`root.crt` is absent, ordered AFTER the sidecar readiness probe. That
guard is what makes naming a file safe: `docker run -v` materialises a
missing bind source as an empty DIRECTORY, so a start reaching `docker
run` with no certificate would put a directory where the sidecar must
write a file, and the next mint would fail `EgressCaStateError`. An
agent held at `ExecStartPre` is the wanted outcome — with no trust
anchor it fails every outbound call anyway, because
`NODE_EXTRA_CA_CERTS` is read once at process start.

That step also removes a certificate left by a pre-ORI-1912 boot of the
same VM, and only when no key sits beside it — exactly the half-written
state a distributed certificate leaves behind. The sidecar refuses to
mint over that state (`EgressCaStateError`), so without the cleanup an
in-place re-bootstrap would crash-loop the sidecar and take the agent
down with it. A complete pair is never touched.

Gone with the shared root: the worker's PEM-bundle setting, the
`INTERN_VAULT_ROOT_CA` instance-metadata attribute with its on-VM
reconcile timer, and the `openrouter.intern_vault.ca_distribution`
metric. Anything still pointing at one of those is describing the
architecture this replaced (ORI-1921 deleted all three).

## HTTP surface

- `GET /api/v1/interns/health` — liveness probe (no auth).
- `POST /api/v1/interns/enqueue` — producer entrypoint for `openrouter-web`.
  Body: a single `InternProvisioningMessage`
  (`{ internId, clerkUserId, entityId }`).
- `POST /api/v1/interns/deprovision` — teardown entrypoint. Same body
  and auth as `/enqueue`. See
  [Destroying an intern](#destroying-an-intern-teardown).
- `GET /api/v1/interns/runtime-image/current` — the image this
  deployment ships. No intern scope, no DB or GCE access.
- `GET /api/v1/interns/runtime-image?internId=&entityId=` — an intern's
  runtime-image status. Reads the VM's instance metadata for the last
  reconcile outcome and mirrors it onto the row, so list views can
  answer the same question from the database.
- `POST /api/v1/interns/runtime-image` — move an intern onto a
  different image. Body `{ internId, entityId, clerkUserId, image? }`;
  `image` omitted means "the current one", and naming a previous digest
  is the rollback. Returns as soon as the metadata is written — a 200
  means "requested", never "done".
- `POST /api/v1/interns/instructions` — push the intern row's CURRENT
  instructions onto its VM's instance metadata, for the on-VM
  `sync-instructions-<bot>.timer` to apply. Same auth and
  identity-only body as `/runtime-image`; the text is re-read from the
  row, not the wire. 200 means "requested", never "applied".
- `POST /api/v1/interns/mcp-servers` — push the entity's CURRENT MCP
  server list onto every running intern's VM metadata, for the on-VM
  `sync-mcp-servers-<bot>.timer` to merge into the workspace's
  `mcp.json`. Same auth and identity-only body as `/instructions`; the
  list is re-read from the credential rows, not the wire. 200 means
  "requested", never "applied".
- `POST /api/v1/interns/archive-now` — operator request for a workspace
  archive on a VM that is still Live. Same body and auth as `/enqueue`;
  stamps the request and returns 202. It does NOT reprovision and does
  NOT clear the teardown gate — it produces the bytes in GCS so the loss
  can be accepted with the archive in hand (ORI-1775), and it is step 3
  of [Transferring an intern](#transferring-an-intern-workspace-move-account-handover).

`cfw-frontend-api` proxies both intern-scoped `/runtime-image` routes
(GET + POST) at `/api/frontend/v1/private/interns/:internId/runtime-image`
(staff + org-admin gated); the GCP credentials that can write instance
metadata are bound to this worker, not to that one.

There is deliberately **no scheduled trigger**. An auto-update would
call the same handler with the same body, so adding one later needs no
rewrite — we want to watch upgrades go through by hand first.

### Auth on these routes, and what it actually does today

Every route above except `/health` authenticates the same way:
HMAC signature preferred, `X-Provisioner-Secret` shared secret as the
rollout fallback (`authenticateEnqueue`, `src/auth-enqueue.ts`).

**The signature half is not in effect.**
`INTERN_PROVISIONER_ENQUEUE_SIGNING_KEY` is `.optional()` in `env.ts`
and is not bound on the deployed worker — `wrangler secret list` does
not list it (checked 2026-08-19). So every request falls through to the
shared secret, and that secret then rides in a header on every call,
including the ~2/min `/runtime-image/current` poll. Anything that
observes one request obtains the credential that authorises
provisioning _and_ deprovisioning.

**The evidence is a metric, not a log.** It used to be a per-request
warning: `request authenticated with the legacy shared secret` carried
`had_signing_key: false` on 3,076 of 3,076 occurrences in the 24h to
2026-08-19, with zero `enqueue signature rejected` alongside it. Over 7
days that was 47,280 lines against a next-largest provisioner signal of
2,018 — it buried the service's real failures and slowed an unrelated
investigation, so it is now
`openrouter.intern_provisioner.enqueue_auth` with an `outcome` tag
(`src/enqueue-auth-metrics.ts`).

Read it as a pair. `outcome:legacy` going to zero means the rollout
finished only if `outcome:signature` is non-zero at the same time;
alone, a zero legacy count is equally consistent with nothing calling
this worker at all. `had_signing_key` still separates "the key is not
deployed here" from "the key is deployed and callers still do not
sign".

The exit criteria for deleting the legacy branch are listed in
`src/auth-enqueue.ts`; criterion 1 (key set in every environment) is
unmet in production, not merely in dev.

**Every caller is already written to sign.** All eight call sites in
`cfw-frontend-api` stamp the signature headers whenever
`INTERN_PROVISIONER_ENQUEUE_SIGNING_KEY` is set — the two enqueue
callers inline, the rest through `buildProvisionerAuthHeaders`. So the
only thing standing between today and a signed fleet is the bind; there
is no caller-side code left to write.

Note what is _not_ a caller: the on-VM `sync-runtime-image` poller
never had the shared secret. `buildEnvFileSection` does not write
`INTERN_PROVISIONER_ENQUEUE_SECRET` to the VM env file, and the poller
reports via a GCP instance identity token (`Authorization: Bearer`) on
a separate route that does not use `authenticateEnqueue` at all. This
matters for criterion 2: because no VM authenticates on the legacy
path, the legacy log genuinely can reach zero once the key is bound,
rather than being held permanently non-zero by callers nobody plans to
migrate.

### Binding the enqueue signing key

The key must carry the **same value** on the signer and the verifier. A
different value on each side verifies as `signature_mismatch` and falls
through to the legacy secret, so the endpoint keeps working and the
rollout quietly does not progress. Mint once per environment and write
both paths (flags before the assignment, matching the working example in
`tests/manual/intern-provisioner/AGENTS.md`):

```bash
KEY=$(openssl rand -base64 32)
PID=771b7bc0-6578-41b0-886e-9fcdb66e9173
for path in /services/cfw-frontend-api /services/cfw-intern-provisioner; do
  infisical secrets set --path="$path" --env=dev --projectId="$PID" \
    INTERN_PROVISIONER_ENQUEUE_SIGNING_KEY="$KEY"
done
```

The three ways this goes wrong are distinguishable on
`openrouter.intern_provisioner.enqueue_auth`, so check it rather than
guessing:

| What happened                 | What you see                                                                                                                         |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Bound correctly on both sides | `outcome:signature`                                                                                                                  |
| Bound on both, values differ  | `outcome:signature_rejected` with `reason:signature_mismatch`, then `outcome:legacy` — plus an `enqueue signature rejected` log line |
| Bound on the verifier only    | `outcome:legacy` with `had_signing_key:true`                                                                                         |
| Not bound anywhere            | `outcome:legacy` with `had_signing_key:false`                                                                                        |

Repeat per environment with `--env=staging` and `--env=prod`, minting a
fresh `KEY` for each — one leaked key must not authorise another
environment. Production writes need credentials beyond the ordinary
developer identity, which reads prod as `403`.

Infisical syncs to the Worker without a redeploy, so the binding takes
effect on the next request rather than the next release. Confirm with
`npx wrangler secret list --config wrangler.toml`, which reads the
deployed worker with no Infisical prod access at all.

Nothing gates a deploy on this today, deliberately: a release that
fails because a secret is unbound trades one outage risk for another.
Once the key is bound everywhere, a deploy-time assertion becomes free
to add and worth adding.

### `/runtime-image/current` is the instrument, not just a UI feed

It is the **only** way to observe which image the deployed worker
actually resolved. The alternatives all answer a different question:
Cloudflare secrets are write-only, `[vars]` in `wrangler.toml` can be
read from git but git does not prove what is deployed, and
`wrangler deploy --dry-run` proves a binding is emitted, not which
binding a live request resolves. Reach for this route during an
incident, before reasoning about the config.

## Where the logs go

Operational logs surface via `wrangler tail`. The workflow's own
progress trail is on `interns.provisioning_logs` (JSONB) and
`interns.provisioning_state.current_step`.

### Finding this worker in Datadog

**`service:intern-provisioner` matches nothing.** Despite the worker
being named `intern-provisioner`, its logs arrive through the shared
`instrumentation` tail worker. Cloudflare does not tag those logs with
the emitting script's service, so the tail worker resolves it from the
tail event's script name (`logServiceForScriptName`,
`packages/instrumentation/log-service.ts`) and stamps it on submit:

```
service:cfw-intern-provisioner source:cloudflare env:production
```

Logs submitted before that tail-worker change deployed carry
`service:api` and are not rewritten after the fact, so widen to
`service:(interns OR api) @script_name:intern-provisioner` when looking
back across the cutover.

Searching the service facet for the worker's own name returns zero
results either way, which reads as "this worker emits no telemetry"
when in fact it emitted ~5.5k logs in the 30 days to 2026-08-19.
`@script_name` is the discriminator, not `service`.

Second trap in the same place: structured context is nested, and
Datadog's full-text index does not reach into it. The GCS failure
below cannot be found by searching for its own error string — you have
to search the message and then read `extra.error`.

### The durable GCS log trail is currently discarded

Each provisioning run is supposed to append a JSONL object per
lifecycle event to `intern-logs/<intern_logs.id>.jsonl` in GCS, with
the `intern_logs` row acting as a pointer to it. **The row is written;
the object is not.** Every append fails:

```
cfw-intern-provisioner: failed to append provisioning log entry
  extra.error: GCS put failed: 404 { ... "The specified bucket does not
  exist." ... "reason": "notFound" }
```

Confirmed on all seven lifecycle events (`workflow_started`,
`step_started`, `step_completed`, `step_skipped`, `step_failed`,
`workflow_completed`, `workflow_failed`) across 88 occurrences between
2026-08-13 and 2026-08-18 — an identical error every time, i.e. not
intermittent.

It is **non-fatal by design**: the writer is best-effort, the log is a
`warn`, and runs still reach `workflow_completed` with `outcome: ok`.
So nothing is broken in a way a user sees; what is lost is the
per-intern provisioning trail, silently, which is exactly the artifact
you would want when triaging a failed provision after the fact.

`INTERN_LOGS_GCS_BUCKET` is not bound on the deployed worker, so the
name resolves to the `src/env.ts` default `intern-provisioning-logs`.
That bucket is declared in
`infra/intern-provisioning-logs-bucket.tf` — in a Terraform state that
does not appear to have been applied (see
[Terraform](#terraform-what-infra-does-and-does-not-own)). Creating the
bucket, in a project the worker's credential can write to, is what
fixes this.
Those two cover the **worker**. The **VM** is a separate path — see
below.

### Intern VM logs → Cloud Logging → Datadog

Five hops, each owned by a different file:

| #   | Hop                                                                                                                                                                  | Owned by                                                                                                        |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| 1   | COS fluent-bit ships serial console + container stdout/stderr to the Cloud Logging API                                                                               | `google-logging-enabled = true` in `REQUIRED_INSTANCE_METADATA` (`src/clients/gcp-instance.ts:472`)             |
| 2   | Cloud Logging accepts the write, in `ext-interns-spawner-000`                                                                                                        | Already working — see [Which project the VMs are in](#which-project-the-vms-are-in-resolved). No action needed. |
| 3   | The `datadog-export-sink-interns` project sink exports `gce_instance` entries from that project to the `datadog-log-export-topic` Pub/Sub topic in `openrouter-core` | `google_logging_project_sink.datadog_export_sink_interns`, `services/datadog/infra/logging-pipeline.tf`         |
| 4   | A Dataflow job drains that topic into Datadog                                                                                                                        | same file                                                                                                       |
| 5   | A Datadog pipeline relabels the VM logs onto `service:interns`                                                                                                       | `datadog_logs_custom_pipeline.gce_interns`, `services/datadog/infra/log-pipelines.tf`                           |

Hop 1 is unconditional — not vault-gated — because no intern should
silently discard its own logs, and `createComputeInstance`'s 409 branch
merges the key over an existing VM's metadata, so **reprovisioning an
older intern turns its logging on**. That is the recovery path for any
VM created before the key existed.

Hop 3 is a _second_ project sink, added alongside the pre-existing
`datadog-export-sink` (which covers `openrouter-core` only). Both write
to the same topic, so hop 4 and everything downstream of it — Dataflow
job, dead-letter topic, Datadog API key — is shared and unchanged.

The two sinks use different filters on purpose. `openrouter-core`'s is
an _exclusion_ list:

```
NOT resource.type="k8s_container" AND NOT resource.type="k8s_pod" AND NOT resource.type="k8s_node"
```

The interns sink is an _allow_ list, `resource.type="gce_instance"`.
Reusing the exclusion list there would export the whole interns project
(Artifact Registry, Cloud Build, audit logs) at Datadog ingest cost for
lines nobody reads. If a future intern-adjacent resource type needs
exporting, widen that filter deliberately rather than swapping in the
`openrouter-core` local.

### What identifies an intern VM's logs

The provisioner sets **no GCP resource labels** on the instance —
`CreateInstanceBody` (`src/clients/gcp-instance.ts:419`) has no `labels`
field at all. Everything it does stamp lands somewhere that a log entry
does _not_ carry:

- `tags: { items: ['intern-vm'] }` (`gcp-instance.ts:591`) is a GCE
  **network tag** for firewall targeting (`infra/firewall.tf`). Network
  tags are not part of a `LogEntry`.
- `intern-id`, `intern-hostname`, `openrouter-key-id`,
  `intern-vault-mode` (`src/steps/create-gcp-vm.ts:507-557`) are
  **instance metadata**. Metadata is not part of a `LogEntry` either,
  and `intern-id` — the one attribute that would map a log line back to
  an `interns` row — is only readable via `instances.get`.

The instance **name** (`intern-<internSlug>` truncated to 63 chars,
`vmInstanceName` in `src/steps/create-gcp-vm.ts:815`) does **not**
survive either. A real `cos_containers` entry read from the live
project carries exactly three resource labels — `instance_id`,
`project_id`, `zone` — and an empty top-level `labels` map. There is no
`labels."compute.googleapis.com/resource_name"`, so matching on the
name would silently match nothing.

What does survive is `project_id`, and it is a clean discriminator
because `ext-interns-spawner-000` hosts nothing but intern VMs. That is
what `datadog_logs_custom_pipeline.gce_interns` matches on:

```
@data.resource.type:gce_instance @data.resource.labels.project_id:ext-interns-spawner-000
```

The `@data.*` prefix is this org's convention for the raw GCP
`LogEntry` — see the worker-pool remappers at
`services/datadog/infra/log-pipelines.tf:28,60`.

Do **not** filter on `@data.resource.labels.instance_id`. That is the
numeric GCE id, minted fresh per instance, so it identifies exactly one
VM and changes on every reprovision. It is useful for pinning a single
incident, never for matching the fleet.

Two secondary markers, useful for narrowing once the fleet filter is in
place:

- Bootstrap progress lines are prefixed `[startup-script] step: …`
  (`src/clients/gcp-startup-script.ts`), one per section.
- Container names are `ori-<botName>`, `cloudflared-<botName>`, and
  `ori-vault-tunnel-<botName>` (`gcp-startup-script-service.ts`).

If a durable, queryable intern identity is wanted in Datadog, the fix is
to add a real GCP resource `labels` block to `CreateInstanceBody`
(`intern_id`, `intern_slug`) rather than to keep pattern-matching the
name. That is a code change, not a Datadog change.

### Which project the VMs are in (resolved)

**`ext-interns-spawner-000`.** Verified live: every RUNNING `intern-*`
instance is in that project, `us-central1-a`. It is also where the
runtime images live
(`us-central1-docker.pkg.dev/ext-interns-spawner-000/interns/…`,
`src/env.ts:377`).

That is consistent with how the project is resolved at runtime.
`infra/` hardcodes `project = "openrouter-core"` (`config.tf:15`,
`iam.tf:52`), but the provisioner never reads a project from that
terraform — `createComputeInstance` builds the SA email as
`intern-vm@${input.projectId}…` (`gcp-instance.ts:569`) from
`account.projectId` (`src/steps/create-gcp-vm.ts:560`), which comes from
`INTERN_GCP_SERVICE_ACCOUNT_JSON.project_id`
(`src/clients/gcp-auth.ts:51`) — an Infisical secret, not a repo value.

Two consequences, one closed and one still open:

- **Closed: hop 3.** A project sink exports only its own project's logs,
  so `datadog-export-sink` on `openrouter-core` never saw intern VM
  logs. `datadog-export-sink-interns` (added in
  `services/datadog/infra/logging-pipeline.tf`) is the second project
  sink that covers `ext-interns-spawner-000`, pointed at the same topic.
- **Still open: `infra/iam.tf`.** It manages an
  `intern-vm@openrouter-core…` SA in a project that has no intern VMs;
  the SA the provisioner actually attaches,
  `intern-vm@ext-interns-spawner-000…`, is unmanaged by this repo. That
  is a terraform-hygiene follow-up, not a logging blocker — see below.

### `logging.logWriter` — no grant needed

**Do not grant it.** Verified live: intern VM logs already reach Cloud
Logging in `ext-interns-spawner-000`, arriving on the log streams
`projects/ext-interns-spawner-000/logs/cos_containers` (container
stdout — the stream we care about) and `.../logs/GCEGuestAgent`. Hop 2
works; whatever identity the VMs write as already holds the permission.

The missing piece was never IAM, it was the sink (hop 3). Adding a
`logWriter` binding — by hand or in terraform — would be a no-op
production IAM change on a role that is evidently already effective.

If a future intern VM genuinely stops logging, confirm the write path is
broken before touching IAM:

```bash
gcloud logging read 'resource.type="gce_instance"' \
  --project=ext-interns-spawner-000 --limit=5 --freshness=1h
```

Entries coming back means hop 2 is fine and the fault is downstream
(sink, Dataflow, or the Datadog pipeline).

### Metrics are a separate, currently-dead path

`infra/iam.tf:57` binds `roles/monitoring.metricWriter` and its comment
describes the VM as running "the Ops Agent". Neither is true of the
current runtime: COS has no Ops Agent, and the counterpart metadata key
`google-monitoring-enabled` is **not** in `REQUIRED_INSTANCE_METADATA`
(`gcp-instance.ts:472` stamps `enable-oslogin` and
`google-logging-enabled` only). So the metrics role is bound but
nothing collects. Logs and metrics need separate fixes; do not read a
working log path as evidence that metrics work.

## Tests

- Hermetic E2E: `bun run --filter @openrouter-monorepo/tests-e2e
test -- intern-provisioner` (uses the stub server in
  `tests/e2e/intern-provisioner/stubs/`).
- Manual real-resources: `tests/manual/intern-provisioner/` —
  gated behind `MANUAL_E2E_RUN=1`. See the file headers for the
  required env vars (Infisical path `/tests/intern-provisioner`).

## Destroying an intern (teardown)

The only entry point is the **Delete** button on the intern's
dashboard page. It reaches
`POST /api/v1/interns/deprovision` on this worker (`handleDeprovision`
in `src/index.ts` — same body and auth as `/enqueue`, 202 on accept,
404 when the row is already gone or not owned by `entityId`). The
worker then dispatches one `InternDestroyWorkflow` instance
(`src/destroy-workflow.ts`).

**Scope, deliberately:** dashboard-only. There is no CLI, no bulk
mode, and **no cron reconciler**. That is a design decision, not an
oversight — the conditional-purge contract below depends on there
being no background process that sweeps up leaked resources. Do not
add one without revisiting it.

### The nine steps

Resource-step order lives in `DESTROY_RESOURCE_STEP_ORDER`
(`src/steps/destroy/types.ts:65`); the sequencing and conditional
purge live in `runDestroySequence`
(`src/steps/destroy/destroy-plan.ts:83`).

| #   | Step                    | What it releases                                                                                   |
| --- | ----------------------- | -------------------------------------------------------------------------------------------------- |
| 0   | `fence-provisioning`    | Nothing. Terminates any in-flight provisioning Workflow and polls until it settles.                |
| 1   | `revoke-openrouter-key` | The intern's OpenRouter key — soft revoke (`deleted` + `disabled` on `api_keys`).                  |
| 2   | `delete-vault-secrets`  | Every secret the intern held in the vault. No-ops when the deployment has no vault (it is opt-in). |
| 3   | `delete-gcp-vm`         | The GCE instance and its boot disk. This is what actually stops in-flight inference.               |
| 4   | `delete-cf-dns`         | The tunnel's DNS CNAME, freeing the hostname.                                                      |
| 5   | `delete-cf-tunnel`      | The `cfd_tunnel` (connections cleaned up, then delete).                                            |
| 6   | `delete-slack-app`      | The per-intern Slack app — `auth.revoke`, then `apps.manifest.delete`.                             |
| 7   | `delete-log-objects`    | The GCS objects that `intern_logs` rows point at.                                                  |
| 8   | `purge`                 | The `interns` row and the credential rows it exclusively owned.                                    |

Two bookkeeping steps sit alongside these: `claim-destroying` flips
the row to `destroying` before anything is probed, and
`load-destroy-handles` reads every external handle in one round trip
between step 0 and step 1 (a read failure aborts, like a fence
failure — teardown will not guess at handles it could not read).

Steps 1–7 are **best-effort and continue on failure**. Each one runs
even if an earlier one failed, and each failure is appended to
`metadata.destroy.failures`. Aborting at step 3 would strand six
resources with nothing to pick them up.

### Why fencing is step 0

Without it, a still-running provisioning workflow's `create-gcp-vm`
can create a VM _after_ `delete-gcp-vm` has already run — producing an
orphaned VM with no DB row pointing at it, which is exactly the state
this feature exists to prevent.

Fence failure therefore **aborts everything**: nothing is deleted, the
outcome is `fence_failed`, and the row is stamped `destroy_failed`.
The settle poll is bounded (`src/steps/destroy/fence-provisioning.ts`)
so an un-settling terminate surfaces as a recorded failure rather than
an opaque Workflow step timeout.

Fencing is also why a provisioning run in flight does **not** block a
destroy dispatch (`src/destroy-dispatch.ts`) — refusing there would
make an intern stuck mid-provision undeletable.

### Why the key is revoked FIRST — and why revocation is not a kill switch

Revoking the OpenRouter key does **not** synchronously cut off
inference. The propagation profile:

- ~90s on a healthy path: a 30s per-isolate in-memory LRU
  (`services/cfw-api/src/auth/get-user.ts`) stacked on the
  auth service's 15s-fresh / 45s-stale tier 2.
- Up to **12 hours** through the emergency CF Cache during an auth
  outage (`EMERGENCY_CACHE_TTL_MS`, `services/cfw-api/src/auth/get-user.ts`).

And **no cache invalidation exists anywhere in the stack**. `updateKey`
(`packages/db/api-keys/queries.ts:369`) is a bare `UPDATE`, and the
production key-delete route calls it and returns without touching any
cache (`services/cfw-api/src/routes/keys/delete-api-key.ts:105`).

So the revoke is not the kill switch — **`delete-gcp-vm` is**. Killing
the VM is what stops in-flight inference. Revocation runs first only so
that its propagation window elapses _during_ the rest of teardown: if
`delete-gcp-vm` then fails, the orphaned VM's credential still dies
within ~90s instead of staying live until somebody retries.

### Why the API key row is REVOKED, not deleted

`revokeInternOpenrouterKey` (`packages/db/interns/queries-destroy.ts`)
flips `deleted` + `disabled`. It must never `DELETE` the `api_keys`
row, for three independent reasons
(`postgres/migrations/20260706230000_baseline_schema.sql`):

- `spawns_api_key_id_fkey` (`:8499`) has **no `ON DELETE` clause**, so
  a hard delete can throw outright.
- `akg_key_fk` (`:7509`) and `auth_codes_api_key_id_fkey` (`:7549`)
  both `ON DELETE CASCADE` — a hard delete would silently take those
  rows with it.
- Usage and billing attribute spend by `api_keys.id`, so the row has
  to outlive the intern.

### Why `purge` is conditional on steps 1–7

`purge` only runs if **every** resource step succeeded. If any failed,
the row is stamped `destroy_failed` with the failure list and **kept**.

Deleting it would erase the only record that a resource leaked. There
is no reconciler in this release, so the row _is_ the ledger — and the
user's retry, which is the recovery path, needs the row to exist.

### What cascades and what does not

`purgeIntern` (`packages/db/interns/queries-destroy.ts`) deletes
`FROM interns`, which cascades:

- `intern_logs` via `intern_logs_intern_id_fkey`
  (`20260706230000_baseline_schema.sql:7979`)
- `intern_connection_credentials` via
  `intern_connection_credentials_intern_id_fkey` (`:7959`)

There is **no FK from `interns` to `intern_credentials`**. The junction
cascade removes the _link_ and leaves the credential row orphaned and
unreachable. So `purgeIntern` snapshots the junction rows _before_ the
delete, then removes those credentials explicitly — and only the ones
**no other intern still links**. Credentials are entity-scoped and
deliberately shared (`mintInternSlackApp` reuses one per
`(entity, slug)`), so an unconditional delete would rip a credential
out from under a live intern.

This is also why `delete-log-objects` must precede `purge`: the
cascade takes the `intern_logs` pointer rows, and with them the GCS
addresses of objects that would otherwise be unreachable forever.

### Triaging a stuck intern: `metadata.destroy`

Shape in `packages/db/interns/destroy-state.ts`. On a
`destroy_failed` row:

```sql
SELECT status, metadata -> 'destroy'
FROM interns WHERE id = '<intern-id>';
```

- `destroy.attempt` — monotonic destroy-attempt counter, owned by the
  dispatcher (NOT `runtime_metadata`, which belongs to provisioning).
- `destroy.current_step` — where the last attempt got to.
- `destroy.failures[]` — one entry per step that failed, each with
  `step` (the kebab-case `DestroyStep` value from the table above),
  `message`, and `observed_at`. **This is your leak list**: each entry
  names a resource that is still live. `stampInternDestroyFailure`
  replaces only the `failures` key, so `started_at` / `current_step` /
  `attempt` survive across retries.

A `fence_failed` outcome means **nothing was deleted** — read it as
"the provisioning workflow would not die", not as a resource leak.

### Recovery: click Delete again

The retry path is the same dashboard **Delete** button. It flips the
row from `destroy_failed` back to `destroying` and re-runs the whole
sequence; every resource step is idempotent, so the already-released
ones no-op.

Cloudflare reserves a terminal Workflow instance id **forever**, so a
retry cannot reuse the previous id. `decideDestroyDispatch`
(`src/destroy-dispatch.ts`) mints attempt+1 and
`destroyWorkflowInstanceId` (`src/steps/destroy/destroy-plan.ts:30`)
builds `intern-destroy-<internId>-<attempt>` — a namespace disjoint
from provisioning's `intern-<internId>-<attempt>`, so a teardown can
never collide with the run it is fencing. A destroy that is already
in flight is not double-dispatched. A request that adds a consent the
running one lacks (`acknowledge_workspace_loss` or
`acknowledge_orphans`) **supersedes** it: attempt+1 is minted
carrying the union of recorded and requested consents, and the new
run's step 0 fences the old one until it settles, before any resource
step. A request that adds nothing skips, as a double-click always has.

Note that `delete-slack-app` covers the app minted for a _provisioned_
intern. It does not close the orphaned-Slack-app window described
under [Abandoned interns](#abandoned-interns-minted-slack-app-never-installed)
— an app minted before its credential row landed is not reachable from
any intern row, so teardown cannot find it either.

## Re-provisioning a completed or terminated intern

Reprovisioning is implemented. `POST /api/frontend/interns/{internId}/reprovision`
(`services/cfw-frontend-api/src/routes/labs/interns/reprovision/route.ts`)
re-enqueues with `reprovision: true`, and `decideWorkflowDispatch`
(`src/workflow-dispatch.ts:110`) handles the `terminal + reprovision=true`
case by minting attempt+1.

Cloudflare Workflows reserves an instance id for the lifetime of the
account, so a terminal instance can never be re-run under its own id.
Instead the dispatcher mints a **versioned** id,
`intern-<internId>-<attempt>` (`workflowInstanceId`,
`src/workflow-dispatch.ts:57`), with the counter persisted on
`interns.runtime_metadata.provisioning_attempt`. Rows that predate
versioning are probed under the legacy unversioned `intern-<internId>`
id as attempt 0.

The dispatch matrix (`decideWorkflowDispatch`):

| Probed status                       | `reprovision` | Action                                                                                                                   |
| ----------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `not_found`, persisted versioned id | any           | Re-create under the SAME id — persist-then-create crash recovery, or CF GC'd a terminal instance. Don't burn an attempt. |
| `not_found`, no versioned id        | any           | Mint attempt+1. The cold-start path.                                                                                     |
| `in_flight`                         | any           | Skip. Never double-dispatch a live workflow; wait for it to settle.                                                      |
| `terminal`                          | `false`       | Skip. A duplicate plain `/enqueue` stays a no-op.                                                                        |
| `terminal`                          | `true`        | Mint attempt+1.                                                                                                          |

Reprovisioning reuses the already-stored Slack tokens. The Slack
app is immutable for the intern's lifetime and the OAuth install
already wrote `bot_token_encrypted` + `installed_at`, so a
re-enqueue does NOT require re-installing — `create-gcp-vm`
re-reads the stored token via `fetchInternSlackTokens` and bakes
it into the fresh VM. There is no resync round-trip.

If the intern needs to go away rather than be rebuilt, use the
dashboard **Delete** button — see
[Destroying an intern](#destroying-an-intern-teardown). Do not
hand-delete the `interns` row in Postgres: that leaves the VM, the
Cloudflare tunnel, the Slack app, the GCS log objects, and the
OpenRouter key live with nothing pointing at them.

## Transferring an intern (workspace move, account handover)

Two different operations hide behind the word "transfer" and they are not the same size. An intern row carries both `entity_id` (the Clerk account that owns it) and `workspace_id` (the workspace inside that account). Moving between workspaces of one account is three UPDATEs and no reboot. Moving between accounts re-tenants every entity-scoped resource the intern holds — the row, the OpenRouter key, its credentials, its vault — while keeping the intern's id, slug, URLs, VM, boot disk and Slack app exactly as they are. `POST /api/v1/internal/interns/:internId/transfer` on `cfw-internal` does this in one staff-triggered call (ORI-1928); see below.

### Between workspaces of the same account

Nothing baked onto the VM references `interns.workspace_id`. The only tenant id on the VM is `ORI_VAULT_WORKSPACE_ID` in `/etc/<bot>/env`, and despite the name it holds the ENTITY id — `buildVaultProvisioning` passes `entityId` (`src/clients/vault-provisioning.ts`), and so does the vault agent token, `hex(HMAC-SHA256(entityId NUL internId))`. A workspace move inside one account is therefore a database-only change: no reprovision, no downtime, nothing to re-stamp.

```sql
-- the destination must belong to the same entity and still be live
SELECT id, entity_id, deleted_at FROM workspaces WHERE id = :to_workspace;

UPDATE interns SET workspace_id = :to_workspace
  WHERE id = :intern_id AND entity_id = :entity_id;
UPDATE api_keys SET workspace_id = :to_workspace
  WHERE id = (SELECT openrouter_key_id FROM interns WHERE id = :intern_id);
UPDATE intern_archives SET workspace_id = :to_workspace
  WHERE intern_id = :intern_id;
```

Three things to check before running it:

1. `interns_entity_name_uq_v2` is UNIQUE on `(entity_id, workspace_id, creator_user_id, name)` WHERE `archived_at IS NULL`. A same-named intern by the same creator already in the destination collides.
2. Visibility is per creator. A member who does not administer the destination workspace sees only rows whose `creator_user_id` is them (`internVisibilityPredicate`, `packages/db/interns/queries.ts`), so repoint `creator_user_id` too if the intern should belong to someone else after the move.
3. The API key row follows the intern so it lists next to it. Leave it behind and the key stays live but invisible in the workspace view — the case ENT-1784 closed.

### Between accounts: the transfer endpoint

`POST /api/v1/internal/interns/:internId/transfer` on `cfw-internal` (`services/cfw-internal/src/routes/interns/`) re-tenants one intern from the account that built it to the account that will own it. It is staff-only: both the shared admin key (`x-openrouter-admin-key`) and a verified Clerk employee bearer token are required, the same chained gate `org-hipaa`'s `/enable` route uses for a destructive action, so the trail names a person and not just a shared secret. Body:

```json
{ "fromEntityId": "…", "toEntityId": "…", "toWorkspaceId": "…", "toCreatorUserId": "…", "dryRun": false }
```

`fromEntityId` is the caller's belief about who currently owns the intern, not a value the route derives itself — deriving it by reading the row would compare that value against itself and the guard below would be vacuous. `transferInternTenant` opens its transaction by locking the intern row `FOR UPDATE` on `fromEntityId` plus the workspace, creator, `running` status and unarchived state pre-flight approved, so if the intern moved, changed workspace or creator, or left `running` in the meantime, nothing is written and the route answers 409 `source_changed` instead of proceeding from a source that is no longer current.

`dryRun: true` runs every pre-flight check and returns the same response shape with nothing written, so a transfer can be checked before committing to the outage window described below.

Pre-flight refuses, naming every failing check in one response, when:

- the intern is not `Running`. A healthy agent that the health sweep just saw serving is NOT a refusal: moving a working intern is the whole point of a whiteglove handover, and the transfer re-bootstraps the VM by design, so schedule it with the customer instead (see the outage window below);
- the destination workspace is missing, soft-deleted, or its `entity_id` does not match `toEntityId`;
- `toCreatorUserId` is not a member of the destination workspace. Both destination checks run again inside the move transaction, with the workspace and membership rows locked `FOR SHARE` so neither can be deleted until the move commits; a destination that changed after pre-flight refuses with nothing written, and the route answers 409 `destination_workspace_invalid` or `destination_creator_not_member`;
- a live intern already holds `(toEntityId, toWorkspaceId, toCreatorUserId, name)` — the same collision `interns_entity_name_uq_v2` enforces in the same-account section above;
- any credential the intern holds (`runtime_credential_id`, `vcs_credential_id`, or one bound through `intern_connection_credentials`) is also referenced by any other intern — in any account, archived or not. A shared OpenRouter-owned credential is never cloned into the destination — the transfer refuses instead of silently forking it. The same check runs again inside the move transaction with the candidate credential rows locked `FOR UPDATE` (binding a credential takes `FOR KEY SHARE` on it through the foreign key, which that lock blocks), so a binding added after pre-flight still refuses the whole move with nothing written, and the route answers 409 `shared_credential`;
- `fromEntityId` equals `toEntityId`. This route moves an intern between accounts; a move between workspaces of one account needs no vault or VM change and is the SQL in the section above.

A shared vault in the source entity (`agent_id IS NULL`, holding secrets other interns in that account may also read) is reported in the response rather than refused on: whether this intern actually reads one of those secrets is not knowable from the data, so the endpoint names it instead of blocking a healthy transfer on an unknowable dependency.

Write order, every step guarded on the intern's CURRENT tenant so a re-run after a partial failure resumes rather than repeats: intern row → `api_keys` (repointed, never re-minted or revoked — `api_keys.hash` is globally UNIQUE and the intern's `sk` derives deterministically from `internId`, so a fresh mint in the destination is impossible. The key is owned by the ENTITY, not the creator — `insertApiKey` mints it under `ctx.entityId` — so `clerk_user_id` moves from `fromEntityId` to `toEntityId`. A legacy key minted under a person is not owned by the source entity, is left where it is, and is named in the response's `warnings`, because it keeps billing its current owner until repointed by hand) → `intern_credentials` → `intern_archives` → the vault → reprovision. The vault moves LAST, immediately before the reprovision enqueue, via `POST /v1/vaults/retenant` on `cfw-secret-vault` (`{ agent_id, to_workspace_id }`, admin-keyed) — it re-wraps the vault key's envelope under the destination's AAD identity; no secret ciphertext is re-encrypted, because a secret's AAD is `(vaultId, name)` and the vault row keeps its id. The reprovision is enqueued on `cfw-intern-provisioner` with `reprovision: true, allowLiveVmReset: true` (required — the row is `running`, and without it the provisioner's OCC stamp refuses), naming the verified employee as `clerkUserId`.

A failed reprovision enqueue does NOT fail the transfer. Every row and the vault have already moved by that point, so the response reports `reprovision: "failed"` alongside `ok: true`, and a re-run retries only that step. A re-run whose reprovision was recorded but whose `completed_at` stamp did not land retries only the stamp.

Between the row move and the recorded `vault` step, the vault refuses every intern-scoped secret write for that intern with 409 `conflict` (`isInternVaultTransferPending` in `packages/db/interns/queries-transfer.ts`, checked in `putSecret`). A vault created at the destination in that window would collide with the source vault the transfer is about to move, and every retry would then fail as `vault_conflict`. So a customer adding a secret to the intern mid-transfer sees an error until the transfer finishes, and the transfer holds the reprovision (`reprovision: "failed"`, re-run) if the vault moved but its step did not record, since the reprovision writes secrets the vault would refuse.

A 202 from the provisioner is not enough to count as `succeeded`. `/enqueue` also answers 202 when it decides not to start a workflow (for example `in_flight`, when one is already running for this intern, whose payload still names the source entity), so the 202 body carries the decision as `dispatch: { action: "create" }` or `dispatch: { action: "skip", reason }`. Only `create` records the reprovision step. A skip reports `reprovision: "failed"` with `reprovisionFailureReason` naming the reason; re-run the transfer once the intern's current workflow has finished.

Besides `steps` and `reprovision`, the 200 body carries `vault` (`moved`, `secretCount`, `originCount` — `null` when this call did not run the vault step), `didMoveApiKey`, and `warnings`. Read the warnings: they name a shared vault left behind, an API key that was not repointed, an origin the destination already held with different injection routes or permissions (the destination's rules are kept, so those credentials now inject where the destination allows), and a step that ran but whose progress stamp did not land (a re-run repeats it).

A completed transfer does not block a later one: an intern handed to account X can be transferred on to account Y. A transfer still in progress resumes only for the same source and destination: `runtime_metadata.transfer` records `from_entity_id`, because once the rows move the intern row no longer names the source, and a re-run that names a different source or destination is refused with 409 `different_transfer_in_progress`. That keeps a mistyped `fromEntityId` on a retry from sending the vault a source that holds nothing and recording the vault step as done.

**The outage window opens at the first write, not at the vault step.** `findInternWorkspace` (`services/cfw-secret-vault/src/queries/agent-vault-reads.ts`) authorises an intern's vault access by `interns.id = agentId AND interns.entity_id = workspaceId` — it reads `interns` and never touches `agent_vaults`, so where the vault row happens to sit has no bearing on this check. The window opens the instant `transferInternTenant`'s first write lands — `interns.entity_id` moving to the destination — because from that moment the VM's baked `ORI_VAULT_WORKSPACE_ID` still names the old entity, which no longer matches, and every vault request the VM makes 403s as `VAULT_AGENT_WORKSPACE_MISMATCH`; the intern's model calls and every other vault-backed credential stop resolving right there, before the vault or anything else in the write order has moved. It closes only once the reprovision lands and re-stamps the VM with the new entity id, and nothing in the write order can make it zero — the reprovision is a separate call to a separate service, not a step that folds into the same transaction as the row move. That is why the response's `reprovision` field exists (`null` on a dry run, `"succeeded"` or `"failed"` once the real transfer has run), so the caller knows the intern's outbound credentials stay unavailable until it reports back, and why this is something you run with the customer watching, not behind their back.

What travels with the intern: its id, slug and URLs, the VM and boot disk, the Slack app and its install, the OpenRouter key (repointed) and every vault secret (re-wrapped, not re-encrypted). What does not move, because neither carries a tenant column: `intern_logs` and `intern_icons`, both keyed by `intern_id` alone.

**Break-glass**, for when the endpoint refuses on a check that does not apply here, or `cfw-internal` cannot reach the provisioner: the row moves can be run by hand with the guarded UPDATEs in `packages/db/interns/queries-transfer.ts` (`transferInternTenant`), which is the same shape as the same-account SQL above extended to `interns.entity_id`, `api_keys.clerk_user_id` (the owning entity, not the creator) and `intern_credentials.entity_id`. Follow with `POST /v1/vaults/retenant` on the vault directly, and finish with a manual `/enqueue` to the provisioner carrying `reprovision: true, allowLiveVmReset: true`, checking that the 202 body says `dispatch.action` is `create`. Move the vault only after the row move has landed. Doing it the other way round strands the vault: with the vault moved first but `interns.entity_id` still the source, `findInternWorkspace` fails for the destination too (the intern still belongs to the source entity), so the vault is unreadable from both sides — the destination doesn't own the intern yet, and the source no longer owns the vault — and a crash between the two steps leaves it sitting under an entity that owns no intern at all.

Exercise the whole path locally with `tilt trigger intern-transfer-smoke` under `tilt up -- --interns` (`services/cfw-internal/scripts/local-transfer-smoke.ts`). It builds its own org-owned source intern carrying an API key minted under the org entity, a runtime credential, an archive and a vault secret, moves it to a second org as a dry run and then for real, asserts every one of those rows and the secret landed at the destination, and removes everything it created. It never touches the shared `seed-local` fixture.

Keep the `intern-provisioner` resource off (its Tilt default) while you run it; the smoke refuses otherwise. The transfer ends with a reprovision, and the local provisioner runs with real dev GCP credentials, so an enqueue that reaches it dispatches a real provisioning workflow. With it off, the enqueue fails fast and the route reports `reprovision: "failed"` alongside `ok: true`, which is the expected local result.

## A VM that never passed `/health` (health-gate ladder)

`create-gcp-vm` polls `https://<tunnel>/health` for up to ~9 minutes
after the VM is inserted. When that budget runs out the step no longer
fails and leaves the instance running behind a row that later reads
`running`. It climbs a ladder recorded on `interns.runtime_metadata`
so every step retry lands on the same rung, whether the retry re-enters
through the create path or resumes against a VM an earlier step attempt
already stamped (`src/provisioning/steps/health-gate-recovery.ts`):

1. **Reset once.** The step records
   `runtime_refresh_reset = { attempt, reason: 'health_gate', requested_at }`
   and throws a retryable error. The retry re-enters the create path,
   409s on the existing name, re-stamps the boot script and secrets the
   failure strip removed, then issues `instances.reset`. The operation
   name is written to `reset_operation_name` before it is polled, so a
   crash mid-poll resumes it instead of resetting again.
   `completed_at` is written only after `/health` passes.
2. **Stop, do not delete.** If `/health` is still not up after the reset
   this attempt issued, the step records
   `vm_stop = { attempt, reason: 'health_gate' }`, issues `instances.stop`,
   records `stop_operation_name` before polling, and stamps
   `confirmed_at` once the operation is `DONE`. Only then does it throw
   the terminal error that lets the workflow stamp `failed`. An
   unconfirmed stop stays retryable. The boot disk (and `/workspace`) is
   kept. A retry that re-enters the step with a `vm_stop` for the
   current attempt finishes that stop before it reads the GCE status,
   so a `STOPPING` instance is never taken for a stopped one and started
   again, and a still-`RUNNING` one is never health-polled.
3. **Start on the next attempt.** A reprovision finds the instance
   `TERMINATED` with a `vm_stop` record from an earlier attempt, writes
   `runtime_refresh_reset` with `reason: 'stopped_vm_start'`, re-stamps
   the boot script through the same 409 path, and issues
   `instances.start` instead of deleting and recreating. `vm_stop` is
   cleared only after `/health` passes on the started VM. A dead VM with
   no `vm_stop` record still goes through the archive-gated recreate.

A dead-origin streak (the tunnel is enrolled but the origin answers
`origin_unhealthy` six probes in a row) is a different failure and keeps
its own repair. Uncertain reads never climb the ladder: an unreadable
GCE status, a failed record write, or a stop or reset GCE did not confirm
leave the VM as it is and the step retryable.

The dashboard does not show either provisioner reboot as a Restart:
`isInternRestarting` (`projects/web/utils/interns/restart.ts`) only
counts a `runtime_refresh_reset` without a `reason`.

Triage: `intern_health_gate_recovery` logs the rung chosen
(`action: request_reset | stop | rethrow`) with the last probe failure
reason, `intern_health_gate_vm_stopped` logs the confirmed stop, and
`intern_step_repairing` with `repair: starting_stopped_vm` logs the
later start. To bring a stopped intern back, reprovision it from the
dashboard. To find out why the VM never answered, read its serial
console or Cloud Logging under the instance name before starting it,
since the start re-stamps the boot script and reboots.

## Abandoned interns (minted Slack app, never installed)

Because the Slack app is minted at `POST /interns` time but the
OAuth install is a separate user action, a row can sit in
`status=awaiting_slack_install` indefinitely if the operator closes
the wizard without clicking "Install in Slack". Such a row owns a
real Slack app in the operator's workspace that was never used.

- **Idempotent re-mint:** retrying the wizard does NOT leak a
  second Slack app. `mintInternSlackApp` reuses an existing `slack`
  credential in two cases: (1) one already linked to the intern, and
  (2) an unlinked credential carrying the intern's deterministic
  `slack:${slug}` label — the leftover of an attempt that minted the
  app and wrote the credential row but crashed before the junction
  link landed. The link step retains (does not revoke) the credential
  on failure precisely so this label lookup can recover it. The
  `POST /api/frontend/interns/{internId}/slack/mint` recovery route
  exists so the install step can re-mint transparently if the
  initial create-time mint failed.
- **Concurrent-mint guard:** the up-front reuse check is read-then-
  write, so two simultaneous `POST /api/frontend/interns` calls (browser
  retry, network retry, direct API hit) could both see no credential and
  both mint. The `idx_intern_credentials_slack_label_unique` partial
  unique index on `(entity_id, label) WHERE type='slack' AND label IS
NOT NULL` (migration `20260601000000`) collapses that race: the losing
  `createCredential` insert fails with `23505`, and `mintInternSlackApp`
  recovers by re-reading and reusing the winner's row, so the caller
  still succeeds idempotently. At most one non-revoked `slack` credential
  (and one linked app) survives per `(entity, slug)`. The loser's
  already-minted app falls into the same residual-orphan window below
  (logged `lost concurrent mint race; reusing winner (this app
orphaned)`), since preventing the duplicate mint entirely needs the
  pre-mint reservation row the schema can't represent yet.
- **Residual orphan window:** if the Slack `apps.manifest.create`
  call succeeds but the immediately-following `createCredential` DB
  write fails, nothing records the minted app id, so a retry mints a
  fresh app and leaves the first orphaned. This is logged with
  `slack_app_id` (`mintInternSlackApp: credential write failed after
Slack app minted (orphaned app)`) for manual cleanup. Fully closing
  the window needs a pre-mint reservation row, which the shared
  `SlackCredentialDataSchema` can't represent today (it requires the
  post-mint `slack_app_id` + secret fields) — tracked as follow-up.
- **Cleanup:** to reclaim an abandoned intern, use the dashboard
  **Delete** button — see
  [Destroying an intern](#destroying-an-intern-teardown). It handles
  the row, the junction and log cascades, and the exclusively-owned
  credential rows, and the resource steps all no-op for an intern
  that never got a VM or a tunnel. Do not hand-delete in Postgres.
  The residual-orphan case above is the exception: an app minted
  before its credential row landed is not reachable from the intern
  row, so `delete-slack-app` cannot find it. Delete that one manually
  from `https://api.slack.com/apps` — the platform does not auto-reap
  apps minted from a config token, and there is no automated reaper.

## One-time reconcile for in-flight placeholder interns

This PR removes the placeholder-boot path and the async
`sync-slack-token` resync (#22702). Any intern that was provisioned
under the OLD flow and is currently running on a placeholder
`xoxb-PLACEHOLDER-PHASE6` token (i.e. its VM booted before the
OAuth install landed) will NOT be auto-healed anymore, because the
resync trigger is gone.

Operational step (run once after deploy):

1. Find interns whose `intern_credentials(slack).data.installed_at`
   is set (OAuth completed) but whose VM may still be running the
   placeholder — in practice any intern created before this deploy
   that completed install via the old async path.
2. **Reprovision** each via the dashboard re-provision flow (or
   Delete + re-create through the dashboard). `create-gcp-vm` will
   re-read the real stored token and re-stamp the VM metadata + env
   file with real values.
3. Interns still in `awaiting_slack_install` (never installed) need
   no reconcile — they have no VM yet; just complete the install or
   clean them up per the section above.

## Terraform: what `infra/` does and does not own

**Read this before editing anything under `infra/`.** That directory
does not manage the infrastructure interns actually run on.

`infra/config.tf` points its provider at **`openrouter-core`**. Live
intern VMs are in **`ext-interns-spawner-000`**. The resource names
match across the two projects, which is what makes the mistake so easy:

| `infra/` declares                                                      | in                | Live interns use                    | in                        |
| ---------------------------------------------------------------------- | ----------------- | ----------------------------------- | ------------------------- |
| `intern-vm` service account                                            | `openrouter-core` | `intern-vm@ext-interns-spawner-000` | `ext-interns-spawner-000` |
| `interns` VPC + subnet + NAT                                           | `openrouter-core` | `interns` VPC                       | `ext-interns-spawner-000` |
| `interns-allow-iap-ssh`, `interns-deny-all-internal` (tag `intern-vm`) | `openrouter-core` | same names, same tag                | `ext-interns-spawner-000` |
| `intern-provisioning-logs` bucket                                      | `openrouter-core` | no such bucket is reachable         | —                         |

Verified 2026-08-19 by reading a running instance: every intern VM is
attached to `intern-vm@ext-interns-spawner-000.iam.gserviceaccount.com`
and sits on the `interns` VPC in that same project.

The consequence: **editing `infra/iam.tf` to change what an intern VM
may do changes nothing**, and the apply will succeed, so nothing tells
you. The same goes for the firewall rules. The `intern-vm` SA that
interns really use was created by hand and its own description says it
"Intentionally has zero project IAM bindings" — which is not what
`infra/iam.tf` describes.

More broadly, `ext-interns-spawner-000` is essentially unmanaged. The
Artifact Registry `interns` repository, its
`roles/artifactregistry.reader` binding for `intern-vm`, and every
image in it were all created by hand. The single AR writer binding
added by #34933 (`ci/infra/gcp-ori-runtime-image.tf`) is the only
Terraform in this repo that reaches into the project at all, and even
that file says so in its own comments.

**No CI applies `ci/infra`.** The Terraform workflows are scoped to
`projects/mission-control/infra`, `configs/terraform-monitors`, and
`services/<name>/infra`. The trap: `ci/infra/gcp.tf` _defines_
`terraform-plan` and `terraform-apply`, so it reads like the state
those identities apply — they exist for the other states. Reasoning
about permissions for a `ci/infra` change by reading those bindings
gives the wrong answer.

Two verification notes that follow from all of the above:

- `terraform init -backend=false && terraform validate` needs **no
  credentials, no state, and no GCP access** — it checks config against
  the real provider schema. "Cannot be verified without access" is
  usually false; only `plan` needs credentials.
- A green `wrangler deploy --dry-run` proves the artifact is
  well-formed, **not** that the deployed system resolves it as
  expected. Those are different claims and conflating them overstates
  what was checked.

## Secret rotation

All long-lived secrets live in Infisical. Walk-through skills:

- `PROVIDER_ENCRYPTION_KEY` — see [Key rotation](#key-rotation) below
  for the full envelope re-encryption procedure.
  `.claude/skills/add-internal-signing-key` covers the Infisical +
  wrangler plumbing only; it does NOT re-encrypt existing data.
- `INTERN_PROVISIONER_ENQUEUE_SECRET` — same shape as
  `add-internal-signing-key`; this secret guards an HTTP endpoint
  and has no persisted ciphertext to migrate.
- `INTERN_GCP_SERVICE_ACCOUNT_JSON`, `INTERN_CF_API_TOKEN` — provider-specific
  rotation in their respective consoles, then update Infisical
  and redeploy.

### Key rotation

> **Status: not implemented.** Rotating `PROVIDER_ENCRYPTION_KEY`
> without first re-encrypting persisted envelopes will brick every
> existing intern. Read this section before flipping the env var.

`PROVIDER_ENCRYPTION_KEY` is the AES-GCM envelope key for every
encrypted column the provisioner persists, AND the HMAC key
`deriveInternOpenrouterSk` uses to derive the per-intern OpenRouter
sk. Rotating the env var without migrating the data does NOT silently
re-mint anything — `fetchInternOpenrouterKey` reads the persisted
envelope rather than re-deriving, and `decryptOrContext` will throw
on every existing intern because the old envelope was sealed under
the old key.

Affected columns:

- `interns.openrouter_key_encrypted` (promoted out of `metadata` by migration 20260528160000)
- `interns.daemon_token_encrypted` (per-VM `ORI_DAEMON_TOKEN`; written by `upsertInternDaemonToken`, read by `fetchInternDaemonToken`, which throws rather than re-mints when a stored envelope fails to decrypt)
- `intern_credentials.data.*_encrypted` (Slack bot/signing tokens,
  client secret, …)

Procedure (no live writers permitted during the swap):

1. **Pause every writer that touches a `*_encrypted` column.** Stop
   the `cfw-intern-provisioner` worker so no step is mid-decrypt,
   AND put the `/projects/web` paths that write encrypted columns
   into maintenance mode (intern provisioning enqueue, Slack
   credential save, Slack OAuth callback that stamps
   `intern_credentials(slack).data.bot_token_encrypted`). A
   concurrent web-tier write during step 3 would seal a fresh
   envelope under the OLD key and silently break decrypt after the
   worker comes back up under the NEW key. Inbound
   `/api/v1/interns/enqueue` POSTs should be rejected at the web
   tier (the worker would otherwise start a Workflow under the OLD
   key and fail mid-step after the key rotates).
2. **Mint a new 32-byte standard-base64 key.** Match the
   `ensureEnv` validator: 32-byte payload, charset `[A-Za-z0-9+/=]`
   (no URL-safe variants).
3. **Decrypt every envelope with the OLD key, re-encrypt with the
   NEW key, write atomically per row.** Drive this from an offline
   migration script that scopes to one entity at a time and uses
   the same OCC predicate the worker uses (`WHERE updated_at =
<observed>`) so a partial failure leaves the row consistent.
   Walk: `interns.openrouter_key_encrypted`,
   `interns.daemon_token_encrypted`, then every un-revoked
   `intern_credentials` row.
4. **Update Infisical.** Rotate
   `PROVIDER_ENCRYPTION_KEY` at `/services/cfw-intern-provisioner`
   (and any other path that references it, e.g. `/projects/web`).
5. **Redeploy the worker.** Lift the maintenance mode on
   `/api/v1/interns/enqueue`.
6. **Verification.** Pick a sample intern per entity and run
   `fetchInternOpenrouterKey` / `fetchInternDaemonToken` /
   `fetchInternSlackTokens` / `fetchInternBootstrap` (via the
   existing health hooks). Any `decryptOrContext` failure means the
   migration script missed a row — roll back the env var and re-run
   the script.

Out of scope for this PR: the migration script itself and a
two-key transitional mode (decrypt with old or new, encrypt with
new). Both are tracked separately and required before a real
rotation runs against prod.
