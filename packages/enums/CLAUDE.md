# Enums Agent Guidelines

## Derive inference-surface inventories from `API_SURFACES`

`packages/enums/api-surfaces.ts` is the single registration point for an inference API surface (Completions, Embeddings, Rerank, Decisions, Video, TTS, STT, Image). Any code that needs every surface, its wire `ApiType`, its telemetry script name, its performance workload, or its lifecycle prefix derives the list with `Object.values(API_SURFACES)` or `Object.values(ApiType)` instead of hand-typing it, whether in routing, a worker, the Tiltfile, `scripts/dev-multi.ts`, or `configs/terraform-monitors`. A hand-typed list that already exists is a migration target, not a precedent.

Registration owns only those four values (`lifecycleSurface: null` means no shared modality guard fragments, `perfWorkload: 'unknown'` means no dedicated V5 workload, do not invent one). API skins, model capabilities, security eligibility, worker deployments, route handlers, and alert thresholds are separate contracts. Preserve wire values and error-location prefixes when renaming internal symbols.
