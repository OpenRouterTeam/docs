---
name: install-skill
description: Install agent skills with GitHub CLI's `gh skill install`, including parsing skills.sh URLs and replacing legacy `npx skills add` commands. Ensure the matching Claude Code symlink points from `.claude/skills` to `.agents/skills`.
allowed-tools: Bash
user-invocable: true
---

# Install Skill

Install skills into this repository with GitHub CLI's preview skill support.
When a requester says "gh install", provides a `skills.sh` URL, or references
`npx skills add`, use `gh skill install`.

## Preconditions

1. Work from the repository root.
2. Verify GitHub CLI and the skill command are available:

   ```bash
   command -v gh
   gh skill install --help
   ```

   If `gh` reports `unknown command "skill"` (the pinned `gh` on Devin machines is 2.78, which predates the preview), fall back to copying the skill directory from the source repo at the requested tag or SHA, or its default branch when no version was requested, into `.agents/skills/`, then continue with the symlink step. Confirm the copied `SKILL.md` matches the same upstream revision before committing.

3. If the skill source is private, verify auth before installing:

   ```bash
   gh auth status
   ```

## Install

Prefer non-interactive commands with explicit destination flags:

```bash
gh skill install <owner>/<repo> <skill-or-path> --agent codex --scope project
```

## Parse Inputs

For a `skills.sh` URL, treat the first two path segments as the GitHub repo and
the remaining path as the skill name or skill path:

```text
https://www.skills.sh/<owner>/<repo>/<skill-or-path>
```

Install it as:

```bash
gh skill install <owner>/<repo> <skill-or-path> --agent codex --scope project
```

Example:

```bash
gh skill install github/awesome-copilot conventional-commit --agent codex --scope project
```

Do not use legacy `npx skills add`. Replace commands of this form:

```bash
npx skills add https://github.com/<owner>/<repo> --skill <skill-or-path>
```

with:

```bash
gh skill install <owner>/<repo> <skill-or-path> --agent codex --scope project
```

Use these options when needed:

- `--pin <tag-or-sha>` when the requester asks for a specific version.
- `--allow-hidden-dirs` when installing from hidden source directories such as
  `.agents/skills` or `.claude/skills`.
- `--from-local` when installing from a local directory.
- `--force` only when the requester explicitly asks to overwrite an existing
  skill.

For local installs:

```bash
gh skill install <local-skills-repo> <skill-name> --from-local --agent codex --scope project
```

## Ensure Claude Symlink

After install, ensure Claude Code sees the same skill through the repo's
symlink convention.

Set `SKILL_NAME` to the installed directory name, then run:

```bash
mkdir -p .claude/skills

if [ ! -e ".claude/skills/$SKILL_NAME" ] && [ ! -L ".claude/skills/$SKILL_NAME" ]; then
  ln -s "../../.agents/skills/$SKILL_NAME" ".claude/skills/$SKILL_NAME"
fi
```

If `.claude/skills/$SKILL_NAME` already exists and is not a symlink to
`../../.agents/skills/$SKILL_NAME`, stop and ask before replacing it.

Verify both destinations:

```bash
test -f ".agents/skills/$SKILL_NAME/SKILL.md"
test "$(readlink ".claude/skills/$SKILL_NAME")" = "../../.agents/skills/$SKILL_NAME"
test -f ".claude/skills/$SKILL_NAME/SKILL.md"
```

## Report

Finish by reporting:

- The installed skill name.
- The source repo/path and pinned version, if any.
- Whether the Claude symlink was created or already correct.
- Any files changed according to `git status --short`.
