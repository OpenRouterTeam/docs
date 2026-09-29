# Infisical Integration Guide

This document explains how to use Infisical for secret management in the OpenRouter development environment.

## Overview

Infisical is our centralized secret management platform that replaces traditional `.env` files with a secure, cloud-based solution. This integration provides:

- **Centralized secret management** across all services
- **Path-based secret isolation** for security
- **Personal overrides** for local development
- **Automatic secret scanning** to prevent leaks
- **Local `.env` file support** for development overrides

## Environments

The `openrouter-web` Infisical project has four environments:

| Slug         | Compliance scope | Tier        | Purpose                                     |
| ------------ | ---------------- | ----------- | ------------------------------------------- |
| `dev`        | standard         | development | Day-to-day local development                |
| `prod`       | standard         | production  | Deployed production secrets                 |
| `hipaa-dev`  | HIPAA            | development | Development credentials inside the BAA scope |
| `hipaa-prod` | HIPAA            | production  | Production credentials inside the BAA scope  |

### The environment registry is the source of truth

Do not hardcode environment slugs. Import them from
[`@openrouter-monorepo/helpers/infisical-environments`](../../packages/helpers/infisical-environments.ts):

```typescript
import {
  DEFAULT_INFISICAL_ENVIRONMENT,
  InfisicalEnvironment,
  parseInfisicalEnvironment,
  STANDARD_INFISICAL_ENVIRONMENTS,
} from '@openrouter-monorepo/helpers/infisical-environments';

// A known environment, as a typed literal
const environment = InfisicalEnvironment.HipaaDev;

// A user-supplied slug (CLI flag, env var) — returns a Result
const result = parseInfisicalEnvironment(process.env.INFISICAL_ENV);
```

The registry also exposes `INFISICAL_ENVIRONMENTS` (a literal tuple suitable for `z.enum()`) and `INFISICAL_ENVIRONMENT_META` (compliance scope and deployment tier per environment).

### HIPAA environments are opt-in, never fanned out

Tooling that writes to "both environments" — `create-provider-key.ts` — iterates `STANDARD_INFISICAL_ENVIRONMENTS`, which resolves to `dev` and `prod` only. This is deliberate: a provider key silently copied into a HIPAA environment would land inside the BAA scope without anyone deciding it belonged there. Adding a secret to `hipaa-dev` or `hipaa-prod` is always an explicit act.

If you intend a secret to exist in a HIPAA environment, pass that environment explicitly rather than widening the fan-out list.

### Bootstrapping a new environment's folder tree

Infisical folders are **per-environment**. A newly created environment has zero folders, so nothing can be written to `/services/cfw-api` there until that path exists — and Infisical does not create intermediate folders, so paths must be created shallowest-first.

`mirror-folder-tree.ts` handles this. It copies folder *structure* only; it never reads, writes, or logs secret names or values.

```bash
# Preview what would be created (dry run is the default)
bun run x scripts/infisical/mirror-folder-tree.ts --target=hipaa-dev

# Actually create the folders
bun run x scripts/infisical/mirror-folder-tree.ts --target=hipaa-dev --execute

# Mirror from a different source environment
bun run x scripts/infisical/mirror-folder-tree.ts --source=prod --target=hipaa-prod --execute
```

The script is idempotent — folders that already exist are counted and skipped, so it is safe to re-run after the source tree grows.

It refuses to run if either tree cannot be fully enumerated, since a partial read is indistinguishable from a small tree. An environment with zero folders is *not* a partial read: `infisical secrets folders get` exits 0 and prints JSON `null` for it, which is how both `hipaa-dev` and `hipaa-prod` read before they were mirrored. A non-zero exit means a genuine failure — an unknown environment slug, for instance, 404s.

### Not yet wired: deploy-time environment selection

This is the current gap. The registry, the CLI scripts, and the `/env-audit` route all understand all four environments, but **nothing selects a HIPAA environment at deploy time**:

- The ~30 `infisical run --env=dev` invocations in `package.json` scripts still hardcode `dev`. The one exception is `services/cfw-api`'s `x:hipaa` script (`--env=hipaa-dev`), which the local HIPAA mirror (`bun run dev:hipaa`) runs under — a local-dev selector, not a deploy-time one.
- Terraform sync resources in `configs/terraform` still hardcode their `environment` values.
- Deploy workflows have no HIPAA environment dimension.

Deploying a service against `hipaa-prod` therefore requires changes to those layers first. That work was intentionally left out of the registry change to keep it reviewable.

### Unverified: hyphenated slugs in secret references

Secret references use the syntax `${environment.folder.KEY}` — for example `${dev._providers.OPENAI_API_KEY}`. Infisical documents no restriction on hyphens in environment slugs, and the `.` delimiter does not conflict with `-`, so `${hipaa-dev._providers.OPENAI_API_KEY}` is expected to resolve. This has **not** been verified empirically, because doing so requires writing a secret into a HIPAA environment. Confirm it with a throwaway secret before relying on cross-folder references there.

## Important CLI Behavior Notes

⚠️ **CLI Limitations Discovered:**

1. **`.infisical.json` path setting is ignored** - The CLI has a bug where it doesn't respect the `path` setting in config files
2. **Nested config files are not supported** - Only the root `.infisical.json` is read
3. **Must use explicit CLI flags** - Always specify `--env=dev --path=/folder` explicitly

## Environment Variable Precedence

The following order determines which environment variables take precedence (highest to lowest):

1. **Repository root `.env.development.local`** (local overrides) - **highest priority**
2. **Infisical secrets** (from cloud) - centralized defaults
3. **Process environment defaults** - lowest priority

⚠️ **Important**: Local `.env.development.local` files will **override** Infisical secrets. This is intentional to allow developers to test with different values locally, but be careful:

- Empty values in `.env.development.local` will override valid Infisical secrets
- Always use `.env.development.local` sparingly and only for values you explicitly want to override
- For most cases, use Infisical Personal Overrides instead (recommended)

This precedence only applies in development environments. In production/staging/preview, `.env.development.local` is completely ignored.

## Folder Organization

Your Infisical project uses folders that **exactly match** the repository directory structure. The Infisical folder structure mirrors the codebase:

```
/
├── /services
│   ├── /cfw-api
│   ├── /cfw-fusion
│   ├── /cfw-public-api
│   ├── /cfw-presidio
│   ├── /cfw-sandbox
│   ├── /gcp-queue-worker
│   ├── /cfw-instrumentation
│   ├── /cfw-docs-proxy
│   ├── /gcp-proxy
│   ├── /usage-record
│   ├── /fake-provider
│   ├── /dev-fs-logs
│   └── /otel
├── /projects
│   ├── /web
│   ├── /mission-control
│   └── /docs
├── /agents
│   └── /agent-<name>
├── /tests
│   ├── /e2e
│   └── /performance
├── /packages
│   └── /clickhouse
│       └── /scripts
├── /configs
│   └── /terraform
└── / (root)
    └── Database operations scripts
```

### Folder Reference

The following folders are available in Infisical, organized by category:

**Services:**

- `/services/cfw-api` - Main Cloudflare Workers API
- `/services/cfw-fusion` - Fusion orchestration worker (panel fanout + judge synthesis)
- `/services/cfw-public-api` - Public-facing Cloudflare Workers API (provisioning, guardrails, workspaces)
- `/services/cfw-presidio` - Presidio PII detection/redaction (Cloudflare Containers)
- `/services/cfw-sandbox` - Containerized tool execution (Cloudflare Containers)
- `/services/gcp-queue-worker` - GCP Pub/Sub queue processor
- `/services/cfw-instrumentation` - Cloudflare Workers instrumentation
- `/services/cfw-docs-proxy` - Documentation proxy service
- `/services/gcp-proxy` - GCP proxy service
- `/services/usage-record` - Usage record service (Spanner-backed)
- `/services/otel` - OpenTelemetry service

**Projects:**

- `/projects/web` - Main Next.js web application
- `/projects/mission-control` - Mission Control dashboard

**Tests:**

- `/tests/e2e` - End-to-end tests
- `/tests/e2e/broadcast` - Broadcast vendor-destination integration tests (CI-only; values are references to `/tests/e2e`)
- `/tests/performance` - Performance tests (k6)

**Agents:**

- `/agents/agent-<name>` - Custom agents (follow naming convention)

**Other:**

- `/` (root) - Database operations and root-level scripts
- `/packages/clickhouse/scripts` - ClickHouse migration scripts
- `/configs/terraform` - Terraform infrastructure configuration

For complete environment variable mappings, see `env.manifest.json`.

## Setup Instructions

### 1. Install Infisical CLI

The CLI is automatically installed via our setup scripts:

```bash
# macOS
brew install infisical/get-cli/infisical

# Linux
# Installed via apt-get by the bootstrap script
```

### 2. Authenticate with Infisical

```bash
infisical login
```

Follow the authentication flow in your browser.

### 3. Verify Configuration

The `infisical secrets` command shows secrets from the root directory (`/`) by default. To view secrets in subdirectories, you must explicitly specify the `--path` argument. These tables print values to your terminal, so run them only as a human at your own machine. Agents don't list secrets; they follow the [infisical-agent-auth skill](../../.agents/skills/infisical-agent-auth/SKILL.md) instead.

```bash
# Shows root (/) secrets only
infisical secrets --env=dev --projectId=771b7bc0-6578-41b0-886e-9fcdb66e9173

# Shows secrets in specific folder paths
infisical secrets --env=dev --path=/projects/web --projectId=771b7bc0-6578-41b0-886e-9fcdb66e9173
infisical secrets --env=dev --path=/services/cfw-api --projectId=771b7bc0-6578-41b0-886e-9fcdb66e9173
infisical secrets --env=dev --path=/services/gcp-queue-worker --projectId=771b7bc0-6578-41b0-886e-9fcdb66e9173
infisical secrets --env=dev --path=/ --projectId=771b7bc0-6578-41b0-886e-9fcdb66e9173
```

**Note:** The CLI doesn't automatically detect the current folder context or respect `.infisical.json` path settings. Always use `--path` explicitly for subdirectory folders.

## Adding New Environment Variables

When adding a new environment variable (e.g., a new provider API key like `EXA_API_KEY`), you need to update multiple places to ensure it works in both development and production.

### Understanding Infisical Folder Structure

Infisical has two types of folders:

**Service/Project Folders** mirror the repository structure and are where secrets are actually consumed:

- `/services/cfw-api` - Main API service (most provider API keys go here)
- `/projects/web` - Web application
- `/projects/mission-control` - Admin dashboard

**Special Folders** are used for centralized secret storage and references:

- `/_providers` - Centralized storage for provider API keys
- `/_shared` - Centralized storage for shared secrets

> **Gotcha:** the Google Vertex credential is the exception to "provider
> keys live in `/_providers`": `GOOGLE_APPLICATION_CREDENTIALS_JSON` (the
> GCP service account used for Vertex) lives in `/_shared` because it is
> shared with GCP services beyond inference. Use `--path=/_shared` when
> testing or collecting fixtures for Vertex; `/_providers` only holds
> `GOOGLE_AI_STUDIO_API_KEY`.

The `_providers` and `_shared` folders allow you to store a secret once and reference it from multiple service folders using the syntax `${environment._providers.SECRET_NAME}`. This avoids duplicating the same API key across multiple folders and improves maintenance and key rotation by having one place to update a key.

### Adding Variables in Development

1. **Add to Infisical (dev environment)**:
   - Go to the Infisical dashboard
   - Navigate to the appropriate folder (e.g., `/services/cfw-api` for API-related secrets)
   - Add the secret with its value in the **Development** environment

2. **Update `env.manifest.json`**:
   - Add the variable name to the appropriate folder path in `env.manifest.json`
   - This file is the source of truth for which variables each service needs

3. **Update the Zod schema** (if the variable is used in code):
   - Add the variable to the relevant env schema file (e.g., `packages/router/env.ts`)
   - Mark it as `.optional()` if the feature should work without it

4. **Validate**:

   ```bash
   bun run x scripts/infisical/validate-infisical-mapping.ts
   ```

### Adding Variables in Production

Production secrets require additional steps since they're deployed to Cloudflare Workers:

> [!WARNING]
> **Manual Cloudflare Setup Required for `cfw-api`**
>
> Due to the high risk of syncing secrets to `cfw-api`, automatic sync has not been enabled yet. Adding production secrets for `cfw-api` must be done manually in Cloudflare.

1. **Add to Infisical (prod environment)**:
   - In the Infisical dashboard, switch to the **Production** environment
   - Add the secret to the same folder path (e.g., `/services/cfw-api`)
   - Ensure the value is set (not empty) - an empty Production value means the feature won't work in production

2. **Add the secret manually in Cloudflare** (for `cfw-api` secrets):
   - Go to the [Cloudflare Workers settings for api](https://dash.cloudflare.com/056879e63aa83db17aadc76220f52953/workers/services/view/api/production/settings)
   - **Carefully verify the secret value before saving** - Cloudflare secrets are one-way encrypted, so you can only see that a secret exists, not its value. It's easy to paste incorrectly or with extra spaces.
   - Add the secret with the same name and production value

### Adding Provider API Keys

Provider API keys (e.g., `EXA_API_KEY`, `OPENAI_API_KEY`) have a specific workflow because internal tooling expects them in `/_providers`:

1. **Store the key in `/_providers`**:
   - Add the actual API key value to `/_providers` folder in Infisical
   - Set values for both Development and Production environments

2. **Create references in service folders**:
   - In `/services/cfw-api`, create a reference using `${dev._providers.SECRET_NAME}` (for dev) or `${prod._providers.SECRET_NAME}` (for prod)
   - In `/projects/mission-control`, create the same reference if needed for endpoint testing
   - `create-provider-key.ts` does this for `dev` and `prod` only — see [HIPAA environments are opt-in](#hipaa-environments-are-opt-in-never-fanned-out)

3. **Update `env.manifest.json`**:
   - Add the variable name to both `/services/cfw-api` and `/projects/mission-control` (if applicable)

4. **Update the Zod schema**:
   - Add to `packages/router/env.ts` or `packages/providers/env.ts`
   - Alternatively, use the helper script: `bun run x scripts/infisical/create-env-var.ts`

### Common Pitfalls

- **Empty Production values**: If you see a secret with a Development value but Production shows "EMPTY", the feature won't work in production. Note: For `cfw-api`, having a Production value in Infisical is not enough - you must also add the secret manually in Cloudflare (see warning above).
- **Missing from manifest**: The variable won't be validated or documented if not in `env.manifest.json`. The manifest is used in CI to validate that all required secrets are present.
- **Shared keys not in `/_providers` or `/_shared`**: If a secret needs to be used in multiple services (e.g., both `cfw-api` and `mission-control`), store it in `/_providers` or `/_shared` and create references in each service folder. Storing directly in a service folder is fine if the key is only needed by that one service.

## Development Workflow

### Running Development Servers

All development scripts now use Infisical automatically with explicit path flags:

```bash
# Root level - uses / path
bun run dev

# Web app - uses /projects/web path
cd projects/web
bun run dev

# CFW API - uses /services/cfw-api path
cd services/cfw-api
bun run dev
```

### Personal Overrides

For local development overrides, you have two options:

#### Option 1: Infisical Personal Overrides (Recommended)

1. Go to the Infisical dashboard
2. Navigate to your project and environment
3. Use the "Personal Overrides" feature to override specific secrets
4. These overrides only affect your local development

#### Option 2: Local .env Files

Create `.env.development.local` at the repository root for local overrides:

```bash
# .env.development.local (at repository root)
DATABASE_URL=postgresql://localhost:5432/my_local_db
API_KEY=my_local_api_key
```

**Note**: Personal Overrides are preferred over local `.env` files for better team consistency and security.

## Database Operations

Database scripts automatically receive environment variables from Infisical:

```bash
# These commands use Infisical with the root (/) path
bun run db:start    # Uses / path
bun run db:reset    # Uses / path
bun run db:types    # Uses / path
```

## Secret Scanning

A pre-commit hook automatically scans added lines in staged files for hardcoded secrets:

- Scans all staged files before commit
- Fails the commit if secrets are detected
- Provides helpful error messages and guidance
- Can be bypassed temporarily if needed (not recommended)

The hook delegates staged-file preparation to
`scripts/infisical/scan-staged.ts`. The script parses Git's NUL-delimited path
output, mirrors added lines into a temporary directory using repository-relative
paths, and then runs `infisical scan --no-git --source` with the repository config
explicitly supplied. It fails closed if a path cannot be materialized, rejects
case-insensitive path collisions, and leaves no bookkeeping files in the scan
tree. Infisical CLI `0.43.121`'s `git-changes` subcommand does not surface
findings from its own staged diff, so the hook does not use that subcommand.
The repository config must declare `[extend] useDefault = true`: an allowlist-only
config silently disables the default detection rules. The default rules remain
enabled here; the measured false-positive rate is approximately 2% of commits
(10 of the last 500 first-parent commits), all from `generic-api-key` findings in
TypeScript test or example code. We accept that local-hook noise rather than
excluding test paths, disabling generic detection, or using global regex suppression.

### Handling False Positives

The hook scans only added lines from each staged file in a temporary directory.
Infisical fingerprints findings as `file:rule:startLine`, so existing
`.infisicalignore` entries cannot match hook findings reliably. The mirrored
temporary path and the added-line offset both differ from the original file.
CLI `0.43.121` has no explicit ignore-path flag for this scan form.

For a false positive in the hook:

1. Inspect the rule and file reported by the hook.
2. Remove the value if it is a real secret.
3. Request a narrowly scoped fixture exception if it is synthetic.
4. Use Infisical Personal Overrides for local development when appropriate.

## Environment Manifest

The `env.manifest.json` file serves as the source of truth for which environment variables each Infisical folder should contain. This manifest is used for:

- **CI/CD validation** - Ensuring all required secrets are present before deployment
- **Automated secret management** - Reference for scripts and automation tools
- **Documentation** - Clear mapping of which variables each service needs

### Structure

The manifest maps Infisical folder paths to arrays of required environment variable names:

```json
{
  "links": {
    "/services/cfw-api": [
      "CLERK_SECRET_KEY",
      ...
    ],
    "/projects/web": [
      "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
      ...
    ]
  }
}
```

### Validation

Run the validation script to check that the manifest matches the actual schema requirements:

```bash
bun run x scripts/infisical/validate-infisical-mapping.ts
```

This script:

- Validates that all required schema variables are present in the manifest
- Checks for extra variables that might not be in use
- Helps maintain consistency between code and secret management

### Quick Reference

Key folders and their primary purposes:

- **Root (`/`)**: Database credentials, core infrastructure secrets
- **`/services/cfw-api`**: Main API service with 190+ variables including all provider API keys
- **`/services/gcp-queue-worker`**: Queue processor with GCP credentials and database access
- **`/projects/web`**: Web application with frontend public variables and auth/payment secrets
- **`/projects/mission-control`**: Dashboard with monitoring and auth secrets
- **`/tests/e2e`**: End-to-end testing credentials
- **`/tests/e2e/broadcast`**: Broadcast integration-test vendor credentials, referenced from `/tests/e2e`, fetched by `ci-broadcast.yaml`
- **`/tests/performance`**: Performance testing credentials
- **`/packages/clickhouse/scripts`**: ClickHouse migration script credentials

For complete variable lists, see `env.manifest.json`.

### Common Variables

Many variables are shared across multiple services:

- **Database**: `PG_US_CENTRAL1_POOL_DB_URL`
- **ClickHouse**: `CLICKHOUSE_URL`, `CLICKHOUSE_USERNAME`, `CLICKHOUSE_PASSWORD`
- **Cache**: `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`
- **Monitoring**: `DD_API_KEY`, `DD_APP_KEY`, `LOG_LEVEL`

### Updating the Manifest

When adding new environment variables to a service:

1. **Update the manifest**: Add variable names to the appropriate folder path in `env.manifest.json`
2. **Add to Infisical**: Create the secret in the Infisical dashboard under the corresponding folder
3. **Validate**: Run `bun run x scripts/validate-infisical-mapping.ts` to ensure consistency
4. **Update schema**: Add to the relevant schema file (e.g., `packages/router/env.ts`) if needed

### Important Notes

- `NEXT_PUBLIC_*` variables are exposed to the browser - **never put secrets in these**
- Many variables are marked as "optional" in code but may be required for full functionality
- Provider API keys can be added incrementally (not all are required for basic operation)
- Database and ClickHouse credentials are often shared - can be placed in root `/` or duplicated per service

## Troubleshooting

### Common Issues

#### "infisical secrets shows empty table"

- **Cause**: The command defaults to root (`/`) folder - if no secrets exist at root, table will be empty
- **Solution**: Use explicit `--path` flag to view secrets in subdirectories: `infisical secrets --env=dev --path=/services/cfw-api --projectId=771b7bc0-6578-41b0-886e-9fcdb66e9173`

#### "Authentication failed"

- Run `infisical login` to re-authenticate
- Check your internet connection

#### "Environment variable not set"

- Check if the variable exists in the correct folder in Infisical dashboard
- Verify the variable name matches exactly
- Test variable access without printing the value: `infisical run --env=dev --path=/ --projectId=771b7bc0-6578-41b0-886e-9fcdb66e9173 -- sh -c '[ -n "$PG_US_CENTRAL1_POOL_DB_URL" ] && echo set || echo missing'`
- To see which names a folder holds, read `env.manifest.json` at the repo root. Don't dump the injected environment with `env` or `printenv`; that prints every value

#### "No secrets in folder"

- Verify you're using the correct path matching the folder structure (e.g., `/services/cfw-api`, `/projects/web`)
- Check the Infisical dashboard to confirm secrets exist in that folder
- Try `infisical secrets folders get` to list available folders

### Debug Commands

```bash
# Check login status
infisical user get token

# List all folders
infisical secrets folders get

# List folders at a path in a specific environment (folders are per-environment)
infisical secrets folders get --env=hipaa-dev --path=/ --projectId=771b7bc0-6578-41b0-886e-9fcdb66e9173

# Check secrets in a specific folder (prints values; run only in a human's terminal, not in an agent session)
infisical secrets --env=dev --path=/projects/web --projectId=771b7bc0-6578-41b0-886e-9fcdb66e9173
infisical secrets --env=dev --path=/services/cfw-api --projectId=771b7bc0-6578-41b0-886e-9fcdb66e9173
infisical secrets --env=dev --path=/ --projectId=771b7bc0-6578-41b0-886e-9fcdb66e9173

# Test a single environment variable (checks presence only; doesn't echo the value)
infisical run --env=dev --path=/ --projectId=771b7bc0-6578-41b0-886e-9fcdb66e9173 -- sh -c '[ -n "$PG_US_CENTRAL1_POOL_DB_URL" ] && echo set || echo missing'

# Run a command with environment variables injected (NEXT_PUBLIC_* values are public)
infisical run --env=dev --path=/projects/web --projectId=771b7bc0-6578-41b0-886e-9fcdb66e9173 -- node -e "console.log(process.env.NEXT_PUBLIC_SITE_URL)"

# To see which names a folder holds, read env.manifest.json at the repo root.
# Don't pipe the injected environment through `env | grep`; that prints every value.
```

## Security Best Practices

1. **Never commit secrets** to version control
2. **Use Personal Overrides** for local development
3. **Regularly rotate secrets** in Infisical
4. **Review secret access** periodically
5. **Use folder-based organization** for isolation
6. **Monitor secret usage** in Infisical dashboard

## Additional Resources

- [Infisical Documentation](https://infisical.com/docs)
- [Personal Overrides Guide](https://infisical.com/docs/documentation/guides/local-development#personal-overrides)
- [Secret Scanning Guide](https://infisical.com/docs/documentation/guides/local-development#secret-scanning)
- [CLI Reference](https://infisical.com/docs/cli/overview)
