# Storybook

## Mock/real export parity

Storybook swaps ~34 real modules for mocks via Vite aliases (`.storybook/mock-pairs.ts` plus the redirect factories in `packages/storybook-utils/src/create-main.ts`). When a real module gains a runtime export that its mock lacks, rolldown fails the Storybook build with `[MISSING_EXPORT]`. `.storybook/mock-export-parity.test.ts` catches that on the PR that causes it, because `Deploy Storybook` does not build on most PRs that can break it.

If `bun run --cwd projects/storybook test` reports `missingExports`, **add the missing export to the mock**. That is the fix in nearly every case: the guard is reporting the same failure the Storybook build would.

Do not add an exemption to make the failure go away. `mockExportExemptions` exists only for mocks that are deliberately partial — one mock fronting several real modules, implementing just what stories reach. Adding to it silences a real build failure whenever the export is actually reachable from a story. Justify an entry with what stories do and don't touch, list the specific export names rather than the module, and give a reason.

The pair list is derived from the alias tables, so adding or removing a mock needs no test change. A mock alias that resolves to nothing is usually a wrong alias, not a missing exemption.

Mocks fronting a third-party or builtin module have no local source to compare against, so they are checked the other way round, through `usedImportParityPairs`. Every runtime name that repository source imports or re-exports from the exact bare specifier must be exported by the mock. Subpath specifiers such as `@clerk/nextjs/server` keep their real implementations and are not checked. A new third-party mock needs an entry in that list, otherwise the alias check reports it as unresolved.

Type-only exports (`interface`, `type`, `export type { … }`) are erased at runtime and intentionally ignored — a parity failure always names a value.
