# OpenRouter

A high level view of what runs where, and how different components fit together, can be found in [this architecture diagram](https://app.excalidraw.com/s/3YWWiDoDdTr/WqUtRJgCJN). (You'll need to be added to the OpenRouter Excalidraw workspace to access this link.)

## Setup

### 1. Install dependencies

Feel free to skip whatever you know is already installed, and please open a PR for anything that's outdated or needs to be added!

From repo root:
- Install [homebrew](https://brew.sh/): `/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"`
- Install system deps and tooling: `brew bundle`
- Install the right node version: `fnm install`
- Install bun: `curl -fsSL https://bun.sh/install | bash`
  - If you're unable to run `node`/`npm` make sure that you have `eval "$(fnm env --use-on-cd)"` somewhere in your `~/.bashrc` or `~/.zshrc`
- Install project deps: `bun install` (includes `smee-client`
  for webhooks; no global install needed — also auto-generates
  Cloudflare Worker types via `postinstall`)
- Login to infisical for env var mgmt: `infisical login`
- (Optional) Auth for sdk generation: `speakeasy auth login`

<details>
  <summary>Linux docker installation</summary>
  
  For Linux users, we'll need to install docker with the native package manager, since brew can't fully install it.

  ```bash
  sudo apt-get remove -y docker.io docker-doc docker-compose docker-compose-v2 podman-docker containerd runc || true
  sudo apt-get update
  sudo apt-get install -y ca-certificates curl gnupg
  
  # add Docker’s official GPG key + repo
  sudo install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  sudo chmod a+r /etc/apt/keyrings/docker.gpg
  
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
    $(. /etc/os-release && echo $VERSION_CODENAME) stable" \
    | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

  # install engine + buildx + compose plugin
  sudo apt-get update
  sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

  # start it now and on boot
  sudo systemctl enable --now docker

  # fix permissions, so Tilt can access the socket without sudo
  sudo usermod -aG docker $USER
  ```
  
  Then log out of your desktop session and log back in.

</details>

### 2. Start the development server

Run `bun run dev:up` in the repo root. Startup failures include recovery steps.

Memory capacity below 20 GiB selects the `lean` profile; 20 GiB or more selects `full`. Capacity means total host RAM capped by an OS/container memory allowance, not currently free RAM. Both include the same services; Mission Control starts automatically in `full` and on demand in `lean`. Set `TILT_PROFILE=lean` or `TILT_PROFILE=full` before `bun run dev:up` to override. Lean startup prints commands for Mission Control and further service guidance.

See [Local development](.agents/skills/local-dev-env/SKILL.md) for readiness checks, additional services, login, and testing. Use the URLs reported by Tilt; environment and `.env.worktree` overrides can change ports.

| Tilt resource | Default URL | Startup |
| --- | --- | --- |
| `web` | `http://localhost:3000` | Automatic |
| `api` | `http://localhost:8787` | Automatic |
| `frontend-api` | `http://localhost:8795` | Automatic |
| `mission-control` | `http://localhost:3001` | Automatic in `full`, [on demand in `lean`](.agents/skills/local-dev-env/SKILL.md#mission-control); requires `internal` |

There are a number of helpers within the tilt console to perform dev tasks, look for them on each resource's tab.

For example, "Reset DB" on the postgres pane will initialize local postgres. You can re-run this whenever you want to reset your database to a fresh state.

**Note:**
* Environment variables are automatically injected by Infisical. For local overrides, create `.env.development.local` at the repository root. Read more [below](#working-with-environment-variables).
* If you're testing Stripe purchases locally, authenticate the Stripe CLI first with `stripe login`. Then start the `stripe-webhook` Tilt resource or run `stripe listen --forward-to=http://localhost:3000/api/webhooks/stripe` (replace `3000` if `web` is running on a different port). Copy the printed `whsec_...` value into `STRIPE_WEBHOOK_SECRET` in your local `.env.development.local`. This signing secret is separate from `STRIPE_SECRET_KEY`.
* For performance profiling and capturing flamegraphs, see the [cfw-api debugging documentation](./services/cfw-api/README.md#performance-profiling-and-flamegraphs).

### 3. Create a dev account and log in

Use the seeded development account described in [Local development](.agents/skills/local-dev-env/SKILL.md#sign-in). For auth and onboarding tests, see the optional [isolated-user workflow](.agents/skills/local-dev-env/references/isolated_users.md).

For a personal development account, sign in with your OpenRouter Google account. To select a different seed admin, set `DEV_ADMIN_CLERK_USER_ID` in the root `.env.development.local` before rebuilding the database with `bun run db:reset`. That reset replaces local data.

Playwright's `bun run --filter @openrouter-monorepo/test-web-e2e e2e` defaults to the deployed site and reads its credentials from Infisical at `/tests/e2e`. For local route smoke tests, use `cd tests/web-e2e && bun run e2e:local`; see [e2e-testing](.agents/skills/e2e-testing/SKILL.md#frontend-e2e-testing) for target and authentication settings.

### Verification

Run `bun run verify` for formatting, lint, and typechecking. On macOS outside CI, it runs at low process priority with `GOMAXPROCS=8` and a five-minute typecheck timeout; existing `GOMAXPROCS` and `TYPECHECK_TIMEOUT_MS` overrides are preserved.

### Troubleshooting

For migration failures, inspect `tilt logs postgres-migrate` and run `bun run db:status`. The local Postgres container is `openrouter-web_db`.

For occupied ports, stop the running Tilt process (Ctrl+C or SIGTERM its PID), run `tilt down`, then `bun run kill-ports` for remaining service listeners. `tilt down` removes Compose-managed resources but leaves the Postgres container running; stop it with `bun run db:stop` when needed.

To discard local database and emulator volumes, use `bun run dev:teardown`, then `bun run dev:up`.

## Database

OpenRouter uses two primary databases: postgres (through GCP Cloud SQL) and clickhouse (through clickhouse cloud).

Production postgres runs on GCP Cloud SQL (`pg-us-central1`); all queries go through kysely.
Locally, postgres runs in a plain Docker container and migrations are applied with [dbmate](https://github.com/amacneil/dbmate)
via the `bun run db:*` scripts.

### Postgres

Our original and primary store of state. This holds almost everything from users to models to providers to credit purchases.
Billing data for individual chat requests (i.e. generations) is stored in Google Cloud Spanner (see `services/usage-record`)
and dual-written to the ClickHouse `generations` table for scalable analytics powering rankings and internal business
intelligence. The legacy `transactions` Postgres table has been fully deprecated and dropped.

Postgres migrations are stored in the `postgres/migrations/` directory and manage the main PostgreSQL database schema.

#### Browsing the local database

The Supabase Studio UI is gone along with the supabase CLI, so use any Postgres client to inspect the local database. Connect with:

```
postgresql://postgres:postgres@127.0.0.1:54322/postgres
```

Good options:

* [DBeaver](https://dbeaver.io/) — free, cross-platform GUI
* [pgAdmin](https://www.pgadmin.org/) — the classic Postgres admin UI
* IntelliJ / DataGrip — built-in database tool if you're already on JetBrains
* `psql postgresql://postgres:postgres@127.0.0.1:54322/postgres` — no install beyond the Postgres CLI tools
* [pgcli](https://www.pgcli.com/) — psql with autocompletion and syntax highlighting

In [the CI release workflow](.github/workflows/release.yaml) we migrate the Cloud SQL primary (`pg-us-central1`) via dbmate
(`scripts/db-migrate-gcp.ts`). Be careful with column or table drops! It might cause replication issues. When in doubt, ask in #database.

Before opening a migration PR, extract the locks it takes and document them as SQL comments at the top of the file. See `postgres/migrations/AGENTS.md` for the lock analysis procedure.

To create a new migration: `bun run db:migration add_fancy_new_table`

To run any unapplied migrations: `bun run db:migrate`

### ClickHouse

ClickHouse migrations are stored in the `packages/clickhouse/migrations/` and we use the
[`clickhouse-migrations`](https://github.com/VVVi/clickhouse-migrations) package internally. It may make sense to consolidate
around a single sql migration tool at some point, like goose, for both postgres and clickhouse.  Neither of the current
tools are incredible, but good enough.

**Read the [migration guidelines](packages/clickhouse/migrations/REVIEW.md) before writing new migrations.**

Generate a new migration: `bun run ch:migration`

Run unapplied migrations: `bun run ch:migrate`

## Develop Locally

Some common development targets:
* `bun run typecheck` to typecheck
* `bun run format` to run the Oxfmt code formatter
* `bun run lint` to run the linters
* `bun run test` to run unit tests (always located next to the module they test)

**Note:** If you run node commands directly (e.g., `cd services/cfw-api && bun run test`) instead of through turbo, you may see errors like `Failed to resolve entry for package "@openrouter-monorepo/chat-templates"`. This happens because some packages (like `chat-templates`) require compilation before use. Running `bun run compile` at the repo root will fix this. When using turbo-based commands, compilation happens automatically as a dependency.

Check the [package.json](package.json) for other targets, and generally look through the `scripts` folders to see what
else is available, and run them using `bun run x scripts/<file>.ts`

### Working with environment variables

Environment variables are managed through Infisical. See [INFISICAL.md](./scripts/infisical/INFISICAL.md) for complete documentation.

**For local development:**

- **Infisical**: Environment variables are automatically injected when running scripts via `infisical run`. This is the primary method for managing secrets.
- **`.env.development.local`**: Located at the repository root, this file is for local overrides. It can override Infisical values and should contain your personal keys/settings. `bun run dev:up` supplies the local Postgres URL automatically.

**Environment variable precedence:**
1. Repository root `.env.development.local` (local overrides) - highest priority
2. Infisical secrets (from cloud)
3. Process environment defaults

#### To add a new environment variable:

1. Add the secret to Infisical in the appropriate path (see [INFISICAL.md](./scripts/infisical/INFISICAL.md))
2. Add the environment to the child package's `env.ts` file
3. Notify the team to update their Infisical secrets

#### Other environment variables files:

- We use a special `scripts/.env.production.local` file for production scripting/automation/inspection. The scripts that use this file MUST use the prefix `prod-` to avoid confusion with local development.
- API E2E tests load `tests/e2e/.env.local`, which overrides shell values. See `tests/e2e/README.md` for target settings.


### Working with dependencies

[Heuristics for deps vs devDeps](https://github.com/OpenRouterTeam/openrouter-web/pull/32#discussion_r1264780321):

- `dependencies`: front-end library, utils library, anything that gets imported into front-end/back-end code that's eventually get evaluated at runtime (and not "bundled")
- `devDependencies`: compilers, codegen (like tailwindcss), and their plugins, bundlers, anything that's not "imported" at runtime, toolings (except nextjs, which include both a compiler and runtime exports).

By default, we want to `pin` every dependencies in this repo. There are [edge cases](https://docs.renovatebot.com/dependency-pinning/#so-whats-best), but they are relatively rare for our type of project.

To add a new dependency: `bun add dep@version`

To update the dependency: `bun run up dep`

To update all dependencies: `bun run up`

To interactively update all dependencies to latest: `bun run up -irL`

## AI tools

### Claude Code

#### Local Plugin Marketplace

To view and install local plugins from this repository, add the local
marketplace:

```bash
/plugin marketplace add ./
```

This adds the repository's `.claude-plugin/marketplace.json` to your available
plugin sources.

#### Recommended MCP Servers

#### Codanna - Semantic Code Search and Analysis

[Codanna](https://github.com/bartolli/codanna) is a high-performance code navigation and analysis tool that provides semantic code search and relationship tracking. It gives AI assistants "X-ray vision" for understanding complex codebases.

**Key Features:**
- **Semantic Search**: Natural language queries to find code patterns and implementations
- **Multi-language Support**: Rust, Python, TypeScript, Go, PHP
- **Fast Performance**: Parses up to 91,318 symbols/second
- **Relationship Mapping**: Understand function calls, dependencies, and impact analysis
- **AI-Optimized**: Designed specifically for AI code assistants like Claude

**Installation:**
```bash
# Install Codanna globally using Cargo (Rust package manager)
cargo install codanna --all-features

# Initialize Codanna in your project root
codanna init

# Index your codebase (creates .codanna directory with indexed data)
codanna index . --progress
```

**Team Onboarding:**
1. **Install Rust** (if not already installed): https://rustup.rs/
2. **Install Codanna**: Run `cargo install codanna --all-features`
3. **Initialize in OpenRouter**: Run `codanna init` in the repository root
4. **Index the codebase**: Run `codanna index . --progress` (takes ~30 seconds)
5. **Configure Claude Code**: Add the Codanna MCP server to your Claude Code settings

**Configuration in Claude Code:**

```json
"mcpServers": {
  "github": {
    "type": "http",
    "url": "https://api.githubcopilot.com/mcp/",
    "headers": {
      "Authorization": "Bearer <your auth token>"
    }
  },
  // Codanna - Semantic code search and analysis (100% local)
  "codanna": {
    "type": "stdio",
    "command": "codanna",
    "args": [
      "serve",
      "--watch"  // Auto-refresh index when files change
    ],
    "env": {}
  },
  // Sequential Thinking - Step-by-step problem solving
  "sequential-thinking": {
    "command": "npx",
    "args": [
      "-y",
      "@modelcontextprotocol/server-sequential-thinking"
    ]
  },
  // Linear - Issue tracking integration
  "linear": {
    "type": "sse",
    "url": "https://mcp.linear.app/sse"
  },
  // Static Analysis - AST-based symbol and ref search
  "static-analysis": {
    "command": "npx",
    "args": [
      "-y",
      "@r-mcp/static-analysis"
    ]
  }
}
```

#### Other Recommended MCP Servers

- **GitHub**: API access for repository management and code search
- **Sequential Thinking**: Helps break down complex problems into manageable steps
- **Linear**: Integration with Linear issue tracking
- **Static Analysis**: AST-based symbol search and code transformation tools

For full MCP server configuration, see the example JSON configuration above.
