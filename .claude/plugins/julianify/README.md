# Julianify Plugin

Migrate pages and components from the OpenRouter design
sandbox into the openrouter-web production monorepo. Handles
import path mapping, styling adaptation, mock data
replacement, and verification.

## Available Commands

| Command              | Description                                    |
| -------------------- | ---------------------------------------------- |
| `/julianify:migrate` | Migrate a design sandbox page or component     |

## Installation

```bash
# For development/testing
claude --plugin-dir ./.claude/plugins/julianify

# Permanent installation (within Claude Code)
/plugin install ./.claude/plugins/julianify --scope user

# From marketplace (after adding to marketplace.json)
/plugin install julianify@openrouter-plugins
```

## Usage

### Migrate a page by URL

```text
/julianify:migrate
```

When prompted, provide:

- **Source**: `/home` (URL endpoint in design sandbox)
- **Target**: `/settings/keys` (URL endpoint in
  openrouter-web)
- **Branch**: `main` (optional, defaults to main)

### Migrate a component by name

```text
/julianify:migrate
```

When prompted, provide:

- **Source**: `ProjectCard` (component name)
- **Target**: `new` (create a new file)

### Migrate by file path

```text
/julianify:migrate
```

When prompted, provide:

- **Source**: `app/(dashboard)/home/page.tsx`
- **Target**: `projects/web/app/[locale]/(home)/page.tsx`

## What It Does

1. Verifies GitHub CLI is installed and authenticated
2. Clones or locates the design sandbox repo locally
3. Resolves source and target file paths
4. Analyzes all imports, child components, and mock data
5. Transforms imports to openrouter-web package paths
6. Replaces mock data with real data fetching
7. Adapts styling to Radix colors and monorepo conventions
8. Adds PostHog analytics to interactive elements
9. Runs lint, typecheck, and visual verification

## Requirements

- GitHub CLI (`gh`) must be installed and authenticated
- Git must be available
- Must be run from the openrouter-web monorepo root

## Uninstallation

```bash
/plugin uninstall julianify
```
