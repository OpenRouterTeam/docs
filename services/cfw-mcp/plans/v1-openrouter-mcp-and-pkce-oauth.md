# v1: OpenRouter MCP Server + PKCE OAuth

**Status:** Planning → awaiting approval

**Branch:** `feat/openrouter-mcp`

**Owner:** Jacky

**Created:** 2026-06-08

---

## 1. Context

### What we're building

A first-party **OpenRouter MCP server**, deployed as a **remote Cloudflare
Worker** at `services/cfw-mcp` (reachable at e.g. `mcp.openrouter.ai`), that
lets a developer working inside an MCP client (Claude Code, Claude Desktop,
Cursor, etc.) integrate OpenRouter into their app. The dev connects by adding
the URL and logging in via OAuth — nothing is installed locally. It is a
**dev-helper**, not a runtime inference client — the dev's own app calls
OpenRouter directly. The server's job is to give the assistant in the dev's
editor enough context (docs, models, pricing, credits, usage, rankings) plus
a single inference tool (`chat-send`) for the agent's own exploratory calls,
plus a **skills** mechanism (see §2.4) that serves curated,
OpenRouter-specific best-practice guidance on demand.

Authentication uses **PKCE OAuth 2.1**, wrapping OpenRouter's existing
auth-code flow in standards-compliant `/oauth/*` endpoints so MCP clients
can log the user in via a browser and receive a long-lived `sk-or-v1-...`
bearer key.

### Two halves of this plan

1. **The MCP server** (`services/cfw-mcp`) — a remote Cloudflare Worker whose
   tool surface is Speakeasy-generated from the monorepo's OpenAPI spec, plus
   hand-written custom tools (`docs-search`, `chat-send`, `view-skill`).
   Connects over Streamable HTTP; clients authenticate via OAuth.
2. **The OAuth endpoints** (in `services/cfw-api` + `projects/web`) — the
   server-side endpoints that make the PKCE flow MCP-spec-compliant
   (RFC 8414 metadata, RFC 7591 Dynamic Client Registration, RFC 6749 token
   endpoint, authorize redirect). **This is the gating dependency** — a remote
   server cannot authenticate a client without it, so the OAuth half is the
   critical path, not a side quest.

The two halves share scaffolding but OAuth gates the usable end-to-end flow.

### Decisions locked with the user (2026-06-08)

| Decision | Choice |
| --- | --- |
| MCP location | `services/cfw-mcp` (remote Cloudflare Worker). |
| Hosting / distribution | Remote-primary (hosted Worker, OAuth). No npx. |
| Standalone `openrouter-mcp` repo | Ignore its code/impl; KEEP learnings. |
| Tool scope | Dev-helper, ~9 tools (see §2.2). Cut all CRUD. |
| API build scope | MCP-side only. One API dependency: Design Arena (below). |
| Design Arena on `/models` | In v1, gated on Ben's API change (§5.5). |
| Compare endpoint | Out of scope. LLM compares via `models-list` data. |
| Tool build method | Speakeasy `mcp-typescript`, generated in-repo. |
| Dynamic mode | Static toolset default; `--mode dynamic` available, not on. |
| Auth | Full PKCE OAuth now (metadata + authorize + token + DCR). |
| OAuth placement | Metadata+authorize in web; token+DCR in cfw-api. |
| Authorize impl | Next.js route handler (validates vs DCR), not a rewrite. |
| Unregistered `client_id` | Reject at `/oauth/authorize` (no log-and-allow). |
| DCR | Build it with a new `mcp_oauth_clients` table (RFC 7591). |
| Skills-over-MCP | In scope — a `view-skill` custom tool (§2.4). |

### Decisions from security review (2026-06-09)

| Decision | Choice |
| --- | --- |
| Code TTL | Reject codes older than 10 min at `/oauth/token` (`created_at` age check; `expires_at` is key expiry, NOT code TTL). |
| `code_challenge_method` at token | NOT a request param. Derived from the stored `auth_codes` row (RFC 7636). Standard clients don't send it. |
| Code↔client binding | New nullable `auth_codes.oauth_client_id` + `oauth_redirect_uri` columns; written via the OAuth path, exact-matched at `/oauth/token`. |
| PKCE methods on `/oauth/*` | **S256 only** (OAuth 2.1 drops `plain`). Legacy `/api/v1/auth/keys` unchanged. |
| Issued-key hygiene | `key_label` = `MCP: {client_name}` (from DCR) so users can find/revoke in dashboard. |
| Resource metadata (RFC 9728) | Served by the Worker at its own origin + `WWW-Authenticate` on 401 (§2.5e). MCP-spec required for discovery. |
| CORS | `Access-Control-Allow-Origin: *` on `/.well-known/*`, `/oauth/register`, `/oauth/token` (browser MCP clients). |
| Loopback redirects (DCR) | Allow `http://localhost`, `http://127.0.0.1`, `http://[::1]` (any port) per RFC 8252; reject other `http`. |
| Authorize errors | Bad `client_id`/`redirect_uri` → flat 400. Everything else (with a valid pair) → 302 to `redirect_uri?error=...&state=...` per RFC 6749. |

> **Revised (2026-06-09):** hosting flipped from stdio/npx-primary
> (`packages/mcp-server`) to **remote-primary** (`services/cfw-mcp`, hosted
> Worker). Rationale: full PKCE OAuth needs a remote server to authenticate
> against. A local stdio server would just take a pasted API key and not
> exercise the OAuth stack at all. Remote-primary makes the OAuth half the
> centerpiece. **No npx/stdio fallback** for v1 (dropped to keep one auth
> path). Sam's separate codemode worker (#18462) is retired regardless, since
> Speakeasy's built-in `--mode dynamic` covers it. Aligns with Robert's
> kickoff brief.

### Key relationships / constraints (from investigation)

- **OpenAPI pipeline:** `bun run generate:openapi` assembles the spec from
  `cfw-api createApp()` + all mounted worker routes via `/doc`,
  post-processes it
  (`packages/sdk-generation/src/openapi/generate-openapi.ts`), and writes the
  final spec to repo-root `openrouter-openapi.yaml` (gitignored) and the
  tracked `projects/legacy-docs/fern/openapi/openapi.yaml`. SDK regen consumes
  `openrouter-openapi.yaml`. **MCP regen must consume the same file** to stay
  in lockstep with the published SDKs.
- **Existing PKCE flow** (what OAuth wraps):
  - Create code: `POST /api/v1/auth/keys/code`
    (`services/cfw-api/src/routes/auth/create-auth-code.ts:26`) —
    **cookie/Clerk auth**, stores `code_challenge`, `code_challenge_method`,
    `app_id` (upserted from referrer), `expires_at` into `auth_codes`.
    **Caution:** `expires_at` is the expiry of the *API key to be created*,
    not a code TTL (column comment,
    `postgres/migrations/20251108021352_add_expires_at_to_auth_codes.sql`).
    Auth codes have **no TTL today** — only single-use protects an
    unredeemed code. `/oauth/token` adds a 10-minute age check off
    `created_at` (§2.5c); it must NOT repurpose `expires_at`.
  - Exchange: `POST /api/v1/auth/keys`
    (`services/cfw-api/src/routes/auth/exchange-auth-code.ts:33`) —
    **public**, validates PKCE (`S256` via `generateSha256CodeChallenge`,
    `plain` pass-through; constant-time compare), single-use via atomic
    `UPDATE auth_codes SET api_key_id WHERE api_key_id IS NULL`
    (`packages/db/api-keys/create.ts:135`). Returns `{ key, user_id }` where
    `user_id` is a salted sha256 (`or_user_...`).
  - `auth_codes` table: `postgres/migrations/20230625231209_auth_codes.sql`.
- **OAuth reference impl:**
  `services/cfw-public-api/src/routes/provisioning/oauth-token.ts:31` —
  form-encoded `POST /oauth/token` returning
  `{ access_token, token_type: 'bearer', ... }`, `grant_type` switch with
  `satisfies never`. **But** it requires client_id+secret (drop for public
  clients) and uses OpenRouter error shape `{error:{message,code}}` (OAuth
  needs `{error, error_description}` → new helper).
- **Gaps that block richer tools** (verified — do NOT attempt as MCP tools):
  benchmarks are internal-only (`/api/internal/v1/`, `hide:true`); app
  rankings are website server-actions only; rankings-daily is
  date-filter-only. The only public ranking surface is
  `GET /api/v1/datasets/rankings-daily`.
- **Rate limiting:** existing auth endpoints have **none**. New
  `/oauth/token` should reuse `checkIPRateLimit(c, RPM_64)`
  (`services/cfw-api/src/utils/cloudflare-ratelimiter.ts:112`, as in
  `create-api-key.ts`).
- **Skills-over-MCP reference:** Timescale's pg-aiguide /
  tiger-skills-mcp-server. Pattern: a `view_skill` tool whose **description
  is built dynamically** from each skill's frontmatter (`name`+`description`);
  input `{ name, path? }`, output `{ name, path, description, content }`;
  skills are `SKILL.md` files with YAML frontmatter (Anthropic Agent Skills
  spec); cached with a short TTL.

---

## 2. Design / Architecture

### 2.0 End-to-end auth flow

```text
MCP Client (Claude Desktop / Cursor / Claude Code)
  0. unauthenticated tool call -> Worker replies 401 +
       WWW-Authenticate: Bearer resource_metadata="https://mcp.openrouter.ai/
       .well-known/oauth-protected-resource"
     client GETs that doc (RFC 9728, served by the Worker, §2.5e)
       -> authorization_servers: ["https://openrouter.ai"]
  1. GET https://openrouter.ai/.well-known/oauth-authorization-server
       (RFC 8414, projects/web)
  2. POST /api/v1/oauth/register   (RFC 7591 DCR, cfw-api) -> client_id
  3. open browser -> GET /oauth/authorize?response_type=code&client_id=...
       &code_challenge=...&code_challenge_method=S256&redirect_uri=...&state=...
       (projects/web route handler -> 302 to existing /auth consent page)
  4. user logs in via Clerk, approves on /auth page
  5. /auth posts to existing create-auth-code (carrying client_id +
       redirect_uri so the code is bound to both, §2.5c),
       redirects to redirect_uri?code=...&state=...
  6. POST /api/v1/oauth/token  (form-encoded; grant_type=authorization_code,
       code, code_verifier, redirect_uri, client_id)   (cfw-api)
       -> { access_token: "sk-or-v1-...", token_type: "bearer",
            scope: "openrouter:all" }
       (an RFC 8707 `resource` param, if sent, is accepted and ignored)
  7. MCP client stores token, sends as Authorization: Bearer on tool calls
```

### 2.1 Service layout (`services/cfw-mcp`)

A Cloudflare Worker, following the conventions of the other `cfw-*` services
(`wrangler.toml`, `submit` deploy script, Tiltfile/CI entries). Use the
`add-cloudflare-worker` skill to scaffold the Worker shell, then drop the
Speakeasy-generated server inside it.

```text
services/cfw-mcp/
  package.json          # @openrouter-monorepo/cfw-mcp; dev/submit/test/regen
  wrangler.toml         # Worker config (Speakeasy quickstart --mcp emits this)
  tsconfig.json         # extends @openrouter-monorepo/typescript-config/base
  README.md             # connect via URL + OAuth login (no local install)
  .speakeasy/
    workflow.yaml       # inputs.location -> ../../openrouter-openapi.yaml
    gen.yaml            # mcp-typescript target; validateResponse: false
  overlays/
    01-sse-strip.yaml           # strip text/event-stream 200s
    02-scopes.yaml              # x-speakeasy-mcp scopes: read | write
    03-disable-inference.yaml   # hide generated inference (chat-send replaces)
    04-disable-mutations.yaml   # hide all create/update/delete
    05-models-filter-fix.yaml   # warn category + supported_parameters
    06-strip-app-attribution.yaml  # x-speakeasy-ignore on App* params
  src/                  # GENERATED by speakeasy (committed)
    mcp-server/
      server.extensions.ts      # HAND-WRITTEN — registers custom tools
      custom/
        docsSearchTool.ts       # HAND-WRITTEN — BM25 over llms-full.txt
        chatSendTool.ts         # HAND-WRITTEN — slim /chat/completions
        viewSkillTool.ts        # HAND-WRITTEN — skills-over-MCP (§2.4)
  skills/               # HAND-WRITTEN skill content (SKILL.md + frontmatter)
```

The server is served over Streamable HTTP from the Worker; there is no local
`bin`/stdio entrypoint. Files never touched by regen and safe to hand-edit:
everything under `overlays/`, `src/mcp-server/server.extensions.ts`,
`src/mcp-server/custom/*`, `skills/*`, `.speakeasy/workflow.yaml`, plus the
Worker shell (`wrangler.toml`, the fetch handler). Everything else under
`src/` is overwritten by `bun run regen`.

### 2.2 Tool surface (final, post-overlay)

v1 ships **9 tools**: 6 generated (`read` scope, except `chat-send` is
`write`) + 3 hand-written custom tools. The use-case column is the
product-level "what does the dev actually use this for."

| Tool | API source | Use case for the developer |
| --- | --- | --- |
| `models-list` | `GET /models` | List the live model catalog OR look up one model by `id` (once Ben's `?id=` filter lands, §5.5). Returns pricing, context length, modalities, supported params, and Design Arena benchmarks (once Ben's field lands), to pick a model and wire the right slug into code. |
| `model-endpoints` | `GET /models/{author}/{slug}/endpoints` | See which providers serve a given model and at what price, latency, throughput, and ZDR status, to choose routing or debug a slow provider. |
| `providers-list` | `GET /providers` | List available providers to configure allow/deny/routing preferences. |
| `rankings-daily` | `GET /datasets/rankings-daily` | See which models are most used/trending by token volume to pick a proven model. |
| `credits-get` | `GET /credits` | Check remaining account credit balance before running a workload. |
| `generation-get` | `GET /generation` | Inspect cost, token counts, and serving provider for a specific generation id to debug spend and routing. |
| `chat-send` | `POST /chat/completions` | Chat with a model and get its response (plain text in/out) for exploratory testing without leaving the editor. |
| `docs-search` | in-process BM25 over `llms-full.txt` | Search OpenRouter's full docs to answer integration questions with correct API usage. |
| `view-skill` | serves bundled `SKILL.md` files | Retrieve a curated, OpenRouter-specific best-practice recipe for a task, loaded on demand. |

`chat-send`, `docs-search`, and `view-skill` are hand-written
(`src/mcp-server/custom/*`); the rest are Speakeasy-generated. `docs-search`
needs no auth (public docs, 1h cache). See §2.7 for why the custom tools are
not generated.

**Cut for v1** (start small, add on demand). Two groups:

- **Account/admin reads** (deferred, not deleted — flip on if demand shows):
  `api-keys-list` (`GET /keys`), `api-keys-get` (`GET /keys/{hash}`),
  `byok-list` (`GET /byok`), `workspaces-list` (`GET /workspaces`). Account
  management, adjacent to the org/workspace admin surface ruled out of scope.
- **Mutate-state, via `04-disable-mutations.yaml`:** every
  `POST/PUT/PATCH/DELETE` op Speakeasy would generate — keys
  create/update/delete, byok create/update/delete, workspaces
  create/update/delete/bulk-member ops, guardrails (entire category),
  observability destinations CRUD, organization member mutations, presets,
  `oauth-create/exchange-auth-code` generated tools, `/models/count`
  (redundant), and all inference POSTs (replaced by `chat-send`).

> **Budget target:** ~400 tokens per tool input schema (the working budget
> from the original handoff). v1 target ≈ 9 tools. If schema bloat exceeds
> budget, apply the int min/max strip and enum trims as follow-ups (noted in
> §6 TODOs).

**Measured tool sizes** (from a prior build's `tools/list` dump; JSON-string
bytes, ≈3.5 chars/token; treat as the baseline to re-measure after our regen,
not a guarantee). Bloat sources are the actionable part:

| Tool | Schema bytes | Bloat source |
| --- | --- | --- |
| `byok-list` | 1625 | 70+ provider enum |
| `chat-send` | 1578 | necessary inference params |
| `models-list` | 937 | category enum (12 values) |
| `api-keys-list` | 541 | limit/offset boilerplate |
| `workspaces-list` | 439 | limit/offset boilerplate |
| `docs-search` | 323 | hand-written, already tight |
| `api-keys-get` | 258 | one required param |
| `byok-get-credential` | 238 | one required param |
| `generations-get` | 225 | one required param |
| `credits-get` | 33 | empty schema |
| `providers-list` | 33 | empty schema |
| `endpoints-list-zdr` | 33 | empty schema |

The `limit`/`offset` pagination boilerplate and the `byok`/`models-list` enums
are the recurring offenders; see §2.7 for the cuts.

### 2.3 Speakeasy generation wiring

- `inputs.location: ../../openrouter-openapi.yaml` (the post-processed,
  SDK-aligned spec — NOT the assembled intermediate, NOT a stale snapshot).
- Pin the Speakeasy CLI version per
  `packages/sdk-generation/AGENTS.md`
  (read the required version from `.speakeasy/workflow.yaml`; do not bump
  casually).
- `bun run regen` (in `services/cfw-mcp`) = `speakeasy run` over overlays.
- CI: add an MCP-regen step to
  `.github/workflows/sdk-auto-regenerate-on-merge.yaml` reusing the generated
  `openrouter-openapi.yaml`, failing the build if committed generated output
  is stale (mirrors the SDK regen job).

### 2.4 Skills-over-MCP (`view-skill` tool)

Mirrors Timescale pg-aiguide. A **single hand-written MCP tool** that
surfaces curated, OpenRouter-specific best-practice "skills" without paying
full-content token cost up front:

- **Tool description is built dynamically** at registration time by scanning
  `services/cfw-mcp/skills/*/SKILL.md`, parsing YAML frontmatter (`name`,
  `description`), and listing each skill as a name + one-line description in
  the tool's description string. This is the "table of contents" the agent
  sees.
- **Input schema:** `{ name: string; path?: string }` — `path` defaults to
  `SKILL.md` (allows bundled resource files later, e.g. `references/foo.md`).
- **Output:** `{ name, path, description, content }` — `content` is the full
  `SKILL.md` body. Validate output with a Zod schema.
- **Storage:** `SKILL.md` files with YAML frontmatter following the Anthropic
  Agent Skills spec (`name:` + `description:` required). Bundled into the
  Worker so they ship with the deployed server.
- **Caching:** parse + cache the frontmatter catalog at startup (and full
  content per-skill on first read); since files are bundled and immutable per
  release, a one-time parse is sufficient.
- **First skill (TODO, future version — not built now):** an "eval the best
  model at the most economical price for the dev's specific code / use-case"
  skill — guides the agent through running a small eval to pick the
  cost-optimal model. Noted here so the directory + tool exist to receive it.

> **Why a tool, not real files:** real Agent Skills require the skill files
> to be on the user's filesystem. Serving them through an MCP tool means any
> MCP client (not just Claude with native skills) gets them, and they version
> with the server. (The reference disables this tool when run as a Claude
> plugin since native skills supersede it. Not relevant to a remote Worker.)

### 2.5 OAuth endpoints — exact shapes

#### (a) Metadata — `GET /.well-known/oauth-authorization-server`

RFC 8414, served from `projects/web` via a `next.config.ts` rewrite to a
route handler (pattern: `projects/web/next.config.ts:748`
`/.well-known/skills`). Static JSON:

```json
{
  "issuer": "https://openrouter.ai",
  "authorization_endpoint": "https://openrouter.ai/oauth/authorize",
  "token_endpoint": "https://openrouter.ai/api/v1/oauth/token",
  "registration_endpoint": "https://openrouter.ai/api/v1/oauth/register",
  "response_types_supported": ["code"],
  "grant_types_supported": ["authorization_code"],
  "code_challenge_methods_supported": ["S256"],
  "token_endpoint_auth_methods_supported": ["none"],
  "scopes_supported": ["openrouter:all"]
}
```

`S256` only — OAuth 2.1 removes `plain`, and every MCP client supports
S256. (The legacy `/api/v1/auth/keys` endpoint keeps accepting `plain`;
the restriction applies to the new `/oauth/*` surface only.) Serve with
`Access-Control-Allow-Origin: *` — browser-based MCP clients (claude.ai
web connectors) fetch this cross-origin.

#### (b) Authorize — `GET /oauth/authorize`

**Decided:** implemented as a **Next.js route handler**
(`projects/web/app/oauth/authorize/route.ts`), NOT a `next.config.ts`
rewrite — the handler can validate `response_type`, `client_id`, and
`redirect_uri` against the DCR registration and return proper OAuth errors
before redirecting. It validates, maps params, then 302-redirects to the
existing `/auth` consent page.

**Decided:** an **unregistered `client_id` is rejected** (no log-and-allow,
no hardcoded fallback). The handler looks the `client_id` up in
`mcp_oauth_clients`; if absent → `invalid_client`. The supplied
`redirect_uri` must also be one of that client's registered `redirect_uris`
→ else `invalid_request`. This means DCR (§2.5d, M6) is a hard prerequisite
of authorize (M5) at runtime, though the two endpoints are built in parallel.

| OAuth param | -> `/auth` param | Validation |
| --- | --- | --- |
| `redirect_uri` | `callback_url` | required; in client's registered set |
| `code_challenge` | `code_challenge` | required (we mandate PKCE) |
| `code_challenge_method` | `code_challenge_method` | `S256` only |
| `state` | `state` | pass-through |
| `client_id` | `client_id` (pass-through) | must match a registered client |
| `response_type` | (must be `code`) | reject otherwise |
| `scope` | (ignored) | keys are full-access |

**Error semantics (RFC 6749 §4.1.2.1):** if `client_id` is unregistered
or `redirect_uri` is not in the client's registered set, return a flat
400 — never redirect to an unvalidated URI. For every *other* failure
(bad `response_type`, missing `code_challenge`, non-S256 method) the
client+redirect pair is already validated, so 302 to
`redirect_uri?error=<code>&error_description=...&state=...` instead of
rendering a 400 page. MCP clients surface redirected errors; they
swallow flat 400s.

**Code↔client binding:** the handler passes `client_id` and the exact
`redirect_uri` through to `/auth`, which forwards them to
create-auth-code so they're stored on the `auth_codes` row (new nullable
`oauth_client_id`, `oauth_redirect_uri` columns — see §2.5c). Because
these transit user-tamperable URL params, create-auth-code
**re-validates** them against `mcp_oauth_clients` whenever a `client_id`
is present (cheap lookup; makes the stored binding trustworthy rather
than attacker-supplied). Rows created via the legacy non-OAuth flow
leave both columns null.

#### (c) Token — `POST /api/v1/oauth/token`

RFC 6749, `services/cfw-api`, new `src/routes/oauth/token.ts`.
**Form-encoded** (per RFC; also accept JSON). Public client — **no
client_secret**. Wraps the existing exchange logic:

- Request: `grant_type=authorization_code`, `code`, `code_verifier`,
  `redirect_uri`, `client_id`. An RFC 8707 `resource` param is
  **accepted and ignored** (MCP clients send it; rejecting unknown
  params breaks them).
- **`code_challenge_method` is NOT a request param.** Standard OAuth
  clients never send it at the token endpoint; per RFC 7636 the server
  derives the method from the stored `auth_codes` row. (The legacy
  exchange compares a client-supplied method at
  `exchange-auth-code.ts:106` — the extracted shared helper must take
  the method from the DB row instead, with the legacy route continuing
  to enforce its equality check on top.)
- Reuses/extracts the `exchange-auth-code.ts` PKCE validation +
  `createKeyFromAuthCode`. On the OAuth path, only `S256` codes are
  redeemable.
- **Adds code↔client binding checks** (RFC 6749 §4.1.3): the stored
  `oauth_client_id` must equal the request's `client_id`, and the stored
  `oauth_redirect_uri` must exactly match the request's `redirect_uri`.
  Codes with null bindings (legacy-flow rows) are NOT redeemable here —
  they belong to the legacy endpoint.
- **Adds a code TTL:** reject codes whose `created_at` is older than
  **10 minutes** (OAuth 2.1 §4.1.2). There is no TTL column today and
  none is needed — the age check uses `created_at`. Do **not** use
  `expires_at`: that column is the expiry of the *issued API key*
  (see §1), and treating it as code expiry would break key-expiry
  semantics.
- Response:
  `{ access_token: "sk-or-v1-...", token_type: "bearer",
  scope: "openrouter:all" }`.
- **Issued-key hygiene:** pass `key_label` = `MCP: {client_name}` (from
  the DCR row) into key creation so users can identify and revoke
  MCP-issued keys in the dashboard.
- Errors: **OAuth shape** `{ error, error_description }` (new helper, not the
  OpenRouter `{error:{message,code}}` shape).
- Rate limit: `checkIPRateLimit(c, RPM_64)`. CORS: `*` (browser clients).

Requires a migration adding two nullable columns to `auth_codes`:

```sql
ALTER TABLE auth_codes
  ADD COLUMN oauth_client_id TEXT,
  ADD COLUMN oauth_redirect_uri TEXT;
```

#### (d) DCR — `POST /api/v1/oauth/register`

RFC 7591, `services/cfw-api`, new `src/routes/oauth/register.ts`. Stores into
a new `mcp_oauth_clients` table:

```sql
CREATE TABLE mcp_oauth_clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id TEXT UNIQUE NOT NULL,
  client_name TEXT,
  redirect_uris TEXT[] NOT NULL,
  grant_types TEXT[] NOT NULL DEFAULT ARRAY['authorization_code'],
  token_endpoint_auth_method TEXT NOT NULL DEFAULT 'none',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

- Request (RFC 7591):
  `{ client_name?, redirect_uris[], grant_types?, response_types?,
  token_endpoint_auth_method? }`.
- Validates `redirect_uris`: each must be `https://` OR loopback
  `http://localhost[:port]` / `http://127.0.0.1[:port]` /
  `http://[::1][:port]` (RFC 8252 §7.3 — loopback IP literals, not just
  the `localhost` hostname; reject all other `http`). Trim, non-empty.
- **Abuse hygiene** (this is an unauthenticated DB write): cap
  `redirect_uris` at 10 entries; cap `client_name` at 256 chars and each
  URI at 2048 chars (Zod `.max()`); generate `client_id` with a CSPRNG
  (`mcp_` + nanoid), never sequential.
- Response:
  `{ client_id, client_id_issued_at, client_name, redirect_uris,
  grant_types, token_endpoint_auth_method }`.
- Rate limit: `checkIPRateLimit(c, RPM_64)`. CORS: `*` (browser clients).
- **Cleanup (deferred, noted in §6):** registrations from clients that
  never complete a flow accumulate; a periodic delete of rows with no
  redeemed code after N days is a follow-up, not v1.

#### (e) Resource metadata — `GET /.well-known/oauth-protected-resource`

RFC 9728, served by the **Worker itself** (`services/cfw-mcp`) at its own
origin. This is how current-spec MCP clients (2025-06-18+) discover the
authorization server: an unauthenticated/invalid-bearer request to the
MCP endpoint gets

```text
HTTP/1.1 401 Unauthorized
WWW-Authenticate: Bearer resource_metadata=
  "https://mcp.openrouter.ai/.well-known/oauth-protected-resource"
```

and the metadata document is static JSON:

```json
{
  "resource": "https://mcp.openrouter.ai",
  "authorization_servers": ["https://openrouter.ai"],
  "bearer_methods_supported": ["header"]
}
```

Without this, clients have no path from the Worker's origin to the
RFC 8414 document on `openrouter.ai` (different origin), and the OAuth
flow never starts. CORS `*` on this route too.

All new `/oauth/*` schemas follow
`packages/router/AGENTS.md`: named
`.openapi('PascalCase')`, examples, `zInt()` for integers, `.nullable()` not
`z.union([_, z.null()])`.

### 2.6 Regen runbook — when the OpenRouter API changes

The MCP tool surface is generated, so it does NOT update itself when the API
ships new endpoints. This is the operational procedure for keeping the MCP in
sync. It runs in two contexts: **manual** (a dev adding/triaging a tool) and
**automated** (CI, see M9).

#### How the spec flows into the MCP

```text
cfw-api routes (createRoute) + mounted worker routes
  -> bun run generate:openapi
       -> assembles via /doc, post-processes
       -> writes openrouter-openapi.yaml (repo root, gitignored)
       -> writes projects/legacy-docs/fern/openapi/openapi.yaml (tracked)
  -> bun run regen  (in services/cfw-mcp = speakeasy run)
       -> reads ../../openrouter-openapi.yaml
       -> applies overlays/01..06 in order
       -> regenerates services/cfw-mcp/src/** (committed)
```

The MCP reads the SAME `openrouter-openapi.yaml` the published SDKs consume,
so a new endpoint that shows up in the SDKs shows up here too — unless an
overlay hides it.

#### Manual steps when the API ships something new

1. Regenerate the spec: `bun run generate:openapi` (root).
2. Regenerate the MCP: `cd services/cfw-mcp && bun run regen`.
   - Pin the Speakeasy CLI to the version in `.speakeasy/workflow.yaml`
     first (see the speakeasy skill rule); a mismatched CLI produces a
     different diff than CI expects.
3. Diff `services/cfw-mcp/src/mcp-server/tools/` — did a new tool appear?
4. For each new tool, **decide and record the decision in an overlay**:
   - **Useful for the dev-helper persona** (read-oriented: models, endpoints,
     providers, credits, generations, rankings, parameters)? Ensure it gets a
     `read` scope in `overlays/02-scopes.yaml` so it's mounted by default.
     Add a `# Why:` comment.
   - **Mutate-state or dashboard-only** (create/update/delete, org admin,
     billing)? Add it to `overlays/04-disable-mutations.yaml` with a `# Why:`
     comment so the rationale lives next to the cut.
   - **Inference (SSE) op** we want as a tool? It needs the SSE 200 stripped
     in `overlays/01-sse-strip.yaml` or Speakeasy skips it. (For chat we use
     the hand-written `chat-send` instead and disable the generated op.)
5. Re-check the token budget: run the server, call `tools/list`, confirm each
   new tool's input schema is within the ~400-token budget (§2.2). If a new
   enum/param blows the budget, apply a trim overlay (§6 micro-cuts).
6. `bun run test` in the service + smoke-test `tools/list` against the Worker
   (`wrangler dev`).
7. Commit the regenerated `src/` **alongside** the overlay change in one
   commit — never commit a regen without the overlay decision that produced
   it.

#### Automated guard (CI)

M9 adds an MCP-regen step to
`.github/workflows/sdk-auto-regenerate-on-merge.yaml` (and the PR check in
`openapi-pr-comment.yaml`). It runs `generate:openapi` + `regen` and **fails
the build if the committed `services/cfw-mcp/src/` is stale** vs the
regenerated output. This is what stops overlays from silently rotting when
someone changes the API without re-running regen. New tools still require the
human triage in step 4 — CI catches drift, not intent.

#### When in doubt

A newly generated tool defaults to **mounted** if it's a `GET` (the
`02-scopes.yaml` wildcard assigns `read` to all GETs). So the failure mode is
"an unwanted read tool quietly appears," not "a tool silently vanishes." The
diff in step 3 + the budget check in step 5 are the catches; treat any
unexpected new tool in the `tools/` diff as a triage TODO before merge.

### 2.7 Token-optimization knowledge (institutional — do not re-derive)

The MCP tool list is injected into the client's context every conversation,
so input-schema bytes are not free. This subsection preserves what a prior
build learned so we don't repeat dead ends. Apply the proven win in M2;
the rest are §6 follow-ups.

#### App-attribution strip — the proven win (~3k tokens, do this in M2)

Upstream OpenAPI defines three header params under `components.parameters`:
`AppIdentifier` (`HTTP-Referer`), `AppDisplayName` (`X-OpenRouter-Title`),
`AppCategories` (`X-OpenRouter-Categories`). They `$ref` from ~141
operations, each carrying a multi-sentence description — ~150 tokens per tool
× the toolset. They are marketplace-ranking headers an MCP agent never needs.

**The technique that works** (`overlays/06-strip-app-attribution.yaml`): set
`x-speakeasy-ignore: true` on the three **component definitions**. Speakeasy
then excludes every operation's `$ref` to them from the generated tool
surface, but the components stay so refs resolve and the linter is happy.

```yaml
actions:
  - target: $.components.parameters.AppIdentifier
    update: { x-speakeasy-ignore: true }
  - target: $.components.parameters.AppDisplayName
    update: { x-speakeasy-ignore: true }
  - target: $.components.parameters.AppCategories
    update: { x-speakeasy-ignore: true }
```

Verify post-regen:
`grep -rE "httpReferer|xOpenRouterTitle|xOpenRouterCategories" src/` → 0.

**Two approaches that FAILED — do NOT re-try:**

- Deleting the components + filter-removing each `$ref` via JSONPath
  `$.paths..parameters[?(@.$ref=="...")]`. Speakeasy's overlay engine
  (vmware-labs/yaml-jsonpath) does not match `?(@.$ref==...)` against `$ref`
  keys (the `$` sigil). Result: refs stayed, components were deleted, every
  op 500'd the linter with `key AppCategories not found`.
- RFC 9535 filter syntax (`x-speakeasy-jsonpath: rfc9535`) — Speakeasy
  applied the actions silently without matching.

#### Not-yet-cut opportunities (ranked; §6 follow-ups, not M2 blockers)

1. **Strip int min/max noise.** Every integer field carries
   `"minimum":-9007199254740991,"maximum":9007199254740991` (JS safe-int
   range). ~14 instances × ~75 bytes ≈ 300 tokens. Needs a Speakeasy hook or
   a post-gen pass on the generated Zod schemas.
2. **Trim the BYOK provider enum.** The field is `anyOf: [enum, string]` so
   freeform is already allowed; the 70-value enum just bloats. ~800 bytes.
3. **Trim the `models-list` category enum.** Same `anyOf: [enum, string]`
   shape; 12 hardcoded categories. ~250 bytes.
4. **De-duplicate list-tool pagination descriptions.** Every list tool
   repeats "Maximum number of records to return (max 100)" / "Number of
   records to skip for pagination." ~1KB across 5+ tools. Overlay or hook.

#### Why these tools are hand-written (not generated)

- **`chat-send`** — the generated `chatCompletions` input schema is ~5KB (all
  params, modalities, tool defs, streaming hints). The hand-written wrapper is
  ~1.6KB: plain text in/out only, no multimodal, no streaming (MCP returns a
  single response anyway). The generated op is disabled in
  `03-disable-inference.yaml`.
- **`docs-search`** — no underlying API endpoint to generate from; BM25 runs
  in-process over `openrouter.ai/docs/llms-full.txt` (public, no auth),
  corpus cached 1h.
- **`view-skill`** — no API endpoint; serves bundled `SKILL.md` files (§2.4).

Adding a future custom tool follows the same recipe: disable the generated
equivalent (if any) via overlay, add the file under `src/mcp-server/custom/`,
register it in `server.extensions.ts`'s `registerMCPExtensions` hook.

---

## 3. Scenario Map

### A — MCP client during OAuth handshake

| # | State | What happens | Coverage |
| --- | --- | --- | --- |
| A1 | Metadata discovery | RFC 8414 JSON returned | OK — M5 |
| A2 | DCR, valid loopback redirect | `client_id` issued, stored | OK — M6 |
| A3 | DCR, non-loopback `http://` | reject `invalid_redirect_uri` | OK — M6 |
| A4 | DCR, empty `redirect_uris` | 400 OAuth error | OK — M6 |
| A5 | Authorize, bad `response_type` (valid client) | 302 to redirect with `error=unsupported_response_type` | OK — M5 |
| A6 | Authorize, unregistered `client_id` | flat 400 (no redirect) | Decided: M5 |
| A7 | Authorize, redirect not registered | flat 400 (no redirect) | M5/M6 |
| A8 | Authorize, no `code_challenge` | 302 with `error=invalid_request` | OK — M5 |
| A9 | Token, happy path | `{access_token, token_type, scope}` | OK — M7 |
| A10 | Token, wrong `code_verifier` | 400 `invalid_grant` | OK — M7 |
| A11 | Token, code older than 10 min | 400 `invalid_grant` (`created_at` age) | OK — M7 |
| A12 | Token, `redirect_uri` mismatch | 400 `invalid_grant` (stored binding) | OK — M7 |
| A13 | Token replay (redeemed) | 400 `invalid_grant` (single-use) | OK |
| A14 | Two concurrent exchanges | one wins, other `invalid_grant` | OK |
| A15 | Token, JSON body | accepted (dual content-type) | OK — M7 |
| A16 | Token, `client_id` ≠ stored `oauth_client_id` | 400 `invalid_grant` | OK — M7 |
| A17 | PKCE bypass (method, null chal) | 403 (existing guard) | OK |
| A18 | Token, legacy code (null bindings) | 400 `invalid_grant` (wrong endpoint) | OK — M7 |
| A19 | Token, `resource` param present | accepted, ignored (RFC 8707) | OK — M7 |
| A20 | Authorize, `plain` method | 302 with `error=invalid_request` (S256 only) | OK — M5 |
| A21 | Unauthed Worker call | 401 + `WWW-Authenticate` → RFC 9728 doc | OK — M1 |
| A22 | Browser client preflight (CORS) | metadata/register/token allow `*` | OK — M5–M7 |

### B — Developer in MCP client (post-auth tool use)

| # | State | What happens | Coverage |
| --- | --- | --- | --- |
| B1 | Calls `models-list` | proxies `GET /models` with bearer | OK — M3 |
| B2 | Calls `rankings-daily` | proxies the rankings API | OK — M3 |
| B3 | Calls `chat-send` | slim wrapper hits `/chat/completions` | OK — M4 |
| B4 | Calls `docs-search` | in-process BM25, no auth | OK — M4 |
| B5 | `view-skill`, known name | returns full `SKILL.md` content | OK — M8 |
| B6 | `view-skill`, unknown name | error listing available skills | OK — M8 |
| B7 | Bearer key invalid/revoked | upstream 401 surfaced to agent | OK |
| B8 | Asks "compare A vs B" | agent uses `models-list` data | By design |
| B9 | Asks for benchmarks/app ranks | not available; via docs | Documented |

### C — Operator / maintenance

| # | State | What happens | Coverage |
| --- | --- | --- | --- |
| C1 | API ships a new endpoint | regen picks up; triage overlay | OK — M2/§6 |
| C2 | OpenAPI spec shape changes | CI fails if MCP output stale | OK — M9 |
| C3 | Speakeasy CLI version drift | pinned version per skill rule | OK — M2 |

> All gaps resolved inline above (A6 decided = reject; PKCE mandated;
> redirect_uri binding + expiry re-check added as explicit M7 tasks). No open
> gaps remain.

---

## 4. Milestones

> TDD is required. Within each milestone, test tasks precede implementation
> tasks. Independent milestones flagged for parallelization.

### Milestone 0: Branch & plan

**Goal:** Land the plan on a feature branch.

- [x] Create/switch to `feat/openrouter-mcp`
- [ ] Commit this plan file
- [ ] Run `/update-docs` check on the plan (catch stale docs surfaced by the
  investigation)

### Milestone 1: Worker scaffold

**Goal:** An empty-but-wired `services/cfw-mcp` Cloudflare Worker that builds,
typechecks, lints, deploys via `wrangler dev`, and answers `tools/list` over
Streamable HTTP.

- [ ] Scaffold the Worker shell with the `add-cloudflare-worker` skill
  (`wrangler.toml`, Tiltfile/CI entries, deploy `submit` script)
- [ ] **Test harness decision (audit 2026-06-09):** no existing repo
  harness speaks MCP/Streamable HTTP (`tests/e2e` `callApi`, cfw
  integration `SELF.fetch`, web-e2e Playwright are all plain HTTP).
  Tool-level tests use an `@modelcontextprotocol/sdk` `Client` connected
  over Streamable HTTP to `wrangler dev`. M3/M8/M9 reuse this harness —
  without it, "test `tools/list`" degenerates into manual curl checks.
- [ ] Write failing smoke test (via that harness): `wrangler dev` serves
  the MCP endpoint and `tools/list` returns the custom tools (initially
  empty/stub)
- [ ] `package.json` (`@openrouter-monorepo/cfw-mcp`, scripts:
  `dev`/`submit`/`test`/`regen`), `tsconfig.json` (extends base), add to
  workspaces
- [ ] `@modelcontextprotocol/sdk` dependency (pin version, verify latest via
  WebSearch); wire the Streamable HTTP transport into the Worker fetch handler
- [ ] **Auth/discovery shell (MCP spec):** missing/invalid bearer → `401`
  with `WWW-Authenticate: Bearer resource_metadata="..."`; serve the
  RFC 9728 `/.well-known/oauth-protected-resource` doc (§2.5e) with CORS
  `*`; validate the `Origin` header on the Streamable HTTP endpoint
  (MCP transport spec, DNS-rebinding defense)
- [ ] **Logging hygiene:** ensure request logging never captures
  `Authorization` headers or token values (test for it)
- [ ] Confirm `bun run typecheck`, `bun run lint`, turbo task participation

### Milestone 2: Speakeasy generation wiring

**Goal:** `bun run regen` produces the generated tool surface from the
monorepo spec.

- [ ] Write the 6 overlays (`overlays/01..06`) — scopes, disables,
  attribution strip, sse-strip, models-filter-fix
- [ ] `.speakeasy/workflow.yaml` (`inputs.location` ->
  `../../openrouter-openapi.yaml`) + `gen.yaml` (target `mcp-typescript`)
- [ ] Pin Speakeasy CLI version per the speakeasy skill rule
- [ ] Run `bun run generate:openapi` then `bun run regen`; commit generated
  `src/`
- [ ] Verify `tools/list` shows the §2.2 generated tools and NONE of the
  disabled mutations
- [ ] **Verification:** `grep` confirms app-attribution headers absent; tool
  count ≈ 16

### Milestone 3: Verify generated read tools

**Goal:** The generated read tools work against staging with a bearer key.
Parallel with M5–M7.

- [ ] e2e/manual test (M1 MCP-client harness): `models-list`,
  `rankings-daily`, `credits-get`, `generation-get` outputs **parse with
  the production response Zod schemas** (per testing rules: no
  `z.unknown()` envelopes, no exists-only checks — "valid shapes" is not
  an assertion)
- [ ] Confirm `scopes-overlay` default mount = `[read]`; account-read tools
  present, mutations absent
- [ ] **Design Arena benchmarks (gated on Ben's `/models` change, §5.5):**
  once the `benchmarks` field lands, regen, confirm `models-list` surfaces it,
  and update the tool description. Coordinate with Ben on field shape/timing.
- [ ] **`?id=` lookup (gated on Ben's `/models` filter, §5.5 item 3):** once
  it lands, regen, confirm the `id` param appears in the `models-list` tool
  and returns one model; update the `models-list` description to cover
  list-or-lookup. No separate tool.

### Milestone 4: Custom tools — docs-search + chat-send

**Goal:** The two hand-written non-generated tools.

- [ ] Failing tests for `docs-search` (BM25 ranking over a fixture corpus)
  and `chat-send` (request shaping, text-only)
- [ ] Implement `custom/docsSearchTool.ts` (BM25 over `llms-full.txt`, 1h
  cache)
- [ ] Implement `custom/chatSendTool.ts` (slim `/chat/completions` wrapper,
  Zod-validated)
- [ ] Register both in `server.extensions.ts`; confirm they survive `regen`
- [ ] **Verification:** schema bytes within ~400-token budget

### Milestone 5: OAuth metadata + authorize (projects/web)

**Goal:** Discovery + authorize redirect live. Parallel with M6/M7.

- [ ] Failing test: `/.well-known/oauth-authorization-server` returns valid
  RFC 8414 JSON (S256-only, `scopes_supported`) with CORS `*`
- [ ] Failing tests: `/oauth/authorize` maps params + 302s to `/auth`;
  flat-400s unregistered `client_id` / unregistered `redirect_uri`;
  **error-redirects** (302 with `error=` + `state`) for bad
  `response_type`, missing `code_challenge`, `plain` method (per §2.5b
  error semantics)
- [ ] Implement metadata route handler + `next.config.ts` rewrite
- [ ] Implement `app/oauth/authorize/route.ts` (validate, map, redirect;
  pass `client_id` + exact `redirect_uri` through to `/auth` for the
  code↔client binding, §2.5b)
- [ ] Extend `/auth` → create-auth-code to forward + store
  `oauth_client_id`/`oauth_redirect_uri`, with create-auth-code
  re-validating both against `mcp_oauth_clients` when `client_id` is
  present (params transit user-tamperable URLs)
- [ ] **Verification:** browser hits `/oauth/authorize?...` → lands on
  `/auth` consent with correct params; resulting `auth_codes` row has
  both binding columns set

### Milestone 6: DCR endpoint + table (cfw-api + DB)

**Goal:** `POST /api/v1/oauth/register` with `mcp_oauth_clients`. Parallel
with M5/M7.

- [ ] `bun run db:migration mcp_oauth_clients` (table per §2.5d) **and**
  the `auth_codes` binding columns (`oauth_client_id`,
  `oauth_redirect_uri`, §2.5c); `bun run db:types`
- [ ] Kysely queries for insert/lookup by `client_id` (per
  writing-kysely-queries skill)
- [ ] Failing unit + integration tests (workerd, real Postgres per cfw
  integration rules): register stores client + returns
  `client_id`/`client_id_issued_at`; accepts `localhost`/`127.0.0.1`/
  `[::1]` loopbacks; rejects non-loopback http; rejects empty
  `redirect_uris`; rejects >10 URIs / oversized `client_name`
- [ ] Implement `src/routes/oauth/register.ts` + schemas (named `.openapi`,
  examples); CSPRNG `client_id` (`mcp_` + nanoid)
- [ ] Mount under `/api/v1/oauth`; `checkIPRateLimit(RPM_64)`; CORS `*`
- [ ] **Verification:** `bun run generate:openapi` → 0 warnings/hints;
  register appears in spec

### Milestone 7: Token endpoint (cfw-api)

**Goal:** `POST /api/v1/oauth/token` wrapping the PKCE exchange in OAuth
format. Parallel with M5/M6.

- [ ] Extract shared PKCE-exchange logic from `exchange-auth-code.ts` into a
  reusable helper (impact-scan callers first). The helper takes the
  challenge method **from the stored `auth_codes` row** (RFC 7636), not
  from the request; the legacy route keeps its client-supplied equality
  check on top (`exchange-auth-code.ts:106`)
- [ ] Failing tests: form-encoded body; JSON body; happy path returns
  `{access_token, token_type, scope}`; `invalid_grant` on bad verifier /
  code older than 10 min (`created_at` age, NOT `expires_at` — see §2.5c) /
  mismatched `redirect_uri` / mismatched `client_id` / legacy code with
  null bindings / replayed code; concurrent-exchange single-use; `resource`
  param accepted+ignored; **no `code_challenge_method` in the request**
  (standard clients omit it — must succeed); OAuth error shape
  `{error, error_description}`
- [ ] **Harness note (audit 2026-06-09):** the TTL test (A11) and the
  concurrent-exchange test (A14) MUST be workerd **integration** tests
  (real Postgres), not unit tests. A11 needs a direct DB write to
  backdate `created_at` (you can't age a code 10 min in a live flow);
  A14's atomic single-use `UPDATE ... WHERE api_key_id IS NULL` race is
  unprovable against mocks — the existing
  `exchange-auth-code.test.ts` mocks `getAuthCode` entirely and cannot
  see it. Unit tests cover the rest.
- [ ] Implement `src/routes/oauth/token.ts` + OAuth error helper +
  code↔client binding checks + 10-min code age check + `key_label` =
  `MCP: {client_name}`
- [ ] Mount under `/api/v1/oauth`; `checkIPRateLimit(RPM_64)`; CORS `*`
- [ ] **Legacy regression check:** after extracting the shared helper,
  run `tests/hurl/07-oauth-pkce.hurl` + `08-oauth-pkce-errors.hurl`
  against the local stack — they pin the legacy endpoint's S256 / plain /
  no-PKCE / replay / method-mismatch behavior and are not in CI
  (`run-all.sh` is manual). Do NOT copy hurl 08's assertions into the
  new tests: it asserts HTTP 500 for invalid code/verifier, which the
  integration rules ban; `/oauth/token` returns 400 `invalid_grant`.
- [ ] **Verification:** `bun run generate:openapi` → 0 warnings/hints; token
  appears in spec (or correctly hidden if we choose `hide:true`)

### Milestone 8: Skills-over-MCP (view-skill tool)

**Goal:** The `view-skill` custom tool with dynamic catalog description.

- [ ] Failing tests: dynamic description lists fixture skills (name+desc from
  frontmatter); `view-skill {name}` returns `{name,path,description,content}`;
  unknown name errors with available list; `path` defaults to `SKILL.md`
- [ ] Implement `custom/viewSkillTool.ts` (frontmatter parse, catalog cache,
  content read, Zod output)
- [ ] Create `skills/` dir + a placeholder/example skill so the tool has
  content
- [ ] Register in `server.extensions.ts`
- [ ] **TODO note in code + plan:** add the "eval best model at most
  economical price for dev's use-case" skill in a future version (not built
  now)
- [ ] **Verification:** `tools/list` shows `view-skill`; calling it returns
  content

### Milestone 9: Full remote OAuth→MCP e2e + CI regen + deploy

**Goal:** The whole flow works end-to-end against the deployed Worker; CI
keeps the MCP in sync.

- [ ] e2e test (model on
  `tests/web-e2e/suites/smoke/oauth-pkce.test.ts`): register → authorize →
  callback → token → connect to the Worker with the `access_token` (M1
  MCP-client harness) → call `models-list` and `chat-send`
- [ ] **Known hazard (audit 2026-06-09):** the model test is currently
  `test.fixme`'d — OPE-4895, the `/auth` consent flow exceeds the 60s
  timeout since #20432. The new e2e goes through the SAME consent page
  and inherits the problem. Before writing it: check OPE-4895 status;
  if unfixed, budget a longer timeout or land an API-level consent step
  for tests. Do not ship M9 with this test `fixme`'d.
- [ ] **Environment pairing:** the flow spans three deploy targets (web
  `:3000` for metadata/authorize, cfw-api `:8787` for register/token,
  the new Worker for MCP). State explicitly in the test README which
  pairing each run targets (full local stack vs deployed staging); a
  mixed pairing produces redirect-URI and issuer mismatches that look
  like product bugs.
- [ ] **Cleanup:** each run mints a real `sk-or-v1` key + a
  `mcp_oauth_clients` row, and the smoke suite runs DAILY by cron
  against a deployed environment (`smoke-test-web-daily.yaml`), not on
  PRs — so state accumulates. The test must delete its key (find it by
  the `MCP: {client_name}` label; the old test deleted via web UI since
  the API DELETE needs a provisioning key) and use a recognizable DCR
  `client_name` (e.g. `e2e-mcp-smoke`) so rows are sweepable until DCR
  GC (§6) exists.
- [ ] Add MCP-regen step to
  `.github/workflows/sdk-auto-regenerate-on-merge.yaml` (fail if committed
  gen output stale)
- [ ] Deploy the Worker (`wrangler` / `submit`); confirm the public URL +
  route (e.g. `mcp.openrouter.ai`)
- [ ] README: connect via URL + OAuth login (e.g.
  `claude mcp add --transport http openrouter <url>`); no local install
- [ ] **Verification:** from a fresh MCP client, add the URL, complete the
  OAuth browser login, and call one `chat-send` end-to-end

### Milestone 9.5: Alpha-launch readiness

**Goal:** The packaging/hosting decisions that gate a usable alpha, separate
from the build itself.

- [ ] **Cloudflare route (path-based, no subdomain):** bind
  `openrouter.ai/mcp*` to the `mcp` worker. The apex `openrouter.ai/*`
  already routes to Vercel, so the worker route MUST be more specific than
  (and ordered above) the Vercel route or `/mcp*` falls through to the web
  app. Verify: `curl https://openrouter.ai/mcp` returns `ok` from the
  worker. Public URLs are `openrouter.ai/mcp/mcp` (endpoint),
  `openrouter.ai/mcp/.well-known/oauth-protected-resource` (RFC 9728).
- [ ] **Infisical prod path:** create `/services/cfw-mcp` in project
  `771b7bc0-6578-41b0-886e-9fcdb66e9173` (env `prod`). Worker vars have
  safe defaults in `wrangler.toml`; add the `CacheEnv` vars
  (`UPSTASH_REDIS_*`, `CF_KV_API_TOKEN`) only if docs-search caching is
  KV/Redis-backed in prod.
- [ ] **OAuth endpoints live on `openrouter.ai`:** the worker's RFC 9728
  doc points clients at `https://openrouter.ai` for
  authorize/token/register — those ship in cfw-api + projects/web and go
  live with the normal web/api deploy. Login can't be tested until the
  worker route AND this deploy are both in place.
- [ ] **Speakeasy licensing:** `mcp-typescript` is not on the org's
  approved target list (generates fine, warns). Resolve before the
  `mcp-regen-check` / merge-regen CI is relied on in prod.
- [ ] **Confirm `chat-send` scope.** It's `write` with rate limiting via the
  Worker; confirm the limit and that the agent reaching it degrades cleanly.
- [ ] **Dev-helper framing in README:** state explicitly that inference
  endpoints are deliberately NOT exposed (the dev's app calls OpenRouter
  directly); the server gives the editor agent context + `chat-send` for its
  own exploratory calls. Prevents "why can't I run inference through this."
- [ ] **Secrets via the Worker env, not committed.** No `.env` in the repo;
  the OAuth flow issues the user's key at runtime.
- [ ] **Verification:** a new user adds the URL in their MCP client, logs in
  via OAuth, and `tools/list` + one `chat-send` work with zero local setup.

### Milestone 10: Post-completion audit (gate before PR)

**Goal:** All 8 PDD post-completion steps green.

- [ ] Skill-audit review (every YES skill executed)
- [ ] `powerups:drift-audit` (additive + subtractive)
- [ ] `/simplify`
- [ ] `/code-review` + `security-review` (auth code — mandatory)
- [ ] `powerups:change-log`
- [ ] `update-docs` (CLAUDE.md,
  `projects/legacy-docs/fern/content/pages/auth/oauth.mdx`, package README)
- [ ] Linter clean on changed files
- [ ] Full test suite green
- [ ] **REMINDER — confirm Design Arena `benchmarks` field on `/models`
  (owned by Ben) shipped**, then confirm `models-list` surfaces it after
  regen and update the tool description. Also confirm the related website
  model-page PR reads the same `design_arena_benchmarks` source. See §5.5
  "In v1". (Ping Ben + Jacky.)
- [ ] PR with Manual verification section

---

## 5. Skill audit (from planning)

| Skill | Applies | Where in plan |
| --- | --- | --- |
| `best-practices` | YES | invoked; governs every milestone |
| `test-driven-development` | YES | test tasks precede impl (M1,4–9) |
| `self-documenting-apis` | YES | M6,M7 (named schemas, examples, zInt) |
| `writing-kysely-queries` | YES | M6 |
| `db-integration-tests` | YES | M6,M7 (workerd + real Postgres) |
| `when-generating-sdks-with-speakeasy` | YES | M2 (pin CLI version) |
| `e2e-testing` | YES | M9 |
| `simple-design-principles` | YES | OAuth copy / error messages (M5,M7) |
| `frontend-design` | MAYBE | only if `/auth` consent UI changes |
| `change-log` | YES | M10 |
| `update-docs` | YES | M0 (post-plan) + M10 |
| `drift-audit` | YES | M10 |
| `security-review` | YES | M10 (auth code) |
| `add-cloudflare-worker` | YES | M1 scaffolds `services/cfw-mcp` Worker |
| `next-cache-components` | NO | minimal Next surface |
| `database-branching` | NO | standard migration |

---

## 5.5 API dependencies

### In v1: Design Arena benchmarks on `/models` (owned by Ben)

**This is a committed v1 goal, not a deferred item.** Design Arena gave the
go-ahead to use their data. **Ben** adds a `benchmarks` object to the public
`ModelSchema` on `GET /api/v1/models`, starting with Design Arena ratings
(Elo / rank). The data exists today only internal-only
(`/api/internal/v1/design-arena-benchmarks`, `hide:true`); Ben's change
exposes it on the public endpoint.

- **API side (Ben):** add `benchmarks.design_arena` to the public
  `ModelSchema`, populated from `design_arena_benchmarks` keyed on model slug.
  Use `.nullable()` (not every model has a row), named `.openapi` schema with
  an example, `zInt()` for integer fields.
- **MCP side (us):** no new tool. The `models-list` payload auto-gains
  `benchmarks` on the next regen once Ben's field lands; we surface it in the
  tool description so the agent recommends on quality, not just price. Build a
  dedicated `model-benchmarks` tool only if the field turns out large.
- **Separate from** the in-flight Design Arena **model-page** PR (website UI).
  That is not this. This is the **public API field** Ben owns. Both should
  read the same `design_arena_benchmarks` source.
- **Artificial Analysis** stays out: their team isn't allowing API exposure
  (cc @alexander.atallah to DM them). Design Arena only for now.
- **Ben also owns the single-model lookup** (§5.5 "Later" item 4): an
  **`?id=<author/slug>` filter on `GET /models`** (Ben's chosen approach, not
  a new `{author}/{slug}` route). It pairs with this benchmark field — a
  one-model lookup is the natural home for rich per-model benchmark data — so
  ideally the two ship together. (Both are high priority and same owner; the
  benchmark field is the v1 gate, the `?id=` filter is the high-prio
  fast-follow.)

### Later (wire up when it lands)

Lower-priority public-API additions from the Linear issue "Public API
additions to power the OpenRouter MCP server." Not in v1. When one ships:
regen (§2.6), then make the listed wiring change.

| # | Priority | API ask (status: NOT yet in public API) | MCP wiring once it lands |
| --- | --- | --- | --- |
| 1 | High | **Rankings filter dimensions** on `GET /datasets/rankings-daily` — period (day/week/month/trending), modality, context-length bucket, use-case category, language. Wraps existing `packages/clickhouse/app-and-provider-activity/model-queries.ts` fns. | No new tool. `rankings-daily` auto-gains the params on regen; confirm they surface in the tool schema and update the tool description so the agent knows it can filter by code/roleplay/modality/etc. |
| 2 | High | **Sort params** on `GET /models` — `sort=pricing-low-to-high \| context-high-to-low \| throughput-high-to-low \| latency-low-to-high \| ...` (reuse website `OrderType`). | No new tool. `models-list` auto-gains `sort` on regen; recheck token budget (sort enum adds bytes); update description so the agent uses server-side sort instead of paging+sorting. |
| 3 | High | **`?id=` filter on `GET /models` — owned by Ben.** Today `GET /models` has no `id`/slug filter (only category/modality/params), so looking up one model means fetching the whole list. **Ben is adding an `?id=<author/slug>` filter to `GET /api/v1/models`** (his chosen approach, vs a new `{author}/{slug}` route). Pairs with his Design Arena benchmarks work (a one-model lookup is the natural home for rich per-model data). | **No new tool** — `?id=` is a query param on the same `GET /models` op, so it lands inside the existing `models-list` tool on regen. Update the `models-list` description to say it lists all models OR returns one when `id` is passed. (A separate hand-written `model-get` is NOT planned — `models-list` does both.) |
| 4 | Low | **Public app-rankings endpoint** — new `GET /datasets/app-rankings` wrapping `app-queries.ts:getAppRankings`; params category/subcategory/sort. | **New generated tool** `app-rankings`. Give it `read` scope in `overlays/02-scopes.yaml` (default-mounted). New use-case row in §2.2. |

None of these four block v1; the MCP absorbs them on later regens. (Design
Arena benchmarks above are the exception: in v1, gated on Ben.) Item 3 (the
`?id=` filter) is high priority and asked of Ben alongside the benchmark
field.

---

## 6. TODOs / deferred (NOT in this version)

- **First real skill:** "eval the best model at the most economical price for
  the dev's specific code / use-case." Directory + `view-skill` tool ship
  now; skill content authored later.
- **Token-schema micro-cuts** if over budget: strip int `min/max`
  9007199254740991 noise; trim `byok` 70-value provider enum; trim
  `models-list` category enum; de-dup list-tool pagination descriptions.
- **Local stdio / npx distribution** (env-key auth, no OAuth): dropped from
  v1 to keep a single auth path. Could return later as a secondary artifact
  for offline/airgapped dev or clients without remote+OAuth support.
- **Design Arena on `/models` is IN v1** (owned by Ben) — see §5.5. The
  related website **model-page** PR (expected week of **2026-06-08**) is a
  separate, website-side effort; not MCP scope, tracked only so we confirm the
  API field and the page read the same `design_arena_benchmarks` source.
- **Other public-API additions** (app-rankings API, rankings breakdowns,
  `/models` sort) — tracked in §5.5 "Later" with per-item MCP wiring;
  requested from the API team, verified not currently public.
- **Refresh tokens / token expiry / OAuth scopes** — keys are long-lived; not
  MVP.
- **Revoke-on-replay** (OAuth 2.1 §4.1.2 SHOULD): when a redeemed code is
  replayed, also revoke the previously issued key. Today replay just 403s
  and the first key lives on. Defense-in-depth follow-up, not v1.
- **Default credit limit on MCP-issued keys** — `createAuthCode` already
  supports `limit`; consider a sane default for OAuth-issued keys so a
  leaked MCP token has bounded blast radius. Product call, not v1.
- **DCR garbage collection** — periodic delete of `mcp_oauth_clients` rows
  that never completed a flow after N days (§2.5d).

---

## 7. Progress Summary

| Milestone | Status | Notes |
| --- | --- | --- |
| 0. Branch & plan | Done | on `feat/openrouter-mcp` |
| 1. Worker scaffold | Done | 401+RFC 9728, Origin check, SDK harness |
| 2. Speakeasy wiring | Done | deny-by-default overlays; 6 tools + regen |
| 3. Verify read tools | Done | live tools/call vs prod API; Ben items open |
| 4. Custom tools | Done | BM25 docs-search + slim chat-send |
| 5. OAuth metadata + authorize | Done | raw redirect_uri binding; mw skip |
| 6. DCR + table | Done | migrations + 7 workerd integration tests |
| 7. Token endpoint | Done | TTL/binding/S256/replay; legacy regression |
| 8. view-skill tool | Done | bundled SKILL.md, dynamic catalog desc |
| 9. e2e + CI regen | Done | 10-step flow green locally; CI gates added |
| 9.5. Alpha-launch readiness | Not started | route/Infisical prod (manual) |
| 10. Post-completion audit | Not started | gate before PR |
