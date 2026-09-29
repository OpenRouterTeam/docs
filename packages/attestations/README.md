# Attestations

Shared definitions for the provider attestation gate — the source of truth
for what each attestation type means and how to validate configured values.

- **`@openrouter-monorepo/enums/attestations`** owns the identifiers
  (`AttestationType`, `AttestationSource`). This package owns their
  human-readable definitions.
- **`ATTESTATION_DEFINITIONS`** maps each `AttestationType` to its label and
  sign-off `statement`. Both the frontend
  interstitial/gate and the backend enforcement error read copy from here, so
  the wording has a single source of truth.
- **`partitionAttestationTypes`** validates the raw
  `text[]` values stored in `models.required_attestation_types`, separating
  known types from stale/typo'd ones.

The workflow for adding a new attestation type lives in `AGENTS.md`.
