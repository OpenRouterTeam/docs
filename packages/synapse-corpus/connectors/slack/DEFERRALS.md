# Slack connector (PR6) deferrals

## Implemented in this package

- Versioned Slack connector manifest/config/cursor/snapshot schemas
  (`deletedTs` tombstones; monotonic `enumerateSequence`)
- Injected `SlackApiClient` (no secrets in config beyond `credentialRef`)
- Whole-thread enumerate/fetch/normalize + exact Slack citation anchors
- Channel → container mapping + sealed ACL snapshot helpers
  (atomic fail-closed on unresolved restricted members)
- Live ACL reconcile (`reconcileSlackLiveAcl`) for archive / channel_deleted /
  member join-leave; unarchive requires full re-import + restore intents
- Extracted export JSON parser + content-addressed raw evidence import
  with non-empty `retention_policy_json` (purge owner:
  `synapse-corpus-retention-sweeper`)
- Events API WebCrypto HMAC verify, timestamp skew rejection,
  url_verification, message/reply/edit/delete/archive/unarchive/
  channel_deleted/member classification, `expectedTeamId` binding,
  fast-ACK envelope IDs
- Reconciliation runner with whole-thread refetch, container ensure-before-accept,
  and snapshot-derived watermarks (never wall clock)
- HTTPS `*.slack.com` pin for workspaceDomain + permalinks
- Fixtures + unit/integration tests

## Explicitly deferred

| Item | Why | Target |
|---|---|---|
| Versioned question/summary/resolution artifacts | No artifact schema/synthesis pipeline exists yet; inventing one would pre-empt PR10 | PR10 synthesis |
| Same-author burst/salience representations | Derived representation, not source evidence | PR10 |
| ZIP upload/import bulk job service | No bulk worker on branch; ZIP libs not needed for extracted JSON fixtures | bulk-ingestion service |

## Worker note

`services/cfw-synapse` owns signed HTTP ingress, durable queue routing, the paginated production Slack client, principal resolution, private query/DM delivery and independent privacy recovery. The production embedding decision is `openai/text-embedding-3-small` / 1536 dimensions, with explicit activation. Secrets remain in `src/creds.ts`; no source or model admission is enabled by default. Bulk ZIP import and additional query surfaces are still separate scope.
