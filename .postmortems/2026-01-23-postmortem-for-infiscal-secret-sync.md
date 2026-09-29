# Postmortem: Infisical Sync Misconfiguration

## TLDR
- A misconfigured Infisical → Vercel sync for the `openrouter-web` project overwrote Infisical secrets with older Vercel values, impacting engineers’ local and preview environments.
## Incident Details
- **Date Range:** Evening of January 22, 2026 – Morning of January 23, 2026
- **Severity:** SEV-4 (Medium) – Impacted engineering workflows only
- **Incident Lead:** Chris Watts
- **Detection Method:** Engineers encountered broken local and preview environments the following morning
- **Users Affected:** OpenRouter engineers working on `openrouter-web`
## Timeline
Thurs Jan 22 (All times PST)
**19:05**
- A new Infisical → Vercel sync is created for the `openrouter-web` project, targeting preview deployments.
- During the initial sync, the option **“Import Destination Secrets – Prioritize Vercel Values”** is mistakenly selected.
- As a result, Infisical secrets are overwritten by older values that were already present in Vercel instead of Infisical becoming the source of truth.
Fri Jan 23 (All times PST)
**Morning**
- Engineers notice issues in their environments (local and preview) caused by incorrect or stale environment variables.
- The underlying change is discussed and surfaced in this Slack thread: [slack message]
**13:00**
- Engineering team huddles to investigate the breakage.
- The team traces the issue back to the newly created Infisical → Vercel sync and identifies the incorrect initial sync option as the root cause.
**Shortly after 13:00**
- The Infisical sync for the `openrouter-web` Vercel project is removed.
- Engineers manually revert and correct the affected environment variables in Vercel.
**15:13**
- Reverted Infisical Commits
[infisical link]
- [infisical link]
## Impact
- Engineers’ local and preview environments used incorrect or outdated secrets.
- Engineering velocity was temporarily reduced while environments were debugged and repaired.
- No production incidents or user-facing downtime were observed.
## Root Cause
- The incorrect initial sync mode was selected when configuring Infisical → Vercel:
	- **Expected behavior:** Infisical should act as the source of truth, pushing its secrets into Vercel and overwriting older Vercel values.
	- **Actual behavior:** By choosing **“Import Destination Secrets – Prioritize Vercel Values,”** Vercel’s existing values were treated as canonical and pushed back into Infisical, overwriting the intended Infisical values.
- This configuration error effectively reversed the direction of trust between Infisical and Vercel for the initial sync.
## Contributing Factors
1. **Confusing initial sync options**
	- The wording and UX around initial sync modes made it easy to misinterpret which side would become the source of truth.
2. **Lack of dry run or preview**
	- There was no dry run, diff, or preview step clearly showing which values would be overwritten and on which side before confirming the sync.
3. **No guardrails for critical secrets**
	- Critical or sensitive environment variables (e.g., for `openrouter-web`) were not protected by additional checks or confirmation flows when running a destructive sync.
4. **Limited immediate visibility**
	- The sync action and its side effects were not surfaced in a central place (e.g., a shared dashboard or alert) that would have made the misconfiguration obvious right after it occurred.
## Resolution
- Removed the Infisical → Vercel sync configuration for the `openrouter-web` preview environment.
- Manually restored and verified the correct environment variables in Vercel.
- Confirmed that engineers could again run local and preview environments successfully.
## Action Items
- [ ] Post all Infisical configuration and sync changes to the `#infra-changelog` Slack channel.
- [ ] Add internal documentation for configuring Infisical ↔ Vercel syncs, including:
	- Clear guidance on which initial sync modes to use.
	- Examples for common use cases (e.g., making Infisical the source of truth for Vercel).
- [ ] Introduce a checklist or approval step for changes to secrets affecting core projects like `openrouter-web`.
- [ ] Explore adding a dry-run or diff step when changing sync modes or running the first sync on a critical environment.
- [ ] Add monitoring or alerts to surface large-scale changes to environment variables for shared or critical projects.
## Open Questions
- Should Infisical → Vercel syncs for critical projects like `openrouter-web` always be reviewed by a second engineer before being applied?
- Can we configure Infisical or Vercel to:
	- Require explicit confirmation when overwriting existing secrets?
	- Provide a clear, human-readable diff of changes before they are applied?
- Should we maintain a separate lower-risk test project (or environment) where sync modes and changes can be validated before applying them to shared engineering environments?
