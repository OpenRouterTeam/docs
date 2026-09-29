# Automation prompt mirrors

The scanner automations — Sleeper Scanner, Recent Signups Scanner, Autobuy Scanner, Leaked Key Scanner, and the Anthropic Concentration Monitor — are Devin automations whose `start_session` prompts live in Devin, outside this repository. Each prompt is a thin wrapper that references [`SCANNER_SPEC.md`](../SCANNER_SPEC.md) by path and fetches it from `main` at run start.

This directory holds read-only mirrors of those prompts so a spec change can be reviewed against the full contract instead of guessing what the out-of-band prompts say.

## Convention

- One file per scanner: `<scanner>.md` (e.g. `sleeper-scanner.md`), containing the prompt verbatim under a header that names Devin as the source of truth and records the last-synced date.
- Mirrors are documentation. Editing a mirror changes nothing in production; edit the prompt in Devin and re-sync the mirror in the same PR as any spec change that alters what a wrapper itself must say.
- To canary an invasive spec change before it reaches every scanner: the wrappers' `gh api .../contents/...` fetch accepts `?ref=<branch>`, so point one scanner's wrapper at the branch, watch a run or two, then merge and revert the wrapper. Record the temporary ref change in that scanner's mirror while it is live.

No mirrors are synced yet — this directory currently documents the convention only.
