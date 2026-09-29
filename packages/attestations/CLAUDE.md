# Attestations — agent guide

## Adding a new attestation type

1. Add the identifier to `AttestationType` in
   `packages/enums/attestations.ts`.
2. Add its entry (`label`, personal `statement`, and
   `organizationStatement`) to `ATTESTATION_DEFINITIONS` here. The
   `Record<AttestationType, …>` type makes this a compile-time requirement.

No migration, gate, or plugin change is needed — model requirements are set in
mission-control (`models.required_attestation_types`).
