---
name: commit
description: Make atomic commits with Conventional Commits messages. Avoids vague, auto-generated-sounding summaries.
user-invocable: false
---

# Commit skill

Apply these rules every time you stage and commit code.

This skill sets the rules for commit messages and commit granularity. The `git-commit` skill in `.agents/skills/git-commit/SKILL.md` is the user-invocable workflow for running `git commit`; when you run that workflow, the rules in this skill decide what the message says and what goes into each commit.

## Message format

Follow the [Conventional Commits](https://www.conventionalcommits.org/) format:

```text
<type>[optional-scope]: <description>

[optional body]

[optional footer]
```

### Types

The following table lists the allowed types:

| Type | When to use it |
|---|---|
| `feat` | New feature or capability |
| `fix` | Bug fix |
| `refactor` | Code change that neither fixes a bug nor adds a feature |
| `chore` | Maintenance, config, or dependencies, with no production logic |
| `ci` | CI pipeline changes |
| `test` | Adding or updating tests |
| `docs` | Documentation only |
| `style` | Formatting, whitespace, or linting, with no logic change |
| `perf` | Performance improvement |
| `revert` | Reverting a previous commit |
| `build` | Build system or external dependency changes |

For UI changes, use `feat(ui)` or `style(ui)`. Don't use `ui` as a type.

### Scope

The scope is optional. Use the module, package, or feature area in parentheses. Write it in lowercase, with hyphens between words, for example `feat(user-auth)`, not `feat(UserAuth)`.

Pick the narrowest accurate scope. Omit the scope if the change spans many areas.

### Description

The description is the rest of the first line. Follow these rules:

- Start with a lowercase verb in the imperative mood: `add`, `fix`, `remove`, `update`, `swap`, `wire up`.
- Keep the entire first line, including the type and scope, to 72 characters or fewer.
- Describe what changed, not how or why.
- Prefer specific over concise. If you need more than 12 words, the commit is doing too much.

### Body and footers

The body and footers are optional. Follow these rules:

- Add a body only to explain why a change was made or to list constraints and tradeoffs.
- Don't explain what changed in the body. The diff already shows that.
- Don't write a bulleted list of changed files.
- Keep the body to one to three short sentences.
- Use footers for tracking, for example `Refs: #123` or `Closes: #456`.

## Anti-patterns

### Auto-generated-sounding messages

Don't write commit messages that read like a model-generated summary. The following messages are vague, wordy, and sound auto-generated:

```text
# BAD — vague, wordy, sounds auto-generated, uses bullet lists
feat: implement comprehensive error handling improvements
fix: resolve various issues with the authentication flow
refactor: improve code quality and maintainability
chore: update dependencies and fix miscellaneous issues
```

The following messages are specific and direct:

```text
# GOOD — specific, human, direct
feat(auth): add session refresh on 401 response
fix(router): skip schema validation for empty tool args
refactor(alibaba): remove unused applyInputTransforms override
chore: bump @google-cloud/storage to 7.19.0
```

### Red flags in your message

Rewrite the message if it contains any of the following:

- The words "various", "multiple", "several", or "miscellaneous"
- The words "improve", "enhance", or "optimize" without saying what specifically changed
- The words "comprehensive", "robust", or "extensive"
- The word "and" joining two unrelated changes, which belong in two commits
- The word "update" without naming what was updated and to what; `update dependencies` fails, `update eslint to 9.0.0` passes
- The type `refactor` used as a catch-all for mixed feature and fix changes
- The word "implementation", when you can say what the code does instead

## Commit granularity

Each commit is one atomic, reviewable unit.

### When to split

If you find yourself writing "and" in the commit message, split the commit. Use the following guidelines:

- One bug fix is one commit.
- One new feature is one commit, or a small focused series.
- Renaming files and adding new behavior are two commits.

### When not to split

Don't split changes that depend on each other:

- Generated multi-file boilerplate, such as a route, its handler, and its test, is one commit.
- A function and its tests are one commit. Use `feat` or `fix`, not `test`.
- Moving or renaming files and the mechanical import updates that follow are one commit, so that no intermediate commit is broken.

## Staging and Git mechanics

Follow these rules when you stage changes:

- Don't run `git add .`. Stage files deliberately.
- Prefer `git add -p` for atomic commits. If the hunks are too tangled, use `git add` with specific file paths.
- Review staged changes with `git diff --cached` before committing. If you staged lockfiles or large generated files, run `git diff --cached --stat` first to keep the output short.
- Exclude temp files, plans, and screenshots. Exclude generated files unless the repo requires committing them, such as lockfiles or the i18n source catalog after a copy change.
- When you resolve a merge conflict, don't use the Conventional Commits format. Keep the default merge message and append a note about how you resolved the conflict.

## Breaking changes

Append `!` after the type or scope for a breaking change:

```text
feat(api)!: require authentication for public endpoints
```

Alternatively, add a `BREAKING CHANGE:` footer to the commit body.

## Revert format

For reverts during local development, run `git revert COMMIT_SHA --no-edit`. Replace `COMMIT_SHA` with the hash of the commit to revert.

For manual revert commits, use the format `revert: ORIGINAL_SUBJECT (#PR_NUMBER)`. Replace the following:

- `ORIGINAL_SUBJECT`: the first line of the commit you are reverting
- `PR_NUMBER`: the number of the pull request that introduced the commit

## Checklist before every commit

Before you commit, confirm the following:

1. You staged files explicitly, without `git add .`, and reviewed the diff.
2. The message follows the `type(scope): description` format.
3. The description starts with a lowercase imperative verb.
4. The first line is 72 characters or fewer.
5. The message contains no vague words such as "comprehensive", "robust", "various", or "enhance".
6. The body contains no bulleted summary lists.
7. The description names a specific noun and verb.
