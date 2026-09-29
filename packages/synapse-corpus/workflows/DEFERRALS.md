# Workflow System — Deferrals

The following capabilities are explicitly deferred and will not function
until their respective infrastructure is provisioned:

## Worker Workflow Binding/Class

The `corpus_workflow_runs` table and outbox dispatch create workflow run
records and outbox tasks, but no Cloudflare Worker Durable Object or
Workflow class exists yet. The outbox queue name `workflows` is registered
but no Worker consumer processes it.

## Provider HTTP Adapters

The `WriteAdapter` interface is defined as pure DI — no concrete
implementations exist. The `AdapterRegistry` returns `undefined` for all
providers, making the system inert (dry-run only) without injected adapters.

Future adapters will implement:
- `LinearWriteAdapter` — Linear GraphQL API
- `NotionWriteAdapter` — Notion REST API
- `GithubWriteAdapter` — GitHub REST API

## Credentials

No credential management exists. Adapters will need:
- OAuth tokens or API keys from the corpus connection's `credential_ref`
- Token refresh/rotation handling
- Rate limit awareness

## `workflow_approver` Service Capability

The `workflow_approver` value exists in `CorpusServiceCapability` and in the
`corpus_service_capability_grants` CHECK, but no code path consults it yet:
`submitApproval` requires a per-principal admin grant and denies service
principals outright (ruling e9 on #32447 removed the service-grant approval
path). The capability is reserved for a future service-principal approval
flow and is inert until one exists.

## Approval UI

No user-facing approval interface exists. The `submitApproval` function
accepts authenticated principals, but no web/Slack/MCP surface presents
pending approvals or collects verdicts.

## Production Feature Flag / Provisioning

- All `corpus_workflow_definitions` are created with `enabled = false`
- No provisioning flow creates or enables definitions
- No feature flag gates the dispatch subscription matcher
- The package exports remain inert without:
  1. Injected adapter implementations
  2. An enabled workflow definition
  3. A consumer processing the `workflows` outbox queue

## What Works Now

- Schema validation of all intent kinds (contracts)
- Pure policy evaluation (no I/O)
- Migration creates all tables with full integrity constraints
- Integration tests verify immutability, CAS, and idempotency
- Domain event projection helper for github.pr.merged
- Subscription dispatch creates idempotent runs + outbox tasks
- Approval CAS with DB-backed admin authorization
