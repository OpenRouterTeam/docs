---
name: add-partner-key
description: Add a new startup partner referral key — append to the hard-coded list, run tests, commit and push
user-invocable: true
---

# Add Partner Key

Add a new startup program partner referral key. These keys are used for attribution when startups apply — they do NOT grant credits directly.

## Trigger

BD requests a new partner key via Slack, e.g. `@Devin !add-partner-key KEY: ORxAcme-4K2M, Partner: Acme Ventures, Type: vc_accelerator`.

## Arguments

- `$KEY`: The referral key applicants will enter (matched case-insensitively, format: `ORx<Partner>-<4-char suffix>`). Examples: `ORxAntler-6J3R`, `ORxBrex-4Q7M`, `ORxHF0-5P9V`.
- `$PARTNER_NAME`: Human-readable partner name shown in Mission Control. Examples: `Antler`, `Brex`, `HF0`.
- `$PARTNER_TYPE`: The partner type, one of: `bootstrap`, `non_vc_partner`, `vc_accelerator`, `strategic`. See `PartnerKeyType` in `packages/db/startups/tiers.ts` for descriptions.

## Steps

### 1. Validate the inputs

- `$KEY` must be non-empty, follow the `ORx<Partner>-<suffix>` format, and contain only letters, digits, and hyphens.
- `$PARTNER_NAME` must be non-empty.
- If either is missing or malformed, ask the requester to clarify before proceeding.

### 2. Check for duplicates

Read `packages/db/startups/partner-keys.ts` and verify that `$KEY` does not already exist in the `PARTNER_KEYS` array (case-insensitive). If it does, reply that the key already exists and stop.

### 3. Add the new entry

Append a new object to the `PARTNER_KEYS` array in `packages/db/startups/partner-keys.ts`, just before the closing `] as const satisfies readonly PartnerKey[];`:

```ts
  {
    key: '$KEY',
    partnerName: '$PARTNER_NAME',
    type: '$PARTNER_TYPE',
  },
```

Maintain the existing formatting (2-space indent, trailing comma).

If reviewers should see a different credit tier pre-selected than the one the
partner's type implies, set the optional `reviewDefaultTier` field on that
entry, using the shared `StartupTier` constant from
`packages/db/startups/tiers.ts`. It affects only the tier the review modal
opens on. Tier grouping and filtering still follow `type`, so do not change
`type` to encode the exception.

### 4. Run tests

```bash
cd packages/db && bun run test startups/partner-keys.test.ts
```

Tests must pass. The existing tests validate lookup and case-insensitivity for other keys, so they should still pass. No new test is needed unless the key has unusual characters.

### 5. Run typecheck

```bash
cd packages/db && bun run typecheck
```

### 6. Commit and push

```bash
git add packages/db/startups/partner-keys.ts
git commit -m "feat: add partner key $KEY for $PARTNER_NAME"
git push
```

### 7. Confirm

Reply to the requester with: "Added `$KEY` for $PARTNER_NAME. It'll be live once the PR merges."

## File touched

| File | Change |
|------|--------|
| `packages/db/startups/partner-keys.ts` | Append entry to `PARTNER_KEYS` array |

## Example

Request: "Add partner key `ORxGreylock-7N3P` for Greylock Partners"

Diff:

```diff
   {
     key: 'ORxStripeAtlas-8T2V',
     partnerName: 'Stripe Atlas',
     type: 'non_vc_partner',
   },
+  {
+    key: 'ORxGreylock-7N3P',
+    partnerName: 'Greylock Partners',
+    type: 'vc_accelerator',
+  },
 ] as const satisfies readonly PartnerKey[];
```
