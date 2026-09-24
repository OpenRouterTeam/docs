# Provider Monitors Agent Guidelines

See the root [AGENTS.md](../../AGENTS.md) for repo-wide rules.

## V2 model document schema is append-only

The V2 model document (`classes/model-schema-v2/model-document-v2.ts`) is a contract external providers author against and redeploy on their own schedule. Providers do not redeploy when we merge, and a document the monitor rejects is dropped before endpoint selection, so a schema change that rejects existing documents removes that provider from pricing, availability, and structural monitoring until they republish.

- **Only add optional fields.** Never remove, rename, or narrow a field, make an optional field required, or change the meaning of an existing value.
- **`schema_version` is a format marker, not a compatibility gate.** The parser accepts any `2.x` string (`ModelDocumentV2SchemaVersionSchema`); `MODEL_DOCUMENT_V2_SCHEMA_VERSION` (`2.4`) is only what we emit and show in docs. Never narrow the parser back to one literal (that is how a `2.4` to `2.5` bump dropped 13 providers), and do not bump the constant for an additive change: the schema is closed and already rejects unknown keys, so a bump only churns the docs and dashboard examples. A change that cannot be expressed additively is a new major format (`3.x`) with its own parser alongside V1 and V2.
- **Regenerate the OpenAPI asset in the same commit** (`bun classes/model-schema-v2/generate-openapi-asset.ts`) and update the example document in `projects/docs/guides/community/for-providers.mdx` when a new optional field is worth showing.
