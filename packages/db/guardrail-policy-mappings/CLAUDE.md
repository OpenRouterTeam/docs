# Permanent v1 policy provenance

The retained `guardrails`, `api_keys_guardrails`, and `organization_members_guardrails` rows remain the only owners of v1 metadata. Mapping and registration rows contain references, never copied names, actors, timestamps, or configuration.

Follow the reference barrier and lock-order protocol in [guardrail cleanup guidance](../guardrail-policies/AGENTS.md). Acquire the complete owner/actor/member barrier set before account or child row locks. Management and backfill transactions must re-read retained sources after waiting; a deleted source cannot be initialized again.

Create the full policy mapping triple and initial configured workspace floor/default choices atomically. Pass an actual resolved workspace for its deterministic workspace guardrail, and `null` for a reusable guardrail. Existing complete mappings mean workspace initialization was already considered; never refill missing choices during a retry.

Assignment registration survives selection deletion. Initialize a legacy source before any typed edit, including a return to inheritance, in the same transaction. An existing registration must preserve absent types and independent selections. Only explicit v1 reassignment restores the full triple.

Changing a typed selection clears all three source columns. Returning to inheritance deletes its selection row. Releasing a legacy assignment removes only types it still owns. Before changing a retained assignment's guardrail ID, release its old source-owned selections in the same transaction.

Legacy key provenance intentionally excludes workspace from the source FK so a resolved key move can relocate selections while retaining the assignment identity. Member provenance includes workspace. Query boundaries always require the owner and exact subject.
