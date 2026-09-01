# cfw-intern-provisioner/infra

## This Terraform root has never been applied

Nothing in this directory manages a live resource. The intern stack
that actually exists was built by hand in **`ext-interns-spawner-000`**.

As of 2026-08-21 the `.tf` files at least *describe* that project: every
intern resource carries `provider = google.interns`, whose project is
`var.interns_project_id` (default `ext-interns-spawner-000`). Before
that they described a stack in `openrouter-core` and declared a service
account that did not exist anywhere, which is the older and more
confusing version of this warning that earlier readers hit.

Two resources deliberately stay on the default `openrouter-core`
provider and are not bugs: `module.tfstate-bucket` (state belongs with
every other service's, reachable by the `terraform-apply` /
`terraform-plan` SAs, which are `openrouter-core` identities) and
`google_project_iam_audit_config.cloud-sql-data-plane` (it governs the
production Postgres, which lives in `openrouter-core`).

The practical consequence, and the reason this file exists:

> **Editing `iam.tf` still does not change any intern VM's permissions.**
> A change here is a change to an unapplied plan. To actually tighten
> or loosen what a live intern can do, the same change has to be made
> against `ext-interns-spawner-000` by hand.

That is a trap worth naming explicitly, because `iam.tf` reads like a
security control. Its docblock argues — correctly — that intern VMs
must not run as the default Compute Engine SA, which carries
`roles/editor`. The argument is sound and the design is the one we
want. It is just not in force by virtue of being written here.

## A first apply must import before it can converge

Correct targeting is not the same as being applied. Most of what this
root declares already exists in `ext-interns-spawner-000`, created by
hand and absent from Terraform state, so a bare `terraform apply` fails
with "already exists" rather than converging. Import first.

Verified present 2026-08-21 — names match what is declared, so these
import cleanly. PLA-845 removed two of them from the declaration
(`google_project_iam_custom_role.intern-vm-self-cleanup` and
`google_service_account_iam_member.intern-vm-can-actas-self`), so they
are deliberately absent below even though both are still bound live in
`ext-interns-spawner-000` — see the PLA-845 section for the `gcloud`
commands that revoke them:

```bash
P=ext-interns-spawner-000
SA="intern-vm@$P.iam.gserviceaccount.com"

terraform import google_service_account.intern-vm \
  "projects/$P/serviceAccounts/$SA"
terraform import google_project_iam_member.intern-vm-log-writer \
  "$P roles/logging.logWriter serviceAccount:$SA"
terraform import google_service_account_iam_member.provisioner-can-attach-intern-vm-sa \
  "projects/$P/serviceAccounts/$SA roles/iam.serviceAccountUser serviceAccount:intern-provisioner@$P.iam.gserviceaccount.com"

terraform import google_compute_network.interns "projects/$P/global/networks/interns"
terraform import google_compute_subnetwork.interns-us-central1 \
  "projects/$P/regions/us-central1/subnetworks/interns-us-central1"
terraform import google_compute_router.interns-us-central1 \
  "projects/$P/regions/us-central1/routers/interns-us-central1"
terraform import google_compute_router_nat.interns-us-central1 \
  "$P/us-central1/interns-us-central1/interns-us-central1"
terraform import google_compute_firewall.interns-allow-iap-ssh \
  "projects/$P/global/firewalls/interns-allow-iap-ssh"
terraform import google_compute_firewall.interns-deny-all-internal \
  "projects/$P/global/firewalls/interns-deny-all-internal"

# Created by hand 2026-08-21 to end the ORI-1291 outage — see
# intern-provisioning-logs-bucket.tf. Do NOT resolve an "already exists"
# here by deleting the bucket; that restores the outage.
terraform import google_storage_bucket.intern_provisioning_logs \
  "$P/intern-provisioning-logs"
terraform import google_storage_bucket_iam_member.intern_provisioning_logs_provisioner \
  "b/intern-provisioning-logs roles/storage.objectAdmin serviceAccount:intern-provisioner@$P.iam.gserviceaccount.com"
terraform import google_storage_bucket_iam_member.intern_provisioning_logs_engineering \
  "b/intern-provisioning-logs roles/storage.admin group:engineering@openrouter.ai"

# Created by hand 2026-08-24 for ORI-1444 — see
# intern-workspace-archives-bucket.tf. The bucket is named
# `intern-workspace-archives` and not `intern-archives` because the latter is
# taken in the GLOBAL GCS bucket namespace by another org; the Postgres table
# is still `intern_archives`.
terraform import google_storage_bucket.intern_workspace_archives \
  "$P/intern-workspace-archives"
terraform import google_storage_bucket_iam_member.intern_workspace_archives_provisioner \
  "b/intern-workspace-archives roles/storage.objectAdmin serviceAccount:intern-provisioner@$P.iam.gserviceaccount.com"
terraform import google_storage_bucket_iam_member.intern_workspace_archives_engineering \
  "b/intern-workspace-archives roles/storage.admin group:engineering@openrouter.ai"
```

`var.provisioner_sa_email` has no default on purpose; pass
`-var "provisioner_sa_email=intern-provisioner@ext-interns-spawner-000.iam.gserviceaccount.com"`.

What is NOT imported is what does not exist yet, so the first plan
should show exactly these as creates — the drift rows in the table
below, and nothing else:

- `google_project_iam_member.intern-vm-metric-writer`
- `google_project_iam_member.engineering-iap-tunnel`
- `google_project_iam_member.engineering-os-login`

**A create outside that list means the import set is incomplete — stop
and reconcile rather than applying.** And read the apply checklist in
`audit-logs.tf` before every apply: that resource is authoritative for
its `(project, service)` pair and a careless plan silently drops
out-of-band `exempted_members`.

The unmanaged hand-made firewall rules in the table below
(`vault-host-allow-*`, `test-intern-allow-*`,
`allow-agent-vault-from-test-interns`) are NOT declared here and are
not touched by an apply; they are listed so nobody mistakes them for
drift this root introduced.

## Evidence

Verified 2026-08-19 with `gcloud` as `david.bowman@openrouter.ai`.

Kept as the record of *why* the providers were repointed on 2026-08-21.
The first item below is now historical: the SA this root declares is no
longer the `openrouter-core` one. Everything after it still describes
the live project and is current.

**The SA this root used to declare did not exist.**

```
$ gcloud iam service-accounts describe intern-vm@openrouter-core.iam.gserviceaccount.com
ERROR: NOT_FOUND: Unknown service account
```

That is genuine absence, not a permissions mask. The control case is a
service account that certainly does exist in the same project:

```
$ gcloud iam service-accounts describe terraform-apply@openrouter-core.iam.gserviceaccount.com
ERROR: PERMISSION_DENIED: Permission 'iam.serviceAccounts.get' denied on
       resource '//iam.googleapis.com/projects/-/serviceAccounts/116042835977352959732'
```

GCP resolved the existing account to a numeric id and *then* denied.
For `intern-vm@openrouter-core` it could not resolve the name at all.

**The state bucket does not exist**, so no apply has ever run:

```
$ gcloud storage buckets describe gs://tfstate-cfw-intern-provisioner-infra-openrouter-ai
ERROR: gs://tfstate-cfw-intern-provisioner-infra-openrouter-ai not found: 404.
```

Same control: `gs://tfstate-mission-control-infra-openrouter-ai` returns
`storage.buckets.get denied` — resolvable but restricted. This one is a
clean 404.

**No CI plans or applies this root.** The Terraform workflows in
`.github/workflows` cover `projects/mission-control/infra` and
`configs/terraform-monitors`. `apply-cloudrun-terraform.yaml` is a
manual `workflow_dispatch` that derives `services/<name>/infra`, but
this root already declares `provisioner_sa_email` with no default, so a
dispatch fails on the missing variable rather than applying. Nothing
has ever produced a plan diff here, which is why the project mismatch
went unnoticed.

**The whole directory landed in one commit** — `8520c18db31`, merged as
[#34552](https://github.com/OpenRouterTeam/openrouter-web/pull/34552),
whose title is an unrelated synapse feature. It was never reviewed as
infrastructure.

## Where the SA email actually comes from

`src/clients/gcp-instance.ts` builds it from the credential, not from a
constant:

```ts
email: `intern-vm@${input.projectId}.iam.gserviceaccount.com`,
```

`input.projectId` traces back through `steps/create-gcp-vm.ts`
(`projectId: account.projectId`) to `clients/gcp-auth.ts`, which reads
`project_id` off the `INTERN_GCP_SERVICE_ACCOUNT_JSON` secret. **The
intern SA therefore always lives in whatever project the provisioner's
credential points at.** It can never be `openrouter-core` unless that
credential is reissued there.

The service-root `AGENTS.md` states the same thing from the ops side:
there is one GCP project, `ext-interns-spawner-000`, holding production
interns and local-run interns alike, with no sandbox.

Confirmed against running instances — all eight provisioner-created
VMs attach the spawner-project SA:

```
$ gcloud compute instances describe intern-comet-ca92bff4ae4d \
    --project=ext-interns-spawner-000 --zone=us-central1-a \
    --format='value(serviceAccounts)'
{'email': 'intern-vm@ext-interns-spawner-000.iam.gserviceaccount.com',
 'scopes': ['https://www.googleapis.com/auth/cloud-platform']}
```

## Live vs declared

State of `ext-interns-spawner-000` on 2026-08-19, against what this
root declares.

| Declared here | Live in `ext-interns-spawner-000` | |
|---|---|---|
| SA `intern-vm`, display name "Intern VM runtime" | exists, same display name | matches |
| `roles/logging.logWriter` | bound | matches |
| ~~custom role `internVmSelfCleanup`~~ — no longer declared (PLA-845) | **exists** (`compute.instances.get`, `compute.instances.setMetadata`), and every intern still holds it | **revoke by hand** |
| ~~`intern-vm` actAs self (`roles/iam.serviceAccountUser`)~~ — no longer declared (PLA-845) | **bound** | **revoke by hand** |
| provisioner actAs `intern-vm` | bound to `intern-provisioner@ext-interns-spawner-000` | matches |
| VPC `interns` + subnet `interns-us-central1` (10.79.0.0/16, PGA on, 100% flow logs) | exists, identical | matches |
| Cloud Router/NAT `interns-us-central1` | exists | matches |
| firewall `interns-allow-iap-ssh`, `interns-deny-all-internal` | exist | matches |
| **`roles/monitoring.metricWriter`** | **not bound** | **drift** |
| **`roles/iap.tunnelResourceAccessor` for `engineering@`** | **not bound** | **drift** |
| **`roles/compute.osLogin` for `engineering@`** | **not bound** | **drift** |
| bucket `intern-provisioning-logs` | exists since 2026-08-21, created by hand, **not in TF state** | **unmanaged** |
| bucket `intern-workspace-archives` | exists since 2026-08-24, created by hand for ORI-1444, **not in TF state**. Config and both IAM bindings match what is declared, so the three imports above apply cleanly | **unmanaged** |
| — | extra hand-made firewall rules: `vault-host-allow-iap-{ssh,api}`, `test-intern-allow-iap-chat{,-forward}`, `allow-agent-vault-from-test-interns` | unmanaged |

Someone replicated this design into the right project faithfully but
not completely. The gaps are real operational bugs:

- **No `monitoring.metricWriter`** means the Ops Agent's metric push is
  being rejected on every live intern VM. Logs work; metrics do not.
- **No `iap.tunnelResourceAccessor` / `compute.osLogin` for
  `engineering@`** — the project has *no* bindings for either role at
  all. Operator break-glass SSH over IAP, which `firewall.tf` opens the
  path for, is not granted to the engineering group. Individual owners
  (`roles/owner`) can still get in.
- **`intern-provisioning-logs` did not exist**, while `src/env.ts`
  defaults `INTERN_LOGS_GCS_BUCKET` to exactly that name. This was
  chased down: it was a live outage, not a cosmetic gap. Every
  provisioning-log append had been 404ing — 397 warnings in the 30 days
  to 2026-08-21, 100% of appends — so the `/interns` dashboard rendered
  an empty sequence while runs reported success (ORI-1291). The bucket
  was created by hand on 2026-08-21 and appends resumed in the same
  minute. It is **not** in Terraform state; see the import block at the
  top of `intern-provisioning-logs-bucket.tf` before applying this root.

  The row above was the one drift finding that turned out to be
  customer-visible. The audit called it "adjacent to this file's scope
  and not chased down" — worth remembering that a drift row reading as
  a tidy-up can be an outage nobody has noticed yet.

### Tracking

Searched Linear 2026-08-19, including closed and cancelled issues. The
three drift rows above are in three different states, which is worth
knowing before filing anything:

- **`monitoring.metricWriter`** —
  [ORI-541](https://linear.app/openrouter/issue/ORI-541/intern-vm-service-account-missing-roleslogginglogwriter-cloud-logging)
  is the closest ticket and it was **cancelled on 2026-08-14** without
  being worked (Backlog → Canceled, never started). It covered the
  sibling role, `logging.logWriter`, and its proposed fix was verbatim:
  "Grant `roles/logging.logWriter` to the intern VM service account,
  ideally in the provisioner's Terraform
  (`services/cfw-intern-provisioner/infra/`) so it's persistent and
  reviewed, rather than a one-off `gcloud` grant." The role was granted
  by hand — it is bound live — and the Terraform half never happened.
  That Terraform half is this directory. So ORI-541 was cancelled with
  its stated remedy unimplemented, and its sibling role is still
  unbound. **Not reopened from a docs PR; needs a human decision.**
- **IAP roles for `engineering@`** — no ticket anywhere, open or
  closed. Currently untracked.
- **`intern-provisioning-logs` bucket** — **resolved 2026-08-21.** It
  was not merely "a candidate root cause" for
  [ORI-1291](https://linear.app/openrouter/issue/ORI-1291/fix-the-dropped-provisioning-log-appends-so-the-dashboard-shows-the)
  but the whole of it: Datadog showed 397 consecutive
  `GCS put failed: 404 The specified bucket does not exist` warnings,
  every boundary of every run. Creating the bucket fixed it with no
  deploy, because the already-deployed worker writes fine once the
  bucket is there. #35768 shipped the visibility half (a
  `bucket_missing` outcome, a StatsD counter, a 503 instead of a
  misleading 404, and two monitors). The remaining half of ORI-1222 is
  the health probe, tracked separately.

The cross-tenant metadata surface `iam.tf` used to document is
[PLA-845](https://linear.app/openrouter/issue/PLA-845/isolate-intern-vm-metadata-permissions-per-tenant),
addressed in code — see the PLA-845 section below for the manual
revokes it still needs.

### PLA-845: intern VMs hold no compute-API permission in code

[ORI-1308](https://linear.app/openrouter/issue/ORI-1308) deleted
`google_project_iam_member.intern-vm-self-cleanup` from `iam.tf` and
moved the grant into a runtime binder that wrote a per-instance
conditional binding at VM-create time. That binder is gone:
per-instance conditions cannot isolate a SHARED principal, and every
intern VM attaches the same `intern-vm` SA, so intern A satisfied
intern B's condition and could read and overwrite B's instance
metadata.

PLA-845 removed the VM's need for the permission instead of trying to
scope it:

- the binder module and the `internVmSelfCleanup` custom role are gone
  from code, and so is the `intern-vm` actAs-on-self binding;
- nothing on the VM calls the Compute Engine API any more — the worker
  strips bootstrap metadata itself after the health poll (and strips the
  wider partial-failure key set when provisioning throws);
- the runtime-image reconcile reports its outcome by POSTing to
  `/api/v1/interns/vm-report`, authenticated by the VM's GCE instance
  identity token, and the worker performs the metadata write with its
  own credential.

This is the one place where the trap this file exists to name has real
teeth:

> The Terraform deletions revoke nothing. All three grants are bound by
> hand in `ext-interns-spawner-000` and have to be removed there,
> AFTER the worker deploy that removes the VM-side callers.

The outstanding manual steps, spelled out in the PLA-845 comment block
in `iam.tf`, are:

1. `gcloud projects remove-iam-policy-binding ext-interns-spawner-000
   --member=serviceAccount:intern-vm@… --role=projects/ext-interns-spawner-000/roles/internVmSelfCleanup`
2. `gcloud iam roles delete internVmSelfCleanup --project ext-interns-spawner-000`
3. `gcloud iam service-accounts remove-iam-policy-binding
   intern-vm@ext-interns-spawner-000.iam.gserviceaccount.com
   --member=serviceAccount:intern-vm@… --role=roles/iam.serviceAccountUser`

Until an operator runs them, every intern still holds
`compute.instances.get` + `setMetadata` on every other intern's VM,
regardless of what `iam.tf` says. Two things this does not close even
once they are run: bootstrap secrets still transit instance metadata
during boot, and existing VMs keep whatever bindings were already
written until they are recreated.

## Security finding: two VMs run as the default Compute Engine SA

The blast radius `iam.tf` warns about is real and present in this
project, just not via the interns the provisioner creates.

`9996949668-compute@developer.gserviceaccount.com` holds
**`roles/editor`** on `ext-interns-spawner-000`, and two long-lived VMs
are attached to it with `cloud-platform` scope:

| VM | Tag | Machine | Created |
|---|---|---|---|
| `test-intern` | `intern-vm` | e2-standard-2 | 2026-05-28 |
| `agent-vault-host-poc` | `vault-host` | e2-micro | 2026-05-28 |

Both carry no instance metadata, so neither was created by the
provisioner — they are hand-made PoC boxes from May, still running
three months later on the `interns` subnet. `test-intern` is tagged
`intern-vm`, so the IAP-SSH firewall rule targets it.

Scope plus role means code on either box has project-wide editor: it
can read every other intern VM's metadata (including bootstrap secrets
that have not yet been stripped), delete intern VMs, and push to the
Artifact Registry repo every intern pulls its runtime from. That is
strictly worse than the cross-tenant window `iam.tf` already documents
as "MUST land before the first production tenant".

To be clear about what is *not* wrong: the eight provisioner-created
`intern-*` VMs are fine. They attach the dedicated SA, and that SA holds
`logging.logWriter` plus the (now undeclared, still live) self-cleanup
custom role — **narrower** than this root intends, not broader. The provisioner is doing the right
thing. The exposure is the two hand-made VMs.

## The open question

Which project owns the intern stack, and does this root adopt it?

This is not answerable from the repo, and it was deliberately not
guessed at in the change that added this file. Retargeting the provider
to `ext-interns-spawner-000` is a one-line edit that does not work:

1. **Every resource already exists.** An apply would fail on
   `already exists` for the SA, the provisioner actAs binding,
   the VPC, the subnet, the router, the NAT, and both firewall rules.
   Adoption means `terraform import` for each, plus decisions about the
   five unmanaged firewall rules and the two PoC VMs.
2. **No state bucket.** `module "tfstate-bucket"` would have to be
   applied with local state first, as a bootstrap.
3. **No identity can apply it.** Per the bootstrap note in
   `ci/infra/gcp-ori-runtime-image.tf`, `terraform-apply@openrouter-core`
   was granted `roles/artifactregistry.admin` on the `interns`
   *repository* only, and "has no other reach into
   `ext-interns-spawner-000`". Creating service accounts, custom roles,
   and project IAM bindings there needs grants that do not exist yet.

Note that `ci/infra/gcp-ori-runtime-image.tf` — added the day after this
directory — already describes the interns project as one "no Terraform
in this repo manages", and treats
`intern-vm@ext-interns-spawner-000` + its `artifactregistry.reader`
binding as hand-made siblings it deliberately does not adopt. That file
and this one currently disagree about who manages the intern SA. This
directory is the one that is wrong.

Three ways out, in rough order of how much they cost:

- **Adopt.** Point this root at `ext-interns-spawner-000`, import the
  existing resources, provision an apply identity, close the drift rows
  above. Highest value, needs a project owner and a rollout plan.
- **Delete.** If the intern stack is going to stay hand-managed, drop
  this directory rather than leave a security-shaped file that controls
  nothing. Cheapest, loses the written rationale.
- **Leave and label.** What the change adding this file did — the root
  stays unapplied but no longer misrepresents itself.

Until one is chosen, treat every `.tf` file here as a design document.
