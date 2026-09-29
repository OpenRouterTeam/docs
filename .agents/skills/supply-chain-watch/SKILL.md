---
name: supply-chain-watch
description: >-
  Weekly flag-only supply-chain hygiene scan for dependency lifecycle scripts,
  GitHub Actions workflows, and patched dependencies. Posts findings to
  #alerts-code-scans and files SEC Linear tickets without auto-remediation.
  Use for the scheduled or on-demand supply-chain watch automation.
---

# Supply-Chain Watch

Run a weekly, flag-only supply-chain hygiene scan for this monorepo. The scan
posts findings to Slack `#alerts-code-scans` and files SEC Linear tickets.
Never auto-remediate, spawn child PRs, or treat findings as dependency bumps.

This scope was split out of CVE Watch in PR #29989. Deep review remains in
on-demand `!vulnscan`.

## Checks

### Lifecycle install scripts

```bash
bun .agents/skills/supply-chain-watch/scripts/scan-lifecycle-scripts.ts
```

The scanner enumerates installed package manifests and emits one NDJSON
finding per `preinstall`, `install`, or `postinstall` script. It reports Bun's
`trustedDependencies` model. `bun pm untrusted` is the corresponding Bun
inspection command. The policy for when a `trustedDependencies` entry may be
added at all lives in `AGENTS.md` → Style Principles; treat findings that an
entry fails that bar (no genuine install-time build step) as prune candidates.

### GitHub Actions hygiene

```bash
bun .agents/skills/supply-chain-watch/scripts/scan-actions-supply-chain.ts
```

The scanner emits one NDJSON finding per mutable action reference,
unsafe `pull_request_target` checkout, untrusted `github.event` interpolation
in a `run` step, or broad top-level permissions.

### Patches review

Without a script, enumerate `package.json#patchedDependencies` and every
`patches/*.patch`. Identify each patch's pinned dependency version, compare it
with the latest upstream version, and flag pins that lag upstream security
fixes. Record each patch's apparent purpose from its filename and context.

## Triage and reporting

Diff findings against the prior run using `#alerts-code-scans` thread history.
Surface new findings in the channel and file SEC Linear tickets. Findings are
flag-only. Never auto-remediate or spawn child PRs.

Cc `@core` only for high-severity findings, especially unsafe
`pull_request_target` checkout or a newly added untrusted `postinstall` script.
Use `S09JM6B39TL` as `<!subteam^S09JM6B39TL|@core>`; if it does not resolve,
omit the cc line silently rather than surfacing Slack API state.

### Slack transport

Post through the Slack MCP tools as `Devin MCP` (`U0A78R4TWGM`), the identity
CVE Watch posts under, to channel ID `C0AGV547FD0`. Never post through another
bot token. Read every post back, and if no transport is available, stop and
surface the failure.

`Devin MCP` is not the Devin Slack app (`U076RQCCF2P`) that listens in the
channel, so it satisfies the recursive-trigger guard. Posts carry no Devin
footer and no Devin bot mention: a post that mentions the listening app spawns
a duplicate session in the same thread.

## Scripts

The TypeScript scanners use Bun and emit newline-delimited JSON. Run their
colocated tests with:

```bash
bun test ./.agents/skills/supply-chain-watch/scripts/scan-lifecycle-scripts.test.ts ./.agents/skills/supply-chain-watch/scripts/scan-actions-supply-chain.test.ts
```
