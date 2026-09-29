---
name: add-mcp-tool
description: >-
  Add or update a tool on the OpenRouter MCP server (services/cfw-mcp).
  Two kinds of tool live behind one surface: (A) generated tools, built
  from the OpenAPI spec by Speakeasy, and (B) skill-backed tools, each a
  curated SKILL.md recipe served by its own hand-written tool. This
  skill covers both paths end to end. Use when exposing a public API
  endpoint as a tool, editing a tool's description/params, shipping a new
  skill over MCP, or when mcp-regen-check fails in CI.
---

# Add a tool to the MCP server

The MCP server (`services/cfw-mcp`) exposes everything to clients as
**tools**. There are two kinds, and they're added completely differently:

| Kind | What it is | Source | Added via |
| --- | --- | --- | --- |
| A. Generated tool | One tool per allowed API endpoint | OpenAPI spec → Speakeasy | overlays + `bun run regen` |
| B. Skill-backed tool | A curated `SKILL.md` recipe, served by its own dedicated tool | `OpenRouterTeam/skills` GitHub repo | hand-written tool in `custom/` |

Both are ordinary tools in `tools/list`; the machinery is what differs.
Skill-backed tools never touch Speakeasy, and generated tools never fetch
from the skills repo. Pick the section for what you're adding.

- Exposing a REST endpoint, or fixing a tool's params/description → **Part A**.
- Shipping a best-practice recipe an agent pulls on demand → **Part B**.
- Exposing an endpoint that is **not in the public OpenAPI document** (check `packages/sdk-generation/src/openapi/export-openapi.build.ts` for the mounted apps) → Part A cannot see it. Write a hand-written runner in `src/tools/<name>/` plus a `custom/<name>Tool.ts` definition, following `generate-speech` / `get-endpoint-uptime-history`, register it in `server.extensions.ts`, add it to `KNOWN_TOOLS` in `src/routes/mcp.ts`, and add the runner file to `scripts/oxlint/cfw-mcp-fetch-baseline.ts` (the `no-bare-fetch-in-cfw-mcp` rule fails otherwise). `send-batch` / `get-batch` / `list-batches` (OPE-5720) are the reference, written before the Batch API was mounted into the public spec; they share one `fetch` site in `src/tools/batches/batch-api.ts`, so a new Batch tool reuses `fetchBatchApiAs` with its own response schema and needs no baseline change. Pass `fetcher: httpClientFetcher(client._options.httpClient)` from the `custom/*Tool.ts` definition so the request runs through the session's instrumented `HTTPClient` (its `response` hook marks the caller's token rejected on upstream 401; a bare `fetch` bypasses it). Cap inline request payloads too, not just responses: the worker buffers the serialized body (see `MAX_SEND_BATCH_REQUESTS` / `MAX_SEND_BATCH_BODY_BYTES` in `run-send-batch.ts`). Move the tool to Part A once the endpoint is mounted into the public spec.

> **One skill, one tool.** There is deliberately no catalog tool that
> lists skills and serves them by name. `view-skills` used to work that
> way and agents kept failing to find the skill nested inside it — a
> recipe an agent should reach for has to be visible in `tools/list` on
> its own, with its trigger conditions in its own description. Adding a
> second skill means adding a second tool, not a `name` argument.

---

## Linear issue (required, both parts)

Every MCP tool change must have a matching Linear issue in the
**OpenRouter MCP** project (team: OpenRouter). Before starting work:

1. **Search for an existing issue** — `list_issues` with
   `project: "OpenRouter MCP"` and a query for the tool/endpoint name.
2. **If none exists, create one** via `save_issue` with
   `team: "OpenRouter"`, `project: "OpenRouter MCP"`, and a title naming
   the tool(s) being added or changed (e.g. `MCP: expose presets as read
   tools (list-presets + get-preset)`).
3. **Keep it updated as you go** — move it to `In Progress` when work
   starts, link the PR, and comment on scope changes (e.g. a tool name
   or param set that diverged from the issue description). Move it to
   `Done` only after the PR merges.

This keeps the MCP tool surface auditable from one project view and
gives each tool a place to record scoping decisions (see OPE-5472 for
the expected level of detail).

---

## Naming convention (all tools)

**Tool names MUST be `[verb]-[noun]`, kebab-case.** The verb comes
first: `generate-image`, `list-models`, `get-model`, `search-docs`. This
applies to every kind of tool — the `name:` in an overlay 02 entry (Part
A), a hand-written custom tool's `name:` (`send-message`, `generate-image`,
`spawn-ori-eval` live in `generated/src/mcp-server/custom/`), and a
skill-backed tool's SKILL.md frontmatter `name:` (Part B). It also governs the log event names
and symbol names in a custom tool (`run-generate-image.ts`,
`runGenerateImage`, `generate-image-fetch-failed`). Use `get-` when the
tool returns a single object and `list-` when it returns an array.

Why: a verb-first name reads as an action the agent takes, which is what a
tool is. It also keeps related tools from colliding alphabetically in the
`tools/list` output the way noun-first names do.

**This convention is CI-enforced.** The Grit pattern at
`.grit/patterns/mcp_tool_naming.md` runs via `grit check` on MCP tool
declaration sites. Names must start with one of the approved verbs
(`generate`, `get`, `install`, `list`, `search`, `send`, `spawn`, `transcribe`, or `view`) and use
lowercase kebab-case with at least two segments; `ping` is the standalone
exception. Introducing a genuinely new verb is a deliberate change — edit the
pattern's approved-verb regex in the same PR.
The Grit CLI requires pattern filenames to use identifier-safe underscores.

> **All current tools already follow this convention** (the July 2026
> breaking rename — see `services/cfw-mcp/CHANGELOG.md`). The earlier
> noun-first names (`models-list`, `model-get`, `credits-get`,
> `chat-send`, `view-skill`, …) no longer exist. Tool names are only in
> the MCP runtime catalog, not the public REST SDK or OpenAPI spec, so a
> rename affects only clients that hardcode a name; clients that discover
> tools dynamically are unaffected. Keep new tools consistent, and if a
> future rename is unavoidable, document it as a breaking change in the
> CHANGELOG with an old→new mapping. For a generated (Part A) tool whose
> default operation-derived name is noun-first, set an explicit verb-first
> `name:` in the overlay.

---

## Part A — Generated tools (Speakeasy)

The generated toolset is **committed** under `services/cfw-mcp/generated/`
and CI (`mcp-regen-check` in `openapi-pr-comment.yaml`) fails if it's
stale.

### Prerequisites

1. **Speakeasy CLI** — pinned version, read from the committed workflow:

   ```bash
   grep 'speakeasyVersion:' services/cfw-mcp/generated/.speakeasy/workflow.yaml
   ```

   Install/switch to exactly that version (a newer local binary produces
   different output and fails the CI diff):

   ```bash
   curl -fsSL https://raw.githubusercontent.com/speakeasy-api/speakeasy/main/install.sh | sh
   speakeasy update --version <PINNED_VERSION>   # if installed version differs
   speakeasy --version                            # verify
   ```

   In practice `speakeasy run` reads `speakeasyVersion` from
   `workflow.yaml` and auto-downloads/executes the pinned version even
   when the local binary is newer (verified with local 1.790.1 vs pinned
   1.787.0 on PR #36420), so a version mismatch is usually fine to run
   through. Note `speakeasy update --version` is not a valid flag on
   recent CLIs — don't fight the local version; just run and check the
   regen diff is scoped to your change.

   The CLI is a static Go binary — it runs fine in headless Linux
   containers (CI and Devin sessions included).

2. **Auth** — `speakeasy run` needs `SPEAKEASY_API_KEY`. CI uses the
   GitHub Actions secret of the same name. In a Devin/agent session,
   export it before running (ask in Slack for the value if it is not in
   Infisical; on a human machine `speakeasy auth login` also works and
   caches under `~/.speakeasy`).

3. **bun** on PATH (`curl -fsSL https://bun.sh/install | bash`).

### The 3-step workflow

```bash
# 1. Regenerate the root OpenAPI spec (it is gitignored — always fresh)
bun run generate:openapi          # at repo root; expect "0 errors"

# 2. Regenerate the toolset
cd services/cfw-mcp
bun run regen                     # speakeasy run + cleanup + @ts-nocheck stamping

# 3. Verify
bun test                          # the SDK-client harness pins the exact tool list
```

**Step 1 is the most-missed step.** `bun run regen` reads
`openrouter-openapi.yaml` at the repo root; if you skip `generate:openapi`
you silently regenerate against a stale spec and new endpoints don't
appear (no error — the tool files just don't change).

### Adding / removing a tool (overlays)

Overlays live in `services/cfw-mcp/generated/overlays/` and are
**deny-by-default**:

- `01-disable-all-tools.yaml` — disables every operation. Never edit.
- `02-enable-read-tools.yaml` — the allowlist. **Edit this** to add a tool.
- `03-trim-models-params.yaml` — drops website-only params for token budget.

A new API endpoint never becomes a tool automatically; add an entry to
overlay 02:

```yaml
  - target: $.paths["/datasets/rankings"]["get"]
    update:
      x-speakeasy-mcp:
        disabled: false
        name: list-rankings
        scopes: [read]
        description: >-
          One or two sentences telling the AGENT when to reach for this
          tool — write for the model, not for docs.
```

Set `name:` explicitly and make it `[verb]-[noun]` (see the naming
convention above) — the operation-derived default is often noun-first.

Then re-run steps 1–3. New tool files appear in
`generated/src/mcp-server/tools/`.

Existing tools auto-gain new params/response fields on regen (e.g. a new
query param on `GET /models` flows into `list-models` with no overlay
change) — but update the tool `description` in overlay 02 if the new
capability changes how an agent should use it.

### After regen

- **Update the harness tests and public card**: `src/mcp-client.test.ts` pins
  the exact sorted tool-name list — add/remove names there or `bun test`
  fails. Also add, update, or remove the corresponding `{ name, description }`
  entry in `projects/web/app/.well-known/mcp-server-tools.ts`: the public MCP
  server card is built from it, and the collocated `mcp-server-tools.test.ts`
  drift-checks its names against
  `services/cfw-mcp/generated/src/mcp-server/{tools,custom}/`.
- **Token budget**: the plan (§2.7,
  `services/cfw-mcp/plans/v1-openrouter-mcp-and-pkce-oauth.md`)
  targets ≤400 tokens per tool schema. Big enums/objects in new params
  count; trim with an `x-speakeasy-ignore` action in overlay 03 if needed.
- **Commit everything** under `services/cfw-mcp/generated/` — it is
  source, not build output. Regen is idempotent
  (`--skip-versioning`), so a second run on a clean tree must produce no
  diff; that's exactly what `mcp-regen-check` asserts in CI.
- **Live smoke test** (optional but cheap):

  ```bash
  cd services/cfw-mcp && bunx wrangler dev   # :8798
  curl -s http://localhost:8798/mcp/mcp -X POST \
    -H 'Content-Type: application/json' \
    -H 'Accept: application/json, text/event-stream' \
    -H "Authorization: Bearer $OPENROUTER_API_KEY" \
    -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'
  ```

  Tool calls wrap arguments in a `request` object:
  `{"name":"get-model","arguments":{"request":{"author":"openai","slug":"gpt-4o-mini"}}}`.

### Gotchas (generated tools)

- **Hand-written files survive regen**: `generated/src/mcp-server/custom/`
  and `server.extensions.ts` are ours (ping, search-docs, send-message,
  generate-image, spawn-ori-eval register there). Everything else under
  `generated/` is overwritten.
- **`@ts-nocheck` stamping**: `regen.ts` stamps generated files because
  Speakeasy output doesn't pass the monorepo's stricter tsconfig. Don't
  remove the stamps; don't add hand-written code to stamped files.
- **Any public spec change trips `mcp-regen-check`**, even one that
  changes no tool (e.g. a tag description in
  `packages/sdk-generation/src/openapi/tag-descriptions.ts`): the
  `docChecksum` in `generated/.speakeasy/gen.lock` moves. Run
  `bun run regen` and commit the lock diff in the same PR (#42759).
- **New operations also add untracked files** (`src/funcs/*` and `src/models/*` per operation, generated even when overlay 01 keeps the operation disabled as a tool). `mcp-regen-check` runs `git diff` on tracked files, so its output names only `gen.lock` and it passes once the lock alone is committed. Check `git status --untracked-files=all services/cfw-mcp/generated` after regen and commit those files too, or the committed lock references files the tree does not have (#43352).
- **An older local `speakeasy` on PATH is not auto-upgraded to the pin**, and the management SDK pins a different version. Before `bun run regen`, confirm `speakeasy --version` matches `generated/.speakeasy/workflow.yaml`; if the regen flips `speakeasyVersion` in `workflow.lock` or churns `lib/*.ts`, revert the tree, put the pinned release binary first on PATH and rerun.
- **"mcp-typescript is not in the approved target list" warning** from
  `speakeasy run` is expected — generation still succeeds.
- **New tool 404s/HTML responses**: the endpoint may be merged to main
  but not yet deployed to production; the tool is correct, the upstream
  isn't live yet. Verify with `curl https://openrouter.ai/api/v1/<path>`.
- **Merge/rebase lock conflicts go stale silently**: resolving a
  `gen.lock`/`workflow.lock` conflict by taking one side wholesale while
  the branch keeps its own generated models leaves the lock checksums
  out of sync with the tree — `mcp-regen-check` fails with a
  checksum-only diff. A conflict-free merge does the same when both
  parents changed the spec, since `docChecksum` hashes the merged spec
  that neither parent generated. Re-run the 3-step regen after any merge
  or rebase that touched these files or the OpenAPI spec; if only the two
  lock files change, that was the whole problem and the fix is a
  one-commit lock refresh.
- Do **not** bump `speakeasyVersion` in `workflow.yaml` as a side effect
  of having a newer local CLI — that is a deliberate, reviewed change
  (see the `when-generating-sdks-with-speakeasy` knowledge rule).

---

## Part B — Skill-backed tools (one skill, one tool)

A skill is a curated `SKILL.md` recipe. Each one gets its **own**
hand-written MCP tool that fetches it from GitHub and returns its full
text for the calling agent to follow (the Timescale pg-aiguide "skills
over MCP" pattern, one tool per recipe). `spawn-ori-eval` is the
reference implementation.

Skills live in the **`OpenRouterTeam/skills`** GitHub repo. They are
**not** bundled with the Worker — the tool fetches
`skills/<name>/SKILL.md` from `raw.githubusercontent.com` at request
time and parses the frontmatter, with Cloudflare edge caching
(`cacheTtl`, `cacheEverything`) so a cold skill is not a full GitHub
round trip on every call. The short URL `https://openrouter.ai/skills/<name>`
also proxies the same bytes for humans and agents that prefer it.

Adding a skill does **not** touch Speakeasy — no `bun run regen`, and
`mcp-regen-check` is unaffected.

### 1. Author the skill

Create `skills/<name>/SKILL.md` in the `OpenRouterTeam/skills` repo.
Required YAML frontmatter (the parser needs both, or the fetch fails):

```markdown
---
name: my-skill-name
description: One line describing when an agent should follow this recipe.
---

# Title

Body the agent will follow...
```

`name` must be kebab-case, unique, and `[verb]-[noun]` (see the naming
convention above) — it is both the skill name and the MCP tool name. The
whole file (frontmatter included) is what the agent receives, so the body
must stand alone.

### 2. Use the shared skill helpers

Shared skill infrastructure lives in `services/cfw-mcp/src/tools/skills/`:

- `parse-skill.ts` parses the required frontmatter and preserves the full
  document.
- `fetch-skill.ts` builds the raw GitHub URL, applies the `cf` edge-cache
  options, cancels non-ok response bodies, and parses the skill.
- `run-skill.ts` wraps the fetched document in a `CallToolResult` and logs
  fetch or parse failures.
- `skill-constants.ts` holds each tool's skill name, fetcher name, and log
  event name.

The hand-written definition in
`generated/src/mcp-server/custom/<name>Tool.ts` should call
`fetchSkillFromGitHub` and `runSkill` directly with those constants. Do not
add a per-tool `fetch-<name>-skill.ts` or `run-<name>.ts` wrapper layer.

### 3. Register the tool

Add `generated/src/mcp-server/custom/<name>Tool.ts` (verb-first `name:`,
`scopes: ['read']`, read-only + idempotent annotations) and register it in
`generated/src/mcp-server/server.extensions.ts`. Those two files are
hand-written and survive regen.

**The description is the whole product.** An agent only ever sees it in
`tools/list`, so it must state what the tool does, the trigger conditions
that should make the agent reach for it, and the cases where it should
not — do not make the agent open the tool to learn whether it wanted it.
Prefer no arguments when the tool serves exactly one document.

Then add the tool name to the `KNOWN_TOOLS` allowlist in
`src/routes/mcp.ts` (unknown names get bucketed as `other` in the Datadog
metrics).

### 4. Test

```bash
cd services/cfw-mcp
bun test src/tools/skills/ src/mcp-client.test.ts
bun run typecheck
```

- `src/tools/skills/*.test.ts` — cover the happy path for every skill,
  including the exact raw GitHub URL and edge-cache `cf` options (without
  them every call is a fresh GitHub round trip), plus a non-ok upstream,
  invalid frontmatter, body cancellation, and the exact error locations.
- `src/mcp-client.test.ts` — add the tool to the expected `tools/list`
  names and to `readOnlyToolNames`, and assert its description carries
  its trigger wording.
- `projects/web/app/.well-known/mcp-server-tools.ts` — add a
  `{ name, description }` entry for the new tool (the public MCP server
  card is built from it). The collocated `mcp-server-tools.test.ts`
  drift-checks the names against
  `services/cfw-mcp/generated/src/mcp-server/{tools,custom}/`.

### 5. Changelog

Add a user-facing entry to `services/cfw-mcp/CHANGELOG.md` (see the
`change-log` skill for tone). Example: `New <name> tool over MCP —
<what it helps the user do>`.

### 6. (Optional) live smoke test

```bash
cd services/cfw-mcp && bunx wrangler dev   # :8798
curl -s http://localhost:8798/mcp/mcp -X POST \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -H "Authorization: Bearer $OPENROUTER_API_KEY" \
  -d '{"jsonrpc":"2.0","method":"tools/call","id":1,
       "params":{"name":"<name>","arguments":{}}}'
```

### Gotchas (skill-backed tools)

- **Do not reintroduce a catalog tool.** A `name`-argument tool that
  serves N skills hides them from `tools/list`; that is exactly why
  `view-skills` was removed.
- **The tool definition is hand-written** (`custom/<name>Tool.ts`) and
  survives Speakeasy regen. Skill parsing, fetching, and result wrapping
  live in `src/tools/skills/`, not in a per-tool source directory.
- **Both frontmatter keys are mandatory.** A file missing `name:` or
  `description:` fails `parseSkill`, which throws at request time and
  surfaces to the client as a "Failed to load" error.
- **Keep skills self-contained.** The client gets only the one file;
  there is no cross-file include mechanism.
