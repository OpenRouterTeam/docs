# Synapse Corpus Contracts

Versioned, source-neutral JSON contracts shared by corpus connectors, queues,
MCP tools, retrieval surfaces, and workflow subscriptions.

Exports:

- `CorpusIngestEnvelopeSchema` — authenticated connector delivery. Non-delete
  events carry either a bounded inline JSON payload or an R2/raw blob reference.
- `AgentWorkUpdateSchema` — structured evidence submitted by local coding
  agents. Human identity is supplied by the authenticated server, not accepted
  from the payload. `agentKind` is an observability label, not identity.
- `KnowledgeHitSchema` — cited retrieval evidence returned to MCP, Slack, web
  chat, and PR-review context.
- `CorpusDomainEventSchema` — normalized, versioned events consumed by later
  workflow layers.

See `AGENTS.md` for the conventions governing changes to this package.
