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
| `scripts/oxlint/rules-*.ts` | Rule implementations, grouped by domain |
| `scripts/oxlint/plugin-helpers.ts` | `rule()`, `report()`, AST accessors, shared predicates |
| `scripts/oxlint/openrouter-plugin.ts` | Merges every domain module into the plugin's `rules` map |
| `oxlint.config.ts` | Enables rules repo-wide (`openrouterRules`) or per path (`overrides`) |
| `scripts/oxlint/test.config.ts` | Rule-only config used by the fixture harness |
| `scripts/oxlint/fixtures/<rule-name>.fixture.ts(x)` | Positive and negative cases |
| `scripts/oxlint/*-baseline.ts`, `*-registry.ts` | Grandfathered violations and allowed-symbol lists |

## Steps

0. **Check for a native rule first** (for example `curly`, `no-restricted-properties`,
   `typescript/consistent-type-assertions`, `react/forbid-dom-props`). Prove parity by
   running oxlint against a fixture with only the native rule enabled before writing JS.
   Third-party ESLint plugins are not a shortcut: oxlint's plugin context has no `context.getScope`, and packages that reach into `eslint-plugin-react` internals fail to load at all (`eslint-plugin-react-server-components` does both). Port the check as a custom rule instead.
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
   diagnostic, and cover the near-misses that make the rule non-obvious. Each marker is
   also location-checked (see Fixture rules), so place it on or directly above the code
   the rule reports on.
5. **Run the harness**: `bun run test:oxlint-rules`. It lints every fixture with
   `test.config.ts` and compares counts and locations per rule. `scripts/lint.ts` also runs it as the
   "Custom oxlint rule fixtures" task, so it runs in every `bun run lint`, `bun run verify`
   and CI lint job. Still run it locally on every rule change.
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
- Marker placement. An inline marker (`code(); // should trigger: ...`) annotates its own
  line. A standalone comment marker annotates the next non-blank, non-comment line. Blank
  lines and other comments between the marker and that line are fine. Only real comments
  count, as the TypeScript parser sees them, so marker text inside a string, template
  literal or regex literal is neither a marker nor a comment.
- Location check. A marker's region runs from its annotated line up to the next
  `should trigger` / `should not trigger` marker. The harness requires at least one
  diagnostic of the fixture's rule whose primary label starts inside that region, so a
  marker above a multi-line declaration passes when the rule reports on a nested line.
  Markers stacked above one region need one diagnostic each. The failure reads
  `expected diagnostic on line N, got lines [...]`, where the lines are computed from the
  diagnostic's byte offset into the fixture source.
- Diagnostics from other rules fail the fixture. When the fixture's deliberately bad code
  also trips another rule, opt out per exact code with a file-level comment such as
  `// allow-other-rules: openrouter(no-unnecessary-typecast), openrouter(other-rule)`
  rather than editing the fixture body.

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

Type-aware rules live in `oxlint.type-aware.config.ts` and need `--type-aware`
(`oxlint-tsgolint` is a root devDependency). Scan them with that config, not with a CLI
`-D` override, which resets the rule's options (for `switch-exhaustiveness-check` that
drops `considerDefaultExhaustiveForUnions` and flags every `default`-guarded union
switch). The `.` scan also emits one `typescript(tsconfig-error)` for the root
`tsconfig.json` (`baseUrl` is unsupported by tsgolint); explicit file targets do not.

```bash
node_modules/.bin/oxlint --config oxlint.type-aware.config.ts --type-aware .
```

- **Few hits**: fix them in the same PR.
- **Many hits, or fixes needing review of their own**: check in an entry-level baseline
  module (`scripts/oxlint/<domain>-baseline.ts`) exporting an `as const` array of
  `relative/path.ts` (or `relative/path.ts#EXPORT`) entries, consumed by the rule and
  documented as "never add new entries; remove as they are migrated". Add a colocated
  `*-baseline.test.ts` when matching is non-trivial, e.g. path suffix matching that must
  hold for any checkout root — see `scripts/oxlint/route-handler-auth-baseline.ts` and its
  test. Baseline fixtures (`<rule-name>-baseline.fixture.ts`) prove entries are exempt and
  that non-entries still fail.
- **Many hits per file**: pin `{ path, count }` per file instead of a bare path and let the rule suppress only the first `count` diagnostics it emits for that file, so a new hit in an already-listed file still fails. Give the baseline fixtures their own pinned counts inside the lookup so the harness can prove both "within count" and "exceeds count" (see `scripts/oxlint/no-hand-formatted-copy-baseline.ts`).
- **Rules that require calling an approved helper**: keep the accepted names in a small
  registry module (`scripts/oxlint/*-registry.ts`) so additions are a reviewed one-line
  change, and note in it which sibling registries must change together.
- Behavior-preserving codemods land before the rule flips to `'error'`, not with it.
- Generate count baselines from `--format json` (group `diagnostics[].filename` by the rule's `code`), and regenerate after any predicate change. Sample the hits before committing the baseline: an implausible file count usually means the predicate is broader than intended.
- Rule module exports used only internally fail Fallow's unused-export check; keep them module-private.

## Pitfalls

- Registering the rule in `openrouter-plugin.ts` (via its module) is not enough — an
  unlisted rule in `oxlint.config.ts` never runs, and one unlisted in `test.config.ts`
  never runs under test.
- `scripts/oxlint/fixtures/**`, `packages/bench-harness/**` and the other
  `ignorePatterns` entries are exempt from linting; a rule aimed at them will never fire.
- Source-text heuristics (`context.sourceCode.text`) are cheap but match comments and
  strings too; prefer AST predicates when the distinction matters.
- Return a module-level `const EMPTY_VISITOR: Visitor = {}` for out-of-scope files; an
  inline `{}` widens the return type and fails typecheck.
- Import only leaf modules from a rule. The plugin loader resolves the whole import graph
  without `tsconfig` paths, so a helper that reaches `lib-result` fails plugin load.
- Rules keyed on filenames must handle both `page.tsx`-style basenames and the `/projects/…`
  path fragments they are scoped to; `getFilename` returns an absolute path.
- Look up source-derived names (property names, identifiers) in a `Map` or `Set`, never by indexing a plain object. `registry[name]` for `constructor` or `toString` returns an `Object.prototype` member, and the rule then throws `... is not a function` as a plugin error on whatever file first contains that shape. Fixtures rarely contain one, so the crash shows up only in the whole-repo scan (or in CI on an unrelated file).
- A rule that matches an SDK by call shape alone (`<receiver>.invoices.create(...)`) flags every SDK with that shape; Devin Review rejects it (seen on #45739). Injected clients are typed by local interfaces, so the receiver itself cannot be proven, but every such file imports the SDK or a helper module under its name. Gate in a `Program` visitor on an `ImportDeclaration` whose source matches the SDK (`importsStripeModule` in `scripts/oxlint/stripe-idempotency.ts`) and prove the inverse with a `-no-import` fixture that exercises every registered resource.
- A new `scripts/oxlint/*-baseline.ts` (or `*-registry.ts`) module that nothing imports statically fails the Fallow dead-code check (`bun run fallow:lint`, also run by lint). Make it reachable from the plugin import graph, or model a real dynamic load in `.fallowrc.json`. For intentional temporary findings such as a lower stacked PR awaiting its consumer, add exact entries to `scripts/fallow-dead-code-baseline.json` and explain them in the PR. The consuming PR removes those exceptions. Unused exports and Server Actions follow the same workflow; inspect dynamic/public consumers before deleting or suppressing them.

## Verify

```bash
bun run test:oxlint-rules   # fixture counts (also a bun run lint task, so CI runs it)
```

`bun run lint` (CI) runs oxlint as its "Style Checks (Oxlint)" task and the fixture
harness as its "Custom oxlint rule fixtures" task; the `scripts` workspace unit tests,
including `scripts/oxlint/*-baseline.test.ts`, run in the CI unit job.
Use `bun run lnt` to apply fixes to changed files.
