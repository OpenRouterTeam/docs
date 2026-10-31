# OpenRouter Docs

This directory contains the [Mintlify](https://mintlify.com)-hosted documentation for [openrouter.ai/docs](https://openrouter.ai/docs). Mintlify builds from the public mirror [OpenRouterTeam/docs](https://github.com/OpenRouterTeam/docs), which each release overwrites from here; edit docs in this directory only.

## Publishing

A page reaches the public site only when its frontmatter contains `publish: true`, and only with the next release after it merges. The Validate Docs workflow fails a PR whose navigation, redirects, or `models:` lists reference a page without that line. See [AGENTS.md](./AGENTS.md) for the full rules and how to preview what a release would publish.

## PR Workflows

- **Validate Docs** — Runs `mint validate` on all PRs touching `projects/docs/**`, then type-checks every `ts`/`tsx` code fence that imports `@openrouter/sdk`, `@openrouter/agent`, or `openai` against the versions pinned in `scripts/package.json` (`bun scripts/ci/check-docs-snippets.ts`) and annotates failing lines. A later fence on the same page that uses a name an earlier checked fence declares (a continuation such as `const result = await openrouter.callModel(...)`) is checked with the earlier fences in scope; fences that stand alone (`fetch` or other-SDK alternatives, type listings, signature notation) are not checked. A fence that imports a checked package is a whole file, so one that does not parse (for example JSX in a `ts` fence, which needs `tsx`) fails on its parse diagnostics. The same check runs as the `Docs SDK snippet type-check` task of `bun run lint`, so the required `lint` job blocks the merge queue on it. Known failures are listed by content hash in `scripts/ci/check-docs-snippets-baseline.json`; a listed example is exempt as a whole until it is edited, which re-checks it, and `--update-baseline` regenerates the list
- **Docs Preview** — Posts a preview URL as a PR comment for internal PRs (fork PRs cannot access secrets)

## Linking a page from model pages

A guide or cookbook written for a specific model or model family should also be linked from that model's page on openrouter.ai, which lists it in the page's Documentation section and structured data. Declare the family in the page's frontmatter:

```yaml
---
title: Gate Agent Tool Calls with Jev
models:
  - typesafe/jev
---
```

Each entry is `author/name-prefix`, lowercase. A model page links the doc when its author matches and its model name equals the prefix or starts with `<prefix>-`, so `typesafe/jev` covers `typesafe/jev-1.13`, `~typesafe/jev-latest`, and `typesafe/jev-1.13:free`. Append `$` to match only that exact model and its `-latest` alias: `openai/gpt-5.4$` covers `openai/gpt-5.4` but not `openai/gpt-5.4-mini`. List several families when a page covers several (`openai/gpt-6-astra` and `openai/gpt-astra` on the Astra migration guide). Pages under `cookbook/` show as Cookbook, everything else as Guide, and the `sidebarTitle` (or `title`) is the link text. A page marked `noindex: true` cannot declare models. Every page under `cookbook/evaluate-and-optimize/model-migrations/` must have a `models:` key (`models: []` if it covers no listed model), or `bun run generate:docs:model-map` fails.

The Validate Docs workflow also flags a page that names a public model slug in its body and that model's name in its file name or title (`openrouter/fusion` on `fusion-router.mdx`) but has no `models:` key. Add the suggested list, or `models: []` when the page is not written for that model. Run the check locally with `bun scripts/ci/check-docs-model-coverage.ts`.

After editing frontmatter run `bun run generate:docs:model-map` and commit the regenerated `model-documentation-map.gen.ts` in `projects/web`. The Validate Docs workflow fails when that file is stale. Labs live in `projects/web` rather than here and are listed by hand in `model-documentation-resources.ts` next to the generated file.

## Local Development

To preview docs locally, install the Mintlify CLI and run:

```bash
cd projects/docs
mint dev
```

Or use Tilt: `tilt trigger docs` with a running `tilt up` (or start it enabled with `tilt up -- docs`). The docs are served at http://localhost:3003 (override with `DOCS_PORT`).

## Resources

- [Mintlify Documentation](https://mintlify.com/docs)
- [docs.json Configuration](https://mintlify.com/docs/settings/global)
