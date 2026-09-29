# Differential enforcement gate

This directory is test-only. The candidate calls `getEffectiveGuardrail` and `canMakeGenerations` directly. Do not change production enforcement to accommodate the harness.

## Frozen reference

`legacy-reference.json` records outputs captured from commit `586685fea7b` with synthetic auth-shaped inputs. It is a golden data reference, not an executable copy importing live merge or budget helpers. Shared-helper changes can only change the candidate side.

Never regenerate or edit existing reference entries in later implementation PRs. Each entry also fingerprints its input; do not edit existing corpus cases or their fixture defaults to make the gate pass. Add new cases and independently reviewed reference entries when extending coverage. A missing reference is a failure. Bun's snapshot update flag cannot rewrite this file.

## Running and extending

Run `cd packages/guardrails && bun test ./differential`. CI runs this command unconditionally in the unit job, independently of affected-workspace filtering. This covers changes in `packages/guardrails`, `packages/db/auth`, `postgres/migrations`, and `packages/backfill`, as well as shared helpers.

`compareCandidate` accepts a candidate function, pins each fixture's UTC clock, clones the input, and compares every output field. The reporter prints the case, differing field, expected value, and actual value. The two deliberate regressions have both diagnostic assertions and `it.failing` gate tests.

## Corpus contract

Fixtures are synthetic, shaped from the current DB guardrail and auth spend types; they are not production captures. IDs, model names, custom patterns and spend are fabricated. The 21- and 527-model sizes reflect the RFC inventory. No credentials, customer identities, or prompt data are present.

The corpus covers all seven RFC Enforcement rows: allowlist intersection, exclusion union, ZDR/consent, content deduplication, PII precedence, moderation escalation/scope, and budgets. It also covers data-region intersection, every nonempty workspace/member/key combination, empty/null restrictions, deprecated fields, default/member/key rejection order, all reset intervals, exact boundaries, UTC rollovers, missing analytics, free requests, paid plugins, BYOK inclusion and separate member/key counters.

Selection fixtures model missing, inherit, explicit assignment, and opt-out for both subjects, with and without a copied subject-default row. The current candidate projects missing/inherit/opt-out to no explicit assignment and ignores the copied row, since neither new persistence nor a reader exists yet. The workspace floor still applies. These are resolver-input equivalence cases, not persistence/backfill integration tests. B2 and later candidates must consume these same identities, selection states, copied rows and spend inputs through their new resolution path; do not reimplement new selection semantics in the reference.

Budget comparisons include the allow/reject decision, HTTP status and exact error message. Counter selection is tested with distinct daily/weekly/monthly spend, both subjects independently, boundary pairs and deliberately high aggregate workspace spend. Unrelated credit gates are funded to keep the comparison focused on guardrail budgets. Tracing attributes and metrics are not part of the enforcement contract.
