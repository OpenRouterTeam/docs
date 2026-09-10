---
name: dependency-hygiene
description: >-
  Four-weekly sweep for unused dependencies across the monorepo. Runs knip in
  both production and development mode, keeps every dependency that has a
  consumer knip cannot see, opens a reviewed PR for the rest, and posts one
  summary to #alerts-code-scans. Never deletes silently.
---

# Dependency Hygiene

Find dependencies declared in a `package.json` that nothing consumes, remove
them through a reviewed PR, and report to Slack `#alerts-code-scans`
(`C0AGV547FD0`). CI already fails on unused runtime `dependencies`; this sweep
covers what CI does not gate: `devDependencies`, stale `ignoreDependencies`
entries, and workspaces knip cannot analyze.

## 1. Baseline

Fresh checkout of `main`, then:

```bash
bun install
bunx knip --production --no-gitignore   # must exit 0
```

If the production run is red on `main`, stop and report. The gate is broken;
a cleanup PR is the wrong fix.

`knip.json` sets `devDependencies` to `off`, and `--include devDependencies`
does not override a rule that is `off`. Source devDependency candidates from a
copy of the config with that rule enabled (do not commit it):

```bash
bun -e 'const c = JSON.parse(await Bun.file("knip.json").text().then((t) => t.replace(/^\s*\/\/.*$/gm, ""))); c.rules.devDependencies = "warn"; await Bun.write("/tmp/knip-dev.json", JSON.stringify(c));'
bunx knip --no-gitignore --config /tmp/knip-dev.json --reporter json > /tmp/knip-dev.json.out
```

## 2. Triage every candidate

Knip follows imports. A dependency with no import can still have a consumer.
Before removing a candidate, search its declaring workspace for one:

| Consumer type | Where to look |
| --- | --- |
| CLI bin run from a script | `package.json#scripts` |
| Plugin or preset named as a string | `*.config.*`, `tsconfig*.json#types`, `bunfig.toml#preload`, lint/format configs |
| Build externalization | `tsup.config.*#external`, `next.config.*#serverExternalPackages`, `wrangler.toml` |
| Installed by version at runtime | `Dockerfile` |
| Generated code | `dist/`, `.build/`, SDK generator output, release manifests |
| Stylesheet import | `@import "pkg"` in `*.css` |
| TypeScript project reference | `tsconfig.build.json#references` |
| Version pinned for policy | `catalog:` entries, `check:*-pin` scripts |

A hit anywhere keeps the dependency. If knip flags it every run, add it to
that workspace's `ignoreDependencies` in `knip.json` with a one-line comment
naming the consumer. Never add an ignore without a named consumer, and never
ignore at the root.

Zero hits means remove. Runtime dependencies imported only from tests or
scripts move to `devDependencies` instead.

Exclusions:

- The root `package.json`. Its dependencies are consumed by hooks, workflows,
  and CI jobs that a PR does not exercise. Report root candidates; do not edit.
- Anything preloaded by relative path (for example a shared test config in
  `bunfig.toml`).

## 3. Check knip's own health

- Every `ignoreDependencies` entry in `knip.json` must still have the consumer
  its comment names. Remove the entry if the consumer is gone; the dependency
  then gets triaged like any other candidate.
- Any workspace whose config knip fails to load is a coverage hole. Fix the
  config so it resolves from the repo root (module-relative paths, not
  cwd-relative), or report it.
- New workspaces need an `entry` glob in `knip.json` or their production files
  look unused.

## 4. Validate

```bash
bun install
bun run sync-tsconfig-refs
bun run typecheck
bun run fallow
```

Then the `test` script of every touched workspace. Anything typecheck or a
test pulls back gets restored, not ignored. Merge `main` immediately before
pushing and re-run the above.

## 5. Open PRs

One PR per layer, stacked bottom-up:

1. `chore(deps): remove N unused devDependencies` — manifests, `bun.lock`,
   regenerated tsconfig references. Branch from `main`, PR base `main`.
2. `chore(knip): ...` — only if step 3 changed `knip.json` or a config.
   Branch from the layer-1 branch, PR base = the layer-1 branch. Retarget to
   `main` once layer 1 merges.

Each layer must typecheck on its own. A file belongs to exactly one layer.
Address review by adding commits to the layer that owns the file, never by
amending or force-pushing. Skip layer 2 rather than manufacturing a stack.

Use the repo PR template. The "How was this tested?" section lists the
positive-reference checks, every restoration from step 4, and the consumers
that CI cannot exercise (scheduled and merge-queue-only workflows) as
unverified. Zero findings means no PR.

## 6. Report

One Slack message per run to `#alerts-code-scans`:

- production knip exit code on `main`
- candidates → kept with reference → removed, with PR links
- root candidates (reported, not edited)
- `ignoreDependencies` entries whose consumer is gone
- workspaces knip could not analyze

No cc unless the production gate is red on `main`.

## Gotchas

- `knip --production` does not analyze test, vitest, or astro configs, so a
  dependency imported only there needs an `ignoreDependencies` entry.
- Adding an `entry` glob can surface duplicate-export findings; resolve them
  by removing the redundant alias, not the implementation.
- `dist/` output that is gitignored exists locally but not in CI; exclude it
  in `knip.json` so local and CI results match.

## Precedent

The manual sweep this skill generalizes: #40431, #41148, #41149, #41328,
#41348, #41349.

