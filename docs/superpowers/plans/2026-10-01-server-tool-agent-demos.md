# Server tool agent demos implementation plan

> Execute inline in the isolated worktree using the executing-plans workflow. The user approved the design and authorized execution through green CI and review approval.

**Goal:** Ship the approved server tool demos with verified model attribution and successful default runs.

**Architecture:** A lower PR owns the demo request/response contract, Responses client, run route, and tests. An upper PR owns the server-tools page integration, new controls and transcript components, and DOM tests. Each layer is independently typechecked and tested.

**Tech stack:** Next.js route handlers, React, the existing design system, Zod, OpenRouter Responses, Bun tests.

## Global constraints

Use the existing internal-admin guard and fixed-host OpenRouter client. Never put credentials in captures. Use the user-selected model IDs. Do not manufacture model turns or successful tool calls. Review routing and data-flow controls before PR creation. Run `bun run format`, `bun run typecheck`, scoped tests, and `bun run verify` before every push. Preserve pushed commits. Request Perry review directly in #agents and never invoke babysit.

## File ownership

Lower branch `codex/server-tool-agent-api`: this plan and design; `projects/mission-control/app/admin-utils/demo-hub/lib/agent-demo-{config,request,response,transcript}.ts` and their unit tests; `lib/openrouter.ts`; `app/api/demo-hub/demos/server-tools/agents/run/route.ts`; its run helper and tests; manual live-validation artifacts if needed.

Upper branch `codex/server-tool-agent-ui`: `projects/mission-control/app/admin-utils/demo-hub/demos/server-tools.tsx`; `demos/agent-demo.tsx`; `components/AgentDemoTranscript.tsx`; any form/result components and colocated DOM tests.

## Task 1: API contract and execution

- [x] Add failing tests for exact default model pairings, optional baseline, explicit required subagent tool choice, and automatic advisor tool choice with search/fetch.
- [x] Define Zod request and response contracts and bounded default configurations. Keep prompt defaults shared with the UI.
- [x] Add a Responses method to the existing client using its existing authentication and internal egress.
- [x] Parse ordered output items into attributed transcript entries, returning an error for malformed known items. Preserve raw output in the envelope.
- [x] Assess completed second-model calls, final synthesis, and search/fetch plus visible draft before advisor. Cover early, failed, absent, and incomplete cases.
- [x] Add the guarded run route, preserving context shaping, capture behavior, and separate session IDs for optional baseline.
- [x] Run scoped unit tests from `projects/mission-control`, then formatting, typecheck, verify, and commit the API layer.

## Task 2: Controls and transcript

- [ ] Create the upper branch from the committed API layer.
- [ ] Integrate Subagent and Advisor tabs with independent editable model pairs, prompts, reset defaults, and optional baseline comparison.
- [ ] Render research calls, lead messages, advisor/subagent inputs and results in response order. Show actual model identity and explicit unknown, failed, and incomplete states.
- [ ] Keep controls/results coherent during pending runs, surface validation and transport errors, and protect prompt/output DOM with both telemetry privacy markers.
- [ ] Add DOM coverage for the form states and visible attribution. Run the scoped DOM command with Mission Control's preload.
- [ ] Run repeated live default requests, inspect the UI, and correct failures before calling it ready.

## Task 3: PRs and approval

- [ ] Run required security and HIPAA reviews, scoped tests, formatting, typecheck, and verify. Create and attach both PRs bottom-up with exact dependencies and validation evidence.
- [ ] Re-run relevant tests after pushes and resolve failing CI jobs.
- [ ] Request Perry review directly in #agents with the stack links and concise scope. Keep subsequent coordination in the same Slack thread.
- [ ] Address every actionable review comment, push follow-up commits with checks, and obtain approval. Finish only when CI is green and no review comments remain outstanding.
