<!--
DO NOT REMOVE: These comments help humans and AI reviewers.

Principles:
- Brevity over sprawl. Aim for a 2–3 minute read.
- Delete entire sections that don’t apply. Do not write “N/A”.
- Let the code speak; this PR text should only add what code cannot.

AI fill hints (optional for tools):
- Summarize the diff; classify PR type; detect dependencies/migrations/API changes; test coverage deltas.
- Link to key lines/spans in the diff where useful.
- Prefer short, factual bullets.
- Do NOT include typecheck, test, or lint as verification steps — CI handles those.

Scale guidance:
- Small PR (<200 LOC changed): Keep only TL;DR, What changed, How to test, Checklist. The HIPAA / ePHI impact line in the Checklist stays on every PR.
- Large PR (>500 LOC changed): Use Additional details sparingly and only where it de-risks review.

For stacked PRs: GitHub renders the stack on the PR page — do not paste a
stack map or parent/child links. Do state this PR's owned scope and what it
explicitly excludes, and (top PR only) how to check out and test the
complete feature.
-->

## TL;DR
<!-- One sentence: what this PR does and the outcome. -->

## What changed?
<!-- High-level bullets. Avoid deep internals here. -->
-
<!-- Optional: “Affected areas” (paths/packages/services) if not obvious from the diff. -->

## Why?
<!-- Problem, who benefits, and success criteria. Link issues/RFCs. -->
-

## How to test
<!-- Copy-paste runnable steps, commands, or URLs. Keep verification explicit. -->
<!-- Do NOT list typecheck, test, or lint as verification steps — CI handles those automatically. -->
<!-- Focus on manual/functional verification: API calls, UI interactions, expected outputs. -->
<!-- Include expected results, e.g., "returns 200", "UI shows X", "metric Y increases". -->

## Reviewer focus
<!-- Where should reviewers spend time? Risky bits, tricky trade-offs, or non-obvious decisions. -->
-

<details>
<summary>Additional details (open only if needed)</summary>

### Breaking changes
<!-- Delete if none. Be explicit about contracts, clients affected, and migration notes. -->

### Rollout plan
<!-- Delete if standard. E.g., flags/canary/regions and rollback steps/owner. -->

### Post-deploy monitoring
<!-- Delete if this PR cannot change production behavior (docs, tests, comments, CI-only). -->
<!-- Datadog queries someone runs after this commit deploys to confirm nothing blew up. -->
<!-- Worth an explicit check: a changed request/response path, error handling, retries or timeouts, -->
<!-- DB/KV/cache access, billing or usage accounting, auth, queues/crons, a new upstream dependency, -->
<!-- or anything on a hot inference path. Skip it for changes with no runtime effect. -->
<!-- Prefer existing metrics and log events. A new success metric for the feature is your call: -->
<!-- add one only when no existing signal shows the feature working (or failing) and you know who -->
<!-- reads the number and what they do with it. Either way, state the decision in one line. -->
<!-- Give every query a one-line expectation, e.g. "flat vs. pre-deploy" or "stays at 0". -->
<!-- Workers log under service:api unless mapped in packages/instrumentation/log-service.ts; -->
<!-- narrow with @script_name:<worker> and query structured fields as @extra.<field>. -->

<details>
<summary>Datadog queries to watch after deploy</summary>

```text
# Metrics — <expectation, e.g. "error count flat vs. pre-deploy">
sum:openrouter.<metric>{<tag>:<value>}

# Logs — <expectation, e.g. "no new lines">
service:api @script_name:<worker> status:error @extra.<field>:<value>
```

</details>

### Security and privacy
<!-- Delete if none. Note auth, secrets, permissions, PII/PHI/PCI, threat model changes. -->
<!-- The HIPAA / ePHI answer lives in the Checklist so it survives deleting this section. Expand on it here when the answer is Yes. -->
- Security review required: Yes / No

### Performance
<!-- Delete if none. Add before/after numbers if available; note methodology. -->

### Infrastructure
<!-- Delete if none. Terraform/Helm/CI/CD/Cloudflare/routing/secrets/permissions. -->

### Related work
<!-- Delete if none. Linked issues, follow-ups, dashboards/runbooks. -->

</details>

---

## Checklist
<!-- Keep accurate; unchecked items may block merge. Check only what is true. -->
<!-- Note: CI already checks typecheck, stylecheck, lint, tests, and package.json validation. -->

- [ ] Error handling uses `wrap` pattern (no try/catch in server actions)
- [ ] For UI changes: screenshots attached and preview URL linked
- [ ] Zod schemas use `.openapi({ description: '...' })` not `.describe()`
- [ ] Backward compatible (or breaking changes clearly documented)
- [ ] Observability in place (metrics/logs/traces/dashboards) and post-deploy queries listed
- [ ] Security/privacy review completed if required
- [ ] HIPAA / ePHI impact: None / Yes <!-- Keep this line. If Yes: name the trigger (content, sink, logs, routing, surface, posture, retention) and the covering control. See AGENTS.md → HIPAA and ePHI. -->
- [ ] Stakeholders/reviewers tagged; owners of affected areas consulted

<!-- Minimal machine-readable metadata for bots (optional). Tools may auto-populate these fields. -->
<!--
```json
{
  "pr_type": "feature|fix|perf|refactor|docs|test|build|ci|chore|revert",
  "risk": "low|medium|high",
  "breaking_change": false,
  "services_touched": ["service-a","web","worker"],
  "dependencies": {"added": [], "removed": [], "updated": []},
  "test_coverage_delta": "+0.0%"
}
```
-->
