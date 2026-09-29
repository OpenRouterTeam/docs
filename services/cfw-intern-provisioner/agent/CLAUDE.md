# Agent Guide

> **Monorepo context:** this is the **shared intern-agent Ori workspace**. It is not built into
> any image: intern VMs run the `ori-runtime` image and seed this workspace on the VM with `ori init`
> (see `../docker/AGENTS.md`). It is intentionally NOT a monorepo workspace member
> (it ships its own `ori` toolchain via `file:.ori/sdk`), and is excluded from the repo's
> typecheck/lint. Per-intern persona is **mounted at runtime** as `/workspace/ori.md`; the baked
> `ori.md` here is only a fallback. See `../RUNBOOK.md` and `../docker/AGENTS.md`.

This is an Ori workspace: a declarative agent (your intern) that you build by adding features under
`features/`. Keep this file short. The authoritative, version-matched guidance lives in the docs below, not
here, so read them rather than relying on what you remember about Ori.

## Read these first

- `.ori/docs/llms.txt` is the index of the full framework docs, mirrored into this project and kept in sync
  with your installed Ori version.
- `.ori/docs/how-to/build-a-feature.mdx` covers building a feature; `.ori/docs/reference/` documents the CLI
  and the capabilities (model, prompt, schedule, chat).
- After you run `ori dev`, Ori materializes its built-in `feature-development` skill into
  `.claude/skills/feature-development/` and `.agents/skills/feature-development/` (the authoring contract and
  validation workflow). Read it before adding or changing a feature.

## Guardrails

When creating or updating Ori features, skills, prompts, harnesses, routes, or other feature contributions:

- Write them only under the active feature root.
- Use root skills at `<active-feature-root>/<feature-id>/SKILL.md`.
- Use nested skills at `<active-feature-root>/<feature-id>/skills/<skill-name>/SKILL.md` when a feature owns several related skills.
- Do not create project skills in `.agents/skills`, `.codex/skills`, a repository-level `skills/` directory, or anywhere outside the active feature root unless the user explicitly asks.
- If the owning feature is unclear, ask before creating files.
- For contribution shapes and authoring details, use the `feature-development` skill.
- `.agents/skills` and `.claude/skills` are generated snapshot views of the active feature root; never edit them. Edits under the active feature root take effect on your next run, not mid-run.

## Commands

- `bun install` - install dependencies.
- `ori dev` - run the intern locally with hot reload.
- `ori features new <name>` / `ori features validate` - scaffold and check a feature.
- `ori logs` - read runtime logs, including why a schedule or run failed.
