# SDK Generation Package

This package generates the OpenRouter OpenAPI specification from the Hono
routes and Zod schemas across the API workers. The generated spec drives
SDK code generation (Speakeasy, in the external SDK repos) and the SDK
breaking-change check that runs on every pull request.

## Overview

- `export:openapi` assembles the OpenAPI document from the API route
  definitions into `openapi-assembled.json`.
- `src/openapi/generate-openapi.ts` post-processes that document
  (operation IDs, tags, security schemes, schema dedup/cleanup, Speakeasy
  retry extensions) and writes the final spec.

## Usage

Run from the repo root:

```bash
bun run generate:openapi
```

This compiles `chat-templates`, runs the explicitly invoked
`src/openapi/export-openapi.build.ts` assembly script, executes
`generate-openapi.ts`, and validates the result with
`speakeasy lint`.

## Output

- `openrouter-openapi.yaml` (repo root) — consumed by SDK generation.
- `projects/docs/openapi/openapi.yaml` — the Mintlify docs spec.

## Development

The package uses:

- TypeScript for type safety
- `zod-openapi` for schema → OpenAPI conversion
- `js-yaml` for serialization
- `bun:test` for unit tests and the explicitly invoked OpenAPI assembly
  script
