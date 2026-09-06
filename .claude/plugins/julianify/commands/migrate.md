---
description: Migrate design sandbox pages/components to openrouter-web
model: opus
---

# Migrate Design Sandbox to OpenRouter Web

## Workflow

Claude, you need to migrate a page or component from the
OpenRouter design sandbox into the openrouter-web production
monorepo. Follow these steps:

### Step 0: Verify Repository

Check that this is the `openrouter-web` repo:

```bash
git remote get-url origin
```

If the remote does not contain `openrouter-web`, warn the
user that this plugin is designed for `openrouter-web` and
may produce inaccurate import mappings, component APIs, and
conventions in other repos. Use `AskUserQuestion` to ask
whether they want to continue anyway. Stop if they decline.

### Step 0.5: Verify GitHub CLI

Follow the GitHub CLI installation check from
`.claude/plugins/_shared/gh-install-check.md`.

### Step 1: Verify Branch

Ensure you are not on `main`:

```bash
git branch --show-current
```

If on `main`, warn the user and suggest creating a feature
branch before proceeding:

```bash
git checkout -b feat/migrate-<source-name>
```

### Step 2: Gather User Inputs

Use the `AskUserQuestion` tool to collect the following:

1. **Source specification** -- one of:
   - URL endpoint from the design sandbox (e.g. `/home`)
   - File path (e.g. `app/(dashboard)/home/page.tsx`)
   - Component name (e.g. `ProjectCard`)

2. **Target location** -- one of:
   - URL endpoint in openrouter-web
     (e.g. `/settings/keys`)
   - File path
     (e.g. `projects/web/app/[locale]/(user)/settings/keys/page.tsx`)
   - Component name
   - `"new"` to create a new file based on the source type

3. **Source branch** (optional, default: `main`) -- the
   branch in openrouter-design-sandbox to read from.

### Step 3: Locate or Clone the Design Sandbox

Determine the repo root so paths resolve correctly
regardless of the current working directory:

```bash
REPO_ROOT="$(git rev-parse --show-toplevel)"
```

Check whether the design sandbox repo exists locally:

```bash
ls "$REPO_ROOT/../openrouter-design-sandbox" \
  2>/dev/null && echo "found" || echo "not found"
```

If not found, clone it:

```bash
gh repo clone \
  OpenRouterTeam/openrouter-design-sandbox \
  "$REPO_ROOT/../openrouter-design-sandbox"
```

Checkout the specified source branch:

```bash
SANDBOX="$REPO_ROOT/../openrouter-design-sandbox"
git -C "$SANDBOX" fetch origin && \
  git -C "$SANDBOX" checkout <branch> && \
  git -C "$SANDBOX" pull origin <branch>
```

### Step 4: Delegate to Migration Agent

Read the migration agent instructions at
`../agents/migrate.md` and follow them with the resolved
inputs from Step 2.
