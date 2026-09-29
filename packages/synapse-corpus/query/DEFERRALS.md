# PR9 Query UX Foundations — Explicit Deferrals

## Worker / Transport Layer
- **Worker Slack signature verification**: `cfw-synapse` Worker must verify
  `X-Slack-Signature` and `X-Slack-Request-Timestamp` headers before calling
  the adapter. Deferred because `cfw-synapse` does not exist in this package.
- **Worker Slack auth**: OAuth token refresh, bot token management, and Slack
  API client instantiation belong in the Worker, not in package-local code.
- **HTTP transport / fast ACK**: Slack Events API requires a 3-second ACK.
  The Worker must return 200 immediately and enqueue the query.

## Frontend
- **`cfw-frontend-api` route**: The web chat route that serves SSE stream
  events to the React frontend is deferred to the frontend-api worker.
- **Web chat UI components**: React components for the streaming chat,
  citation rendering, and feedback UI belong in `projects/mission-control`
  or the web app, not here.
- **Admin UI**: Mission Control admin views for corpus/source/sync/index
  health consume the read models exported here but render in the frontend.

## Service Bindings
- **Service binding configuration**: `cfw-synapse` ↔ `cfw-frontend-api`
  service binding and internal auth are Worker-level concerns.
- **Hyperdrive binding**: The corpus DB connection in Workers uses
  Hyperdrive; binding configuration is infrastructure, not package code.

## Models and Synthesis
- **Model-backed synthesizer**: The `Synthesizer` interface is injected;
  actual model selection, prompt engineering, and streaming are deferred
  until a model evaluation selects one.
- **Prompt templates**: Synthesis prompt templates with evidence delimiters
  are defined here (`EVIDENCE_UNTRUSTED_BEGIN/END`) but the full prompt
  pipeline requires model selection.
- **Reranker integration**: The query orchestrator passes through to
  existing retrieval which already supports injected rerankers.

## Provisioning
- **Slack app provisioning**: Creating the Slack app, configuring event
  subscriptions, and managing bot tokens.
- **Corpus provisioning**: Creating corpora, connections, and initial
  scope configuration belong in an admin API.
- **Identity mapping provisioning**: Linking Slack user IDs to corpus
  principals requires an admin workflow.

## Conversation Management
- **Conversation context window**: Multi-turn conversations that carry
  prior context into subsequent queries require conversation state
  management beyond the current turn-level recording.
- **Conversation pruning/archival**: Retention policies for old
  conversations.
