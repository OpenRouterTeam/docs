# OpenRouter MCP Server: Executive Brief

**Audience:** Product + Engineering

**Status:** Plan approved-pending; not started

**Full plan:** `v1-openrouter-mcp-and-pkce-oauth.md` (this directory)

**Purpose of this doc:** align on the *shape* and *how it's used*, not the
implementation. One read should leave the team agreeing on what we're
building, who it's for, and what's out of scope.

---

## 1. What it is, in one line

A first-party OpenRouter MCP server that lets a developer's AI coding
assistant (Claude Code, Cursor, Claude Desktop) pull OpenRouter context and
help wire OpenRouter into their app, without leaving the editor.

## 2. The problem it solves

A developer's in-editor agent has no live OpenRouter context, so it guesses,
and it guesses from stale training data. The MCP server grounds it. Concrete
problems it solves:

- **"What's the best model for X that's also cheapest and fastest?"** Today
  that's several separate API calls plus manual cross-referencing. The MCP
  lets the agent answer it directly from live model, pricing, and ranking
  data.
- **Stale-training-data grounding.** Models answer model/pricing questions
  from a training cutoff that is often months out of date or just wrong. The
  MCP grounds those answers in OpenRouter's current catalog instead of the
  model's memory.
- **Encodes the workflows OpenRouter is good at.** E.g. "evaluate 5 models for
  LLM-as-a-judge that's best at instruction following, fast, and low cost."
  The agent runs the comparison instead of the dev guessing it's "probably
  Gemini Flash 3.1."
- **Docs lookup in-flow.** Pull OpenRouter documentation straight from the MCP
  with no context-switch to the docs site. Also sidesteps our weak Google
  discoverability for docs.
- **Forces public-API upgrades (side effect).** Building this surfaces
  capabilities the website has but the public API doesn't, so we upgrade the
  public API to match. Net win beyond the MCP itself.

## 3. Who it's for, and what it is NOT

- **For:** the developer (and their agent) *building* on OpenRouter.
- **It's a dev-helper, not a runtime client.** The dev's production app still
  calls OpenRouter directly. The MCP is not in their app's request path.
- **Not an admin console.** It does not create/modify keys, workspaces, or org
  settings. Read and help, not configure.

## 4. How a developer uses it

```text
1. In their MCP client, the dev adds the OpenRouter MCP URL.
2. A browser opens; they log in to OpenRouter (OAuth).
3. Done. The agent now has OpenRouter tools.
4. They ask things like the problems in §2:
   - "Cheapest + fastest model that handles images?"   (discover)
   - "How do I stream responses with the API?"          (docs search)
   - "Evaluate 5 models for LLM-as-a-judge on my task." (skills + chat)
   - "Try this prompt on two models, show the diff."    (chat)
```

No API key pasting, no local install. Connect a URL, log in, use it.

## 5. The shape (architecture at altitude)

Two pieces, both in our monorepo:

1. **The MCP server:** a hosted Cloudflare Worker (`services/cfw-mcp`,
   reached at e.g. `mcp.openrouter.ai`). Its tools are auto-generated from
   our existing public API spec via Speakeasy, plus a few hand-written tools
   the API can't generate (docs search, a slim chat tool, and a skills tool).
2. **The login (OAuth):** standards-compliant endpoints that let any MCP
   client log the user in through their browser and receive their OpenRouter
   key. This reuses our existing PKCE auth, wrapped to the MCP spec.

The plan passed a security review (2026-06-09). The user-visible outcomes:
login codes are short-lived and bound to the client that requested them,
only the strongest PKCE method is accepted, and every key issued through
the MCP is labeled in the dashboard ("MCP: {client name}") so users can
find and revoke it. Details live in the full plan.

**Why hosted/remote (not a local npm install):** a browser login flow needs a
server to authenticate against. That makes the OAuth work the centerpiece and
the critical path, not an afterthought.

## 6. What ships in v1 (the toolset)

9 tools. The "job to be done" column is the dev-facing reason each exists.

| Tool | Job to be done (what the dev gets) | Bucket |
| --- | --- | --- |
| `models-list` | List the live model catalog, or look up one model by id (pricing, context length, modalities, params, Design Arena benchmarks), to pick a model and wire the right slug into code. | Discover |
| `model-endpoints` | See which providers serve a model and at what price/latency/throughput/ZDR, to choose routing or debug a slow provider. | Discover |
| `providers-list` | List available providers to configure allow/deny/routing preferences. | Discover |
| `rankings-daily` | See which models are most used/trending by token volume, to pick a proven model. | Discover |
| `credits-get` | Check remaining account credit balance before running a workload. | Operate |
| `generation-get` | Inspect cost, tokens, and serving provider for a specific request, to debug spend and routing. | Operate |
| `chat-send` | Chat with a model and get its response (plain text), to test a prompt or compare models without leaving the editor. | Build-with-help |
| `docs-search` | Search OpenRouter's full docs to answer "how do I…" with correct API usage, no context-switch. | Build-with-help |
| `view-skill` | Retrieve a curated, OpenRouter-specific best-practice recipe (e.g. "find the cheapest good-enough model") on demand. | Build-with-help |

The "build-with-help" bucket is the differentiator: `docs-search` and
`view-skill` are things no auto-generated API wrapper gives you.

## 7. What's deliberately out of scope for v1

- Admin/config tools (keys, workspaces, org settings): read-only or absent.
- A "compare models" tool: the agent compares from model data itself.
- Local install / API-key-paste distribution: one auth path (OAuth) for now.
- App rankings and richer rankings filters: not in the public API yet (asks
  filed with the API team; we absorb them when they land). See §8. (The
  `?id=` model lookup is also not in the API yet but is high-prio and owned
  by Ben; see §8.)
- Artificial Analysis benchmarks: their team isn't allowing API exposure.
  (Design Arena benchmarks ARE in scope; see §8.)

## 8. Dependencies and critical path

- **OAuth is the gate.** The server can't authenticate anyone without it.
  Nothing is usable end-to-end until the login flow works. Scope note: it
  is a bit more than "wrap existing auth." The security review added
  hardening (client-bound, expiring codes; a small DB migration) and the
  discovery endpoints the MCP spec requires. All folded into the plan.
- **Design Arena benchmarks on `/models` (owned by Ben).** A v1 goal that
  depends on Ben adding a `benchmarks` field to the public models endpoint.
  Once it lands, `models-list` surfaces it automatically on regen so the agent
  can recommend on quality, not just price. Separate from the in-flight
  website model-page work; both read the same source. (Artificial Analysis is
  out: their team isn't allowing API access.)
- **Stays in sync automatically.** The toolset regenerates from the same API
  spec our SDKs use, with a CI check so it can't silently drift. New public
  endpoints flow in on the next regen with a one-line scope decision.
- **`?id=` filter on `/models` (owned by Ben, high priority).** Today
  `GET /models` has no `id`/slug filter, so looking up one model means fetching
  the whole catalog and filtering client-side. Ben is adding an
  `?id=<author/slug>` filter to `GET /models` (his chosen approach); it pairs
  with his benchmark field above (same endpoint, same owner). High priority
  fast-follow to the benchmark field. It folds into the existing `models-list`
  tool (it's the same endpoint), so no extra MCP tool.
- **Other API-team asks (non-blocking):** richer rankings filters and
  `/models` sorting (high value), plus an app-rankings endpoint (lower).
  Tracked separately; v1 ships without them.

## 9. Build phases (high level)

1. Stand up the Worker shell + generate the toolset.
2. Build the OAuth login (the critical path).
3. Add the hand-written tools (chat, docs-search, skills).
4. Wire it together end-to-end, deploy, and CI-guard the regen.

## 10. What we need to agree on

- **Hosting = remote/hosted Worker** (vs a local install). This is the one
  call everything else depends on. Current direction: remote-primary.
- **Retire the separate codemode worker** (draft PR #18462): the generated
  server's built-in dynamic mode covers that need, so we don't maintain two.
- **v1 toolset = the ~9 above.** Grow on demand, not up front.
