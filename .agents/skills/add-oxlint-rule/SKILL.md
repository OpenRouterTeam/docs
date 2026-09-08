---
name: add-oxlint-rule
description: Author a custom oxlint rule in scripts/oxlint — covers rule modules, plugin registration, enabling it in oxlint.config.ts, fixture tests, and rolling it out over existing violations
user-invocable: true
---

# Add a Custom Oxlint Rule

Custom rules live in the `openrouter` JS plugin under `scripts/oxlint/`. A rule is a
`description` plus a visitor; everything else is wiring in four files.

## Layout

| Path | Role |
| --- | --- |
| `scripts/oxlint/rules-{schema,result,style,security,frontend,bench-harness}.ts` | Rule implementations, grouped by domain |
| `scripts/oxlint/plugin-helpers.ts` | `rule()`, `report()`, AST accessors, shared predicates |
| `scripts/oxlint/openrouter-plugin.ts` | Merges every domain module into the plugin's `rules` map |
| `oxlint.config.ts` | Enables rules repo-wide (`openrouterRules`) or per path (`overrides`) |
| `scripts/oxlint/test.config.ts` | Rule-only config used by the fixture harness |
| `scripts/oxlint/fixtures/<rule-name>.fixture.ts(x)` | Positive and negative cases |
| `scripts/oxlint/*-baseline.ts`, `*-registry.ts` | Grandfathered violations and allowed-symbol lists |

## Steps

1. **Write the rule** in the domain module that fits (add a new `rules-*.ts` module only
   for a genuinely new domain, and spread it in `openrouter-plugin.ts`). Build it with the
   `rule(description, create)` helper, read the file path with `getFilename(context)`, and
   emit through `report(context, node, message)`. Use the AST accessors in
   `plugin-helpers.ts` instead of casting nodes — rule code is linted and typechecked like
   any other source. Export it from the module's `Record<string, Rule>` under its kebab-case
   name. Keep the message actionable: name the replacement helper or the required wrapper.
2. **Enable it** in `oxlint.config.ts`. A rule that applies everywhere goes in
   `openrouterRules`; a rule that only makes sense in some workspaces goes in the matching
   `overrides` entry keyed by `files`. `'error'` is the only useful enabled level here —
   the repo runs at a zero-warning baseline, so `'warn'` is invisible. Deliberately deferred
   rules are checked in as `'off'` with a comment saying what unblocks them.
3. **Register the rule name** in the `ruleNames` array in `scripts/oxlint/test.config.ts`.
   The fixture harness uses that config, not `oxlint.config.ts`; a rule missing from the
   array silently reports zero violations.
4. **Add a fixture** at `scripts/oxlint/fixtures/<rule-name>.fixture.ts` (`.tsx` for JSX).
   Mark each expected violation with a `should trigger:` comment line and each allowed
   pattern with `should not trigger`. The harness counts `should trigger:` lines and
   requires the rule's diagnostic count to match exactly, so one marker per expected
   diagnostic, and cover the near-misses that make the rule non-obvious.
5. **Run the harness**: `bun run test:oxlint-rules`. It lints every fixture with
   `test.config.ts` and compares counts per rule. No CI workflow runs it — run it locally
   on every rule change.
6. **Scan the repo before enabling**, then handle the hits (below).

## Fixture rules

- Fixtures are in `ignorePatterns` in `oxlint.config.ts`, so they are only ever linted by
  the harness. Their code does not have to typecheck as production code, but it must parse.
- A path-scoped rule must accept fixture paths explicitly or its fixture never fires. Use
  `isRuleFixturePath(filename)` and return the fixture that belongs to this rule — see
  `isFrontendEntrypoint` in `scripts/oxlint/rules-frontend.ts`.
- The rule name is derived from the fixture filename. Splitting one rule across several
  fixture files requires a normalization entry in `getRuleName` in
  `scripts/oxlint/test-rules.ts`, except for the already-handled `-baseline`,
  `-baseline-exceeded` and `-function-export-list` suffixes.
- Only the count for the fixture's own rule is asserted. Diagnostics from other rules are
  logged, not failed, so read the harness output rather than trusting the exit code alone.

## Rolling out over existing violations

Lint scope is changed files, not the whole tree: `scripts/lint-git-scope.ts` feeds
`scripts/oxlint-lint.ts` the branch diff against `origin/main` (plus unstaged files
locally). A new rule therefore lands green while pre-existing violations sit untouched —
and blocks whoever next edits one of those files. Before enabling, scan the whole repo and
decide per hit:

```bash
node_modules/.bin/oxlint --config oxlint.config.ts . 2>&1 | grep 'openrouter(<rule-name>)'
```

The full scan reports pre-existing failures from other rules too; grep for your own code.

- **Few hits**: fix them in the same PR.
- **Many hits, or fixes needing review of their own**: check in an entry-level baseline
  module (`scripts/oxlint/<domain>-baseline.ts`) exporting an `as const` array of
  `relative/path.ts` (or `relative/path.ts#EXPORT`) entries, consumed by the rule and
  documented as "never add new entries; remove as they are migrated". Add a colocated
  `*-baseline.test.ts` when matching is non-trivial, e.g. path suffix matching that must
  hold for any checkout root — see `scripts/oxlint/route-handler-auth-baseline.ts` and its
  test. Baseline fixtures (`<rule-name>-baseline.fixture.ts`) prove entries are exempt and
  that non-entries still fail.
- **Rules that require calling an approved helper**: keep the accepted names in a small
  registry module (`scripts/oxlint/*-registry.ts`) so additions are a reviewed one-line
  change, and note in it which sibling registries must change together.
- Behavior-preserving codemods land before the rule flips to `'error'`, not with it.

## Pitfalls

- Registering the rule in `openrouter-plugin.ts` (via its module) is not enough — an
  unlisted rule in `oxlint.config.ts` never runs, and one unlisted in `test.config.ts`
  never runs under test.
- `scripts/oxlint/fixtures/**`, `packages/bench-harness/**` and the other
  `ignorePatterns` entries are exempt from linting; a rule aimed at them will never fire.
- Source-text heuristics (`context.sourceCode.text`) are cheap but match comments and
  strings too; prefer AST predicates when the distinction matters.
- Rules keyed on filenames must handle both `page.tsx`-style basenames and the `/projects/…`
  path fragments they are scoped to; `getFilename` returns an absolute path.
- A new `scripts/oxlint/*-baseline.ts` (or `*-registry.ts`) module that nothing imports statically fails the Fallow dead-code check (`bun run fallow`, also run by lint). Make it reachable from the plugin import graph, or model a real dynamic load in `.fallowrc.json`. For intentional temporary findings such as a lower stacked PR awaiting its consumer, add exact entries to `scripts/fallow-dead-code-baseline.json` and explain them in the PR. The consuming PR removes those exceptions. Unused exports and Server Actions follow the same workflow; inspect dynamic/public consumers before deleting or suppressing them.

## Verify

```bash
bun run test:oxlint-rules   # fixture counts (local only, not in CI)
bun run stylecheck          # oxlint over changed files, as CI runs it
bun run verify              # format + lint + typecheck
```

`bun run lint` (CI) runs oxlint as its "Style Checks (Oxlint)" task; the `scripts`
workspace unit tests, including `scripts/oxlint/*-baseline.test.ts`, run in the CI unit job.
Use `bun run lnt` to apply fixes to changed files.
