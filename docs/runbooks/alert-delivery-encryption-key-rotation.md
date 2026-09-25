# Alert Delivery Encryption Key Rotation Runbook

Procedure for rotating `ALERT_DELIVERY_ENCRYPTION_KEY` and retiring the key it
replaces. The ordering matters: the previous key may only be retired once a
measurement shows that no stored row still depends on it.

This runbook describes the rotation path as it works on `main`. Decision history
lives in Git and Linear, not here.

- **Secrets:** `/services/alert-delivery/ENCRYPTION_KEY`,
  `/services/alert-delivery/ENCRYPTION_KEY_PREVIOUS` (also set on the
  `cfw-frontend-api` Worker, which encrypts on settings saves)
- **Table:** `alert_delivery_endpoint` (`signing_secret`,
  `endpoint_url_encrypted`, `endpoint_url_fingerprint`)
- **Script:** `scripts/reencrypt-alert-delivery-secrets.ts`
- **Monitor:** `[Alert Delivery] Encryption key fingerprint mismatch`

## What the two keys do

Reads try `ALERT_DELIVERY_ENCRYPTION_KEY` first and
`ALERT_DELIVERY_ENCRYPTION_KEY_PREVIOUS` second; every write uses the current
key. A new key can therefore be introduced without downtime and without a
coordinated deploy: rows written before the rotation stay readable through the
previous key until the re-encrypt job walks them onto the current one.

Envelope versions identify the format generation, not the key used to encrypt a
row. `v1` is the previous envelope format, `v2` is the current format, and
unversioned rows predate envelope versioning. For every recognized version,
decryption tries the current key and then the previous key, with AEAD
authentication identifying the key that encrypted the row.

Endpoint URL fingerprints are keyed HMACs, so they change with the key and
cannot be probed by AEAD. Settings saves match existing rows against
fingerprints from both keys and rewrite the URL envelope and fingerprint under
the current key in the same transaction. A save during rotation keeps the
endpoint row and its `whsec_` signing secret and does not mint a new secret.

The residual count is what turns "the job was run" into "the job finished". It
counts endpoint rows holding at least one encrypted value that the current key
cannot read, or whose URL fingerprint does not match a current-key recompute.
A row with a fingerprint but no decryptable URL envelope is unreadable. The
re-encrypt script logs the residual count with `scanned_rows`, `residual_rows`
and `unreadable_rows`.

There is no standing residual monitor. The rotation guarantee comes from
re-running the script until the residual count reaches zero, which step 7
below treats as the gate.

## Pre-flight the previous-key slot

Run this once before the first real rotation, and again after any change to the
secret wiring. It proves the previous-key path is live while no stored row
depends on it yet.

1. **Set `ENCRYPTION_KEY_PREVIOUS` to a copy of the current key** on both alert
   delivery and `cfw-frontend-api`. Both slots holding the same key leaves
   reads, writes and fingerprints unchanged, so the only thing under test is
   the secret plumbing.

2. **Apply the Cloud Run configuration and deploy a revision.** A missing IAM
   accessor or a missing environment block fails here, where the failure costs
   a revision rather than the readability of every stored row.

3. **Confirm both consumers see both slots.** `alert-delivery-key-fingerprint`
   reports `key_sha256_prefix` and, when a
   previous key is configured and parses, `previous_key_sha256_prefix`. During
   the pre-flight those two prefixes are equal on both alert delivery and
   `cfw-frontend-api`, which is the direct evidence that the previous-key
   variable reached the process. An absent `previous_key_sha256_prefix`, or an
   `alert-delivery.previous-encryption-key-invalid` warning, means the slot is
   not wired. Also confirm the residual count is zero. With one key in both
   slots, a non-zero residual count means a row was already unreadable before
   the rotation started, and that must be repaired first.

4. **Leave the copy in place** until the real rotation replaces it. It is
   inert: every read that the current key satisfies never consults the second
   slot.

## Rotate

1. **Generate the new key.** 32 random bytes, base64-encoded.

2. **Introduce it as current and keep the outgoing key as previous.** Set
   `ENCRYPTION_KEY` to the new key and `ENCRYPTION_KEY_PREVIOUS` to the
   outgoing one, in the same change, for both alert delivery and
   `cfw-frontend-api`. Never set the new key without also setting the previous
   key: existing rows become unreadable the moment the old key leaves the ring.

3. **Expect no previous-key configuration change.** Both manifest entries are
   permanent, `ENCRYPTION_KEY_PREVIOUS` under `/services/alert-delivery` and
   `ALERT_DELIVERY_ENCRYPTION_KEY_PREVIOUS` under `/services/cfw-frontend-api`,
   so no manifest change belongs in a rotation. The `secret_key_ref`
   environment block, per-secret accessor, and Cloud Run `depends_on` entry
   for `ALERT_DELIVERY_ENCRYPTION_KEY_PREVIOUS` in
   `services/alert-delivery/infra/cloudrun.tf` and `iam.tf` are permanent
   too, so no Terraform change belongs in a rotation either.

4. **Apply the Cloud Run configuration.** Run `apply-cloudrun-terraform` for
   alert delivery, then deploy a new revision so both keys are live before
   starting re-encryption. New writes use the current key while old rows
   remain readable through the previous key.

5. **Confirm both consumers see the new key.** Wait for
   `alert-delivery-key-fingerprint` from both services to report the same
   `key_sha256_prefix`, and for
   `[Alert Delivery] Encryption key fingerprint mismatch` to be green. A
   mismatch here means one consumer is still writing under the old key, and
   re-encryption cannot converge while that is true. After a real rotation,
   `previous_key_sha256_prefix` should equal the outgoing key's prefix and
   differ from `key_sha256_prefix`, which is the positive confirmation that the
   outgoing key is still on the ring.

6. **Re-encrypt until clean.**

   ```bash
   bun run scripts/reencrypt-alert-delivery-secrets.ts
   ```

   The script writes each row under a compare-and-swap guard on the values it
   read, so a concurrent settings save is never clobbered — it is reported
   instead. A rejected row is re-read and retried once; a row that still loses
   is counted as `skipped_conflict`, logged, and left for the next run. Re-run
   the script until `skipped_conflict` and `failed` are both zero. The script
   exits non-zero while either is non-zero, so a single run is not evidence of
   completion.

   Settings saves and endpoint matching stay correct throughout this window.
   The auto-disabled endpoint list compares stored fingerprints directly, so
   an endpoint re-added between the rotation and the backfill can still be
   listed as auto-disabled until the re-encrypt job runs.

7. **Confirm the residual count is zero.** The script logs
   `reencrypt-alert-delivery-secrets-residual` at the end of each run. It must
   report `residual_rows: 0` with a non-zero `scanned_rows`. A zero
   `scanned_rows` means nothing was measured, not that the rotation finished.
   The clean residual run is the rotation gate rather than
   `[Alert Delivery] Encryption key fingerprint mismatch`, which cannot answer
   this question. That monitor compares the key fingerprints reported by
   alert-delivery and `cfw-frontend-api`, which agree throughout a rotation
   done in this order, and it says nothing about how many rows still carry the
   old key. Its evaluation window also lags divergence by up to about 90
   minutes. On a rerun after the count is clean,
   `re_encrypted` should also be zero.

8. **Retire the previous key.** Only now replace the outgoing key in
   `ENCRYPTION_KEY_PREVIOUS` with a copy of the current key, on both alert
   delivery and `cfw-frontend-api`, which is the same inert state the
   pre-flight leaves behind. Leave the manifest entries and the Cloud Run and
   IAM blocks in place, so the next rotation needs no configuration change.
   Doing this while `residual_rows` is non-zero is silent until a delivery
   needs one of those rows, and then that alert fails with `decrypt_error`.

## When the count will not reach zero

**`skipped_conflict` stays non-zero.** A writer keeps winning the guard on the
same rows. Each run already retries a conflicted row once, so a number that
persists across runs means sustained writes, not a race — check for a settings
save loop or a backfill touching `alert_delivery_endpoint`, then re-run. Rows
saved by a concurrent writer are written under the current key anyway, so they
leave the residual count on their own.

**`failed` stays non-zero.** A row cannot be re-encrypted. `eLog`
`alert-delivery-secret-reencrypt-failed` names the endpoint and the offending
columns.

**`unreadable_rows` is non-zero.** Those rows hold an envelope that no key on
the ring can read, usually a truncated or hand-edited value. Re-encryption
cannot drain them, so they hold the residual count above zero indefinitely.
They need repair, not another run: the customer must re-save the endpoint,
which rewrites its secret and URL under the current key. Do not retire the
previous key while they remain, because a readable-under-previous row can be
hiding behind the same non-zero count.
