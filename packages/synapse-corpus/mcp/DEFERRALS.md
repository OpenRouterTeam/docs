# MCP work updates + retrieval primitives (PR8) deferrals

## Implemented in this package

- Migration `20260805009500_query_access_audit.sql` for `corpus_query_runs` and
  `corpus_access_decisions` (comments, locks, down, idempotent `IF NOT EXISTS`)
- `AuthenticatedCorpusRuntimeContext` — server-resolved `corpusId` /
  `principalId` / `serviceIdentity`; tool args never accept a trusted human id
- `report-work-update` — validates `AgentWorkUpdateSchema`, strips claimed
  identity, stamps authenticated principal, builds agent connector envelope
  with required `sourceVersion` / `sourceUpdatedAt`, accepts via
  `acceptEnvelope` (durable outbox), visibility → fail-closed ACL/container,
  idempotent on `updateId`
- LLM-free cited tools: `search`, `search-slack`, `search-code`, `recent-prs`,
  `subsystem-index` — all consume PR5 `retrieveKnowledge`, authenticated
  principal only, source/repo filters, bounded limit/query bytes, public
  `KnowledgeHit` fields only, access audit on success/denial/zero-result
- Versioned MCP tool schemas/descriptions + adapter-neutral registry /
  `executeMcpTool` (no dependency on public `cfw-mcp` generated surface)
- Query scope/default selection from corpus scopes/memberships with SQL
  authorization; explicit `searchAll` opt-in; defaults never grant ACL
- No raw external write tools registered

## Explicitly deferred

| Item | Why | Target |
|---|---|---|
| Internal MCP HTTP transport | Slack/operator routes do not mount an MCP transport or authorize external agents | separately approved Worker surface |
| MCP HMAC/bearer identity mapping and origin policy | Requires an explicit MCP transport contract; existing Slack signature/operator bearer checks are not substitutes | separately approved Worker surface |
| Durable normalize/process of agent work updates into revisions | PR8 accepts envelope + outbox; full agent connector normalize is follow-up | agent connector / runtime consumer |
| Team-group ACL expansion for `visibility: team` | No group membership resolver yet; currently principal-scoped (fail closed) | identity/group resolution PR |
| Web query surface and broader Slack destinations | Current live path is restricted to verified one-to-one Slack DMs | separate surface approval |

## MCP worker wiring when separately approved

1. **Route:** `POST /internal/mcp` (Streamable HTTP) on the Synapse worker only.
   Do **not** add routes to frozen `cfw-api`.
2. **Auth:** require `Authorization: Bearer <internal>` **or** HMAC over
   body+timestamp with shared secret from Infisical
   (`/services/cfw-synapse`). Reject missing/invalid with `401` and no tool
   execution. Map bearer/HMAC identity →
   `AuthenticatedCorpusRuntimeContext` via a server-side principal resolver
   (never from tool args).
3. **Origin:** call the same Origin allowlist pattern as
   `services/cfw-mcp/src/mcp/validate-origin.ts` before handling tools.
4. **Dispatch:**
   ```ts
   import {
     executeMcpTool,
     listMcpTools,
     AuthenticatedCorpusRuntimeContextSchema,
   } from '@openrouter-monorepo/synapse-corpus';

   const auth = AuthenticatedCorpusRuntimeContextSchema.parse(serverResolved);
   if (method === 'tools/list') return listMcpTools();
   if (method === 'tools/call') {
     return executeMcpTool(db, auth, { name: params.name, args: params.arguments });
   }
   ```
5. **Secrets:** keep bearer/HMAC material in `src/creds.ts` only; never in
   package code.
6. **Agent connection:** provision one `corpus_connections` row with
   `provider = 'agent'` per corpus and set `auth.agentConnectionId` from that
   binding (not from the client).

## Worker note

`services/cfw-synapse` exists and consumes the package for Slack. Its current routes do not expose `executeMcpTool`, `listMcpTools`, or `executeReportWorkUpdate` over MCP. Keep that transport and agent source rollout explicitly separate.
