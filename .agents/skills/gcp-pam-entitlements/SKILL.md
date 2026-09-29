---
name: gcp-pam-entitlements
description: Get temporary GCP access through Privileged Access Manager (PAM) instead of a standing IAM grant. Covers how to recognize a PAM case from a permission denial, how to add an entitlement in openrouter-infra, how to add the standing resource it targets in openrouter-web, and how to request, approve, and use a grant.
user-invocable: true
---

# GCP PAM Entitlements

Use this skill when a `gcloud` command or API call in `openrouter-core`
fails with `PERMISSION_DENIED` and the work is short-lived. A PAM grant binds
a role to a principal for a bounded time. A standing IAM binding does not
expire. Prefer PAM for production reads, debugging, and one-off operations.

## Recognize a PAM case

1. Run the command as the identity you already hold.
2. Read the denial. It names the permission, the resource, and the identity.
3. If the identity is `devin-observer@openrouter-core.iam.gserviceaccount.com`, stop. PAM entitlements for Devin name the Workload Identity Federation pool, not this service account. See "Use the federated identity".
4. Search `openrouter-infra` `terraform/pam/projects/<project-id>.yaml` for the entitlement IDs the project selects, then read each selected catalog entry under `terraform/pam/entitlements/`. The effective `condition` is the mapping's when the catalog entry has none. Match on the effective condition, the role or permissions, and a `requesters` entry that covers your identity.
5. If one matches, go to "Request a grant".
6. If none exists, go to "Add an entitlement".

## Use the federated identity

Devin sessions hold two identities. The default `gcloud` configuration
impersonates `devin-observer`. The PAM requester is the session's federated
principal in the `devin` pool. The pool and provider are owned by
`openrouter-infra` under `terraform/root`.

1. Copy the OIDC credential file without the impersonation URL. Keep it readable only by the current user. The source is the credential file the Devin platform provisions at `/etc/devin-oidc/gcp-credentials.json` on session VMs with GCP federation enabled; if it is missing, the session has no federated identity and PAM is unavailable. The copy lives under `$HOME`; `DEVIN_OIDC_DIR` is a name this skill introduces so the later steps and the cleanup agree on the path.
   ```bash
   export DEVIN_OIDC_DIR="$HOME/.devin-oidc"
   mkdir -p "$DEVIN_OIDC_DIR" && chmod 700 "$DEVIN_OIDC_DIR"
   python3 -c 'import json,os;c=json.load(open("/etc/devin-oidc/gcp-credentials.json"));c.pop("service_account_impersonation_url",None);json.dump(c,open(os.environ["DEVIN_OIDC_DIR"]+"/gcp-wif-direct.json","w"))'
   chmod 600 "$DEVIN_OIDC_DIR/gcp-wif-direct.json"
   ```
2. Log in to a separate `gcloud` configuration. `GOOGLE_APPLICATION_CREDENTIALS` switches Google client libraries to the same identity.
   ```bash
   export GOOGLE_EXTERNAL_ACCOUNT_ALLOW_EXECUTABLES=1 CLOUDSDK_CONFIG="$DEVIN_OIDC_DIR/gcloud" GOOGLE_APPLICATION_CREDENTIALS="$DEVIN_OIDC_DIR/gcp-wif-direct.json"
   gcloud auth login --cred-file="$DEVIN_OIDC_DIR/gcp-wif-direct.json" --quiet
   ```
3. List the entitlements this identity can request.
   ```bash
   gcloud beta pam entitlements search --location=global --project=openrouter-core --caller-access-type=grant-requester
   ```
4. Keep `CLOUDSDK_CONFIG` and `GOOGLE_APPLICATION_CREDENTIALS` set for every PAM command and for the command that uses the grant.

## Add an entitlement

The PAM registry lives in `openrouter-infra` under `terraform/pam/`. Read
`terraform/pam/README.md` and `terraform/pam/entitlements/README.md` first.
The stack uses OpenTofu, not Terraform.

The registry has two layers. `entitlements/*.yaml` is a shared catalog of
target-less definitions. `projects/<project-id>.yaml` selects catalog IDs for
one project and may narrow `requesters`, `approvers`, `approvals_needed`,
`max_duration`, or `notify`, and may add a `condition` when the catalog entry
has none. A mapping cannot widen anything or change roles.

1. Add the standing resource first. A PAM grant binds a role. It does not create the role target. Add database roles, log views, and similar resources in the owning repository, together with any standing binding the temporary role depends on. For usage-record, that is `services/usage-record/infra` in this repository.
2. Read the whole catalog before adding to it. If an existing entry already grants the role or permissions and its `requesters` include the identity that needs access, reuse it: add its ID to the project mapping, or narrow it there. A mapping cannot add a requester the catalog entry excludes. If the population differs, add a separate catalog entry for it rather than widening the existing entry, since every project that selects the entry inherits its requesters.
3. For a new entry, create `terraform/pam/entitlements/<id>.yaml` with `id`, `description`, `max_duration`, `requesters`, `approvers`, `approvals_needed`, `require_justification: true`, and one of `roles` or `custom_role_permissions`. Prefer `custom_role_permissions` when a predefined role grants more than the task needs. Every grant must be on the allowlist in the registry test under `terraform/pam/` or carry a `waiver`.
4. Choose `requesters` by who runs the command. Humans use `group:engineering@openrouter.ai`. Devin sessions use one `principalSet://` entry for one Workload Identity Federation population, selected by `attribute.org_id`. The pool and provider are owned by `openrouter-infra` under `terraform/root`. Pool-wide `/*` and `principal://.../subject/...` forms are rejected.
5. Choose `approvers` by sensitivity. Read roles on non-sensitive data may omit approvers and auto-approve. Anything else needs `group:eng-platform@openrouter.ai` or `group:engineering@openrouter.ai` with `approvals_needed: 1` or more. The registry tests force at least one approval only for grants that are off the allowlist or outside project scope. An allowlisted write role with no approvers passes the tests, so PR review is the only check on that choice.
6. Add a `condition` when the role can be pinned to resources. Name exact resource paths so a new instance or database must be added deliberately.
7. Add the `id` to `terraform/pam/projects/<project-id>.yaml`. Add a comment to the catalog entry that explains what the grant reaches and why the requester population is what it is.
8. Validate the stack.
   ```bash
   cd terraform/pam
   tofu init -backend=false
   tofu fmt -check -recursive
   tofu validate
   pytest tests -v
   ```
9. If the tests reject a role or permission, read the test name. The registry bans owner, editor, and admin roles, `setIamPolicy`, `iam.serviceAccounts.actAs`, and any grant that is neither allowlisted nor waived.
10. Open a PR in `openrouter-infra`. After merge, confirm the apply of the `pam` stack before you request a grant.

## Request a grant

1. Request the grant as a principal the entitlement's `requesters` names. A Devin session uses the federated identity from "Use the federated identity". A human uses their own `gcloud auth login` identity in the default configuration, with no `CLOUDSDK_CONFIG` override. Every command below runs as that same principal.
   ```bash
   gcloud beta pam grants create --entitlement=<id> \
     --location=global --project=openrouter-core --requested-duration=<seconds>s \
     --justification="<what you are doing> <Devin session URL>"
   ```
2. Read the `state` in the create output. An entitlement with no approvers auto-approves, so the grant is already `ACTIVE`; skip to step 5. Otherwise the state is `APPROVAL_AWAITED`.
3. Tell an approver the grant ID. Approvers are listed in the entitlement file.
4. The approver runs the approval.
   ```bash
   gcloud beta pam grants approve <grant-id> --entitlement=<id> \
     --location=global --project=openrouter-core --reason="<reason>"
   ```
5. Poll the state as the requester. `grants describe` is denied to the requester.
   ```bash
   gcloud beta pam grants search --entitlement=<id> --location=global \
     --project=openrouter-core --caller-relationship=had-created
   ```
6. When the state is `ACTIVE`, run the command that failed.

## Use the grant

- A grant ends after `max_duration`. Request a new grant when it ends. Do not ask for a standing binding instead.
- Keep `CLOUDSDK_CONFIG` pointed at the federated configuration. The default configuration still uses `devin-observer`.
- When the work is done, return to the default identity and remove the federated configuration and the credential copy.
  ```bash
  unset CLOUDSDK_CONFIG GOOGLE_APPLICATION_CREDENTIALS GOOGLE_EXTERNAL_ACCOUNT_ALLOW_EXECUTABLES
  rm -rf "$DEVIN_OIDC_DIR" && unset DEVIN_OIDC_DIR
  ```

## Related skills

- `dataflow-staging-experiment` uses the `spanner-sys-observer` entitlement to read production `SPANNER_SYS`. Spanner-specific usage of a grant, such as the `--database-role` flag, lives there.
