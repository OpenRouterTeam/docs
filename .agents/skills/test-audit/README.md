# test-audit

Weekly audit of the `openrouter-web` test suites (unit, e2e, RTL).
Surfaces test drift, logic errors, optimization opportunities, coverage
gaps below 95 %, spelling errors, cognitive-load hot spots, and general
code-quality issues.

## Quick start

```bash
cd ~/repos/openrouter-web
bun install --frozen-lockfile

cd .agents/skills/test-audit/scripts
node --import tsx ./run-audit.ts \
  --repo ../../../.. \
  --top 5 \
  --output ../../../../.agents/reports/test-audit-$(date -u +%F).md
```

`tsx` is already a workspace dependency — no extra install needed.

See [SKILL.md](SKILL.md) for the full reference (audit categories,
flags, allow-lists, weekly cleanup-PR loop).

## What it covers

- Coverage gap detection from Bun `lcov.info` files or Vitest `coverage-summary.json` files
- Test-drift heuristics (`.only`, `.skip`, missing `expect()`,
  commented-out assertions)
- Inline-snapshot conversion candidates
- Slow-test detection from the vitest JSON reporter
- Spelling pass via `codespell`
- Cognitive-load heuristics (long blocks, deep nesting, many
  `expect()` per test)

## Schedule

A weekly Devin scheduled session runs the orchestrator with the
default `--top 5` cap. The flow is **report-first,
cleanup-on-approval** (see `SKILL.md` § 4):

- **Phase A (always runs):** generate the audit report and DM the
  schedule owner with the summary table + actionable findings.
  Phase A does **not** open a cleanup PR.
- **Phase B (only on explicit approval):** when the human asks for
  a cleanup PR — typically by replying to the DM or running a
  `/devin` follow-up — Devin opens a draft PR scoped to the safe
  auto-fix categories (test drift + spelling). Inline snapshots
  are deliberately excluded from the safe tier and only converted
  opportunistically when a higher-value fix already touches the
  same file (`SKILL.md` § 3).

This keeps Monday inboxes quiet by default and ensures every
cleanup PR is a human-curated batch rather than a noisy mechanical
sweep.
