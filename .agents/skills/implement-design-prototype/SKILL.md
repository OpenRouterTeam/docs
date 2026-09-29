---
name: implement-design-prototype
description: Turn a design sandbox link (design.openrouter.ai prototype, canvas, hub surface, legacy /rebrand permalink, or a Vercel preview of the sandbox) into an openrouter-web implementation. Resolves the URL to its source files in OpenRouterTeam/openrouter-design-sandbox, checks whether production already ships the surface, decides whether the source is a design-system reference or a legacy sketch, and maps the design onto the openrouter-web kit, data layer, gating and i18n. Use whenever a ticket, Slack thread, or request hands you a design.openrouter.ai URL, a `/prototype/<uid>/...` path, a canvas link, or says "implement this design" or "match the sandbox".
user-invocable: true
---

# Implement a design sandbox prototype

The sandbox at design.openrouter.ai is a Next.js app in `OpenRouterTeam/openrouter-design-sandbox`. Every URL on it corresponds to a folder of TSX in that repo, and that source, not a screenshot, is the reference to implement from. Two things the URL does not tell you: whether production already ships the surface (it often does, sometimes ahead of the prototype, see section 3), and whether the prototype is on the design system at all (47 of the 60 prototype route groups predate it, see section 4).

The sandbox is read-only for this workflow. Never open PRs there, never edit prototypes, never run `pnpm ship`, `pnpm changelog`, `pnpm contributors`, `pnpm lab`, its pre-push hook or its `/ready` skill, and ignore the sandbox's own CLAUDE.md git rules (they let designers commit to main). Implement in an openrouter-web worktree, as a draft PR.

Prior art: a `julianify` plugin did this job until 2026-09-10 (`git log --all --oneline -- .claude/plugins/julianify` finds its import map); Devin sessions also have the org playbook "Julianify - Migrate Design Sandbox to Production"; the sandbox's `/triage` skill opens openrouter-web draft PRs from DES tickets. This skill supersedes the plugin and follows the same rules as the other two.

## 1. Get the sandbox source

The repo is `internal` on GitHub, so any org member's `gh auth` can read it. Use a checkout you own and read from the remote ref, so a stale or dirty working tree is never the reference:

```sh
SANDBOX=${DESIGN_SANDBOX_DIR:-$HOME/Repos/openrouter-design-sandbox}
if [ -d "$SANDBOX/.git" ]; then
  git -C "$SANDBOX" fetch -q origin          # someone's clone: fetch, read origin/main, change nothing else
else
  git clone --depth 1 https://github.com/OpenRouterTeam/openrouter-design-sandbox.git "$SANDBOX"
fi
git -C "$SANDBOX" rev-parse --short origin/main   # record this for the PR
SANDBOX_MAIN=$(mktemp -d "${TMPDIR:-/tmp}/sandbox-main.XXXXXX") && git -C "$SANDBOX" archive origin/main | tar -x -C "$SANDBOX_MAIN"   # browsable copy, no side effects; a fixed path would be clobbered by a concurrent run
```

Designers keep the repo at `~/Repos/openrouter-design-sandbox`; on macOS `~/repos` is the same directory, so a clone into either path fails with "already exists and is not an empty directory". Reuse it as above and never run `git checkout`, `reset`, `clean`, `pnpm install` or a dev server in a clone you did not create. Keep the sandbox checkout outside the openrouter-web worktree so its files never enter the PR.

A shallow clone has no history. Date a prototype from its registry `createdAt` or from `gh api 'repos/OpenRouterTeam/openrouter-design-sandbox/commits?path=<folder>'` (quote it; zsh globs the `?`) run on the route-group folder `app/(proto-<name>)` or the feature folder `src/features/<name>`, not on the UID folder: every prototype older than 2026-03-09 was moved by the rename commit that introduced `/prototype/<uid>/` paths, so the UID folder's history starts there.

### Vercel preview links

Preview hostnames are `openrouter-design-sandbox-git-<ref>-openrouter.vercel.app`. Resolve the hostname before the path: that branch's own `next.config.ts` decides its redirects, and main's table does not apply.

1. `git -C "$SANDBOX" grep -l '<hostname>' origin/main -- src/shared/data/prototypes` finds the `type: 'external'` registry row on main (10 exist) with the prototype's `id`, `name` and `sitemapNodes`.
2. `git -C "$SANDBOX" ls-remote --heads origin | grep '<label-without-hash>'`. A label that would exceed 63 characters was truncated by Vercel and given a 6-hex suffix that cannot be recomputed, so it can match several heads (`proto-workspace-ec472d` matches two). For each candidate: `git -C "$SANDBOX" fetch --depth 2 origin '+refs/heads/<ref>:refs/remotes/origin/<ref>'` (depth 2 so a Lab stamp commit's parent is present; the explicit refspec creates `origin/<ref>` — a depth-1 clone tracks only main, so a bare `git fetch origin <ref>` lands in `FETCH_HEAD` and the next commands cannot see it), then read with `git -C "$SANDBOX" show origin/<ref>:<path>` and `git -C "$SANDBOX" ls-tree -r --name-only origin/<ref>`. Old branches carry the pre-UID monolith registry `src/shared/data/prototypes.ts`; the branch that hosts the prototype lists that `id` as `type: 'internal'` and often `solo: true`, and its row keeps `status`, `updatedAt` and `archivedReason`. Quote those in the PR: an archived row means the designer rejected this variant.
3. A ref whose tip commit subject starts with `labs preview:` is a Lab preview stamp; the work is its parent commit `origin/<ref>^`.
4. The branch decides its layout: the oldest refs serve `<path>` from `app/(<group>)/<path>/page.tsx`, later ones already use `app/(proto-<name>)/prototype/<uid>/`. Find the page with `git -C "$SANDBOX" ls-tree -r --name-only origin/<ref> | grep '<path>/page.tsx'`.

A preview answering 410 with `x-vercel-error: GONE` has expired; 404 with `DEPLOYMENT_NOT_FOUND` means no deployment ever existed at that hostname (check the truncation rule); a live one answers 302 to `vercel.com/sso-api`, which no agent token opens. Since 2026-09-01 Vercel builds only main and Lab refs, so a preview of a work branch is stale by definition. The branch source is the reference; note its tip SHA in the PR. Every external branch is legacy in the sense of section 4.

## 2. Resolve the URL to files

Strip the query string first and keep it (it selects a state, below). Then branch on the first path segment.

| URL shape | UID | Source location |
| --- | --- | --- |
| `/prototype/<uid>/<path...>` | segment 2 | `app/(proto-<name>)/prototype/<uid>/<path...>/` (one group, `1ep3wz`, sits under `(onboarding)`) and registry `src/shared/data/prototypes/<uid>.ts` |
| `/canvas/<uid>/<topic>` | segment 2 | `app/(canvas)/canvas/<uid>/<topic>/_client.tsx` and registry `app/(canvas)/canvas/_data/files/<uid>.ts`; rendered by `app/(rebrand)/rebrand/canvas/[uid]/[topic]/page.tsx` via a rewrite |
| `/rebrand/<slug>` | in the registry, not the URL | `app/(rebrand)/rebrand/<slug>/`; registry found with `git -C "$SANDBOX" grep -l '/rebrand/<slug>' origin/main -- src/shared/data/prototypes`. Pre-rename permalinks still pasted in Slack; new work is always `/prototype/<uid>`. `/rebrand/r/<slug>` is the routers prototype's public share page |
| `/system`, `/slides`, `/diagrams`, `/email`, `/studies`, `/workflow`, `/ori-tui`, `/wayback`, `/glyph` | no | rewritten to `app/(rebrand)/rebrand/<surface>/`; `/audits` goes to `rebrand/bauhaus-audits/`; `/skills` redirects to `/workflow?tab=skills` |
| bare paths such as `/workspaces`, `/models/...`, `/logs`, `/home` | no | redirected to a `/prototype/<uid>/...` URL by `redirects()` in the sandbox `next.config.ts`; then use the prototype row. Redirects chain: the prototype's own `page.tsx` may `redirect()` again to a default child |
| `/massimo/<uid>/<slug>` | segment 2 | `app/(massimo)/massimo/<uid>/<slug>/_client.tsx`, intern-agent drafts on raw Tailwind, never a design-system reference |
| `/lab`, `/legacy`, `/legacy/email` | no | the Lab board (follow the card's preview URL, section 1) and archived pre-DS hubs; not references |
| `openrouter-design-sandbox-git-<ref>-openrouter.vercel.app/<path>` | none on the branch | the route on that branch (section 1); its registry row lives on main with `type: 'external'` |

Registry files are named by UID, so no grep is needed for the two UID families:

```sh
git -C "$SANDBOX" ls-tree -r --name-only origin/main | grep -E "(src/shared/data/prototypes|app/\(canvas\)/canvas/_data/files)/<uid>\.ts$|/prototype/<uid>/|canvas/<uid>/" | cut -d/ -f1-4 | sort -u
```

If you must grep (to find which prototypes cover a sitemap node, say), 14 of the 101 registry files are TypeScript literals with single quotes, so quote both styles and use `[[:space:]]`, which `git grep` honours and `\s` is not: `git -C "$SANDBOX" grep -lE "uid['\"]?:[[:space:]]*['\"]<uid>" origin/main -- src/shared/data/prototypes "app/(canvas)/canvas/_data/files"`.

If nothing resolves, do not conclude the link is wrong. Designers keep prototypes as local worktree commits for days before shipping, and Lab prototypes register on a branch. A depth-1 clone tracks only main, so fetch every head before searching: `git -C "$SANDBOX" fetch --depth 1 origin '+refs/heads/*:refs/remotes/origin/*'`, then `git -C "$SANDBOX" for-each-ref refs/remotes/origin --format='%(refname:short)' | while read r; do git -C "$SANDBOX" ls-tree -r --name-only "$r" | grep -q '<uid>' && echo "$r"; done`. Then ask the designer.

### What the registry tells you

Prototype fields are typed in `src/shared/data/prototypes/_types.ts`:

- `id` and `name` are how the designer refers to it. Neither is the production route: `ner4dp` is id `private-deployments` and ships at `settings/private-endpoints`.
- `href` is the canonical entry URL, sometimes with a state-selecting query string.
- `sitemapNodes` names the production pages covered, as ids from `src/shared/data/sitemap.ts` (`ws-byok` resolves to `/workspaces/:id/byok`). This is how you find the openrouter-web surface. `sitemapGroup` marks a prototype with no sitemap node; it says nothing about production (`ner4dp` carries `section-user` and its page shipped on 2026-09-03), so always run section 3.
- `type: 'external'` means the source is on a branch (section 1). `hasDrafts: true` means `_layouts.tsx` or `_variants/` alternates exist under the route. `hidden` and `namespace` are hub bookkeeping. `legacy` is computed at reindex and never written in the file; use section 4.
- For per-UID files, status, description, owner, changelog and parent iteration live in the sandbox database, not in git; ask the designer. Old branches keep them in the monolith registry (section 1).

Canvas fields are typed in `app/(canvas)/canvas/_data/types.ts`: `uid`, `name`, `topic`, `date`, `owner`, `legacy`, `sections`, `instructions`. `sections` is the fastest summary of what the canvas holds. When `instructions` is set, read that file under `public/canvas-instructions/` first: it is the designer's written build spec.

### Query strings and states

A query string selects a state of the prototype, not a different prototype. Grep the whole UID folder, including `_components/` and `_data/`, for `searchParams` and `params.get(`, and list every state in the PR.

- State flags such as `?linked=0` on `/prototype/jnovcz/model`, `?tab=`, `?resume=<id>`: implement the state the link names; with no query, implement the default the code falls back to and say so. A flag whose source comment says it pins a state for review (`?empty=1`, `?fail=1`) is a review affordance: cover the state it shows, drop the parameter.
- `?layouts=true` (or registry `hasDrafts: true`) opens `_layouts.tsx` or `_variants/`, the layout-phase explorer of structural options A, B, C. It is design history, not the prototype. Drop the param, read the routes the bare `page.tsx` redirects to, and if the ticket points at a draft, ask which variant.
- Demo gates such as `?brand=<partner>` or `?account=` whitelabel or scope the demo. They are not states to implement.
- Canvas links carry the designer's intent: `?f=<slug>` focuses one artboard (slug is the title lowercased with punctuation collapsed to `-`), `?hide=` lists dismissed artboards, `?t=` is the theme (ignored when the canvas renders forced `ThemePane`s). A decision artboard whose title or note names a chosen option ("A2 muted chosen", "Settled:") means implement only that option; its siblings are rejected references to list in the PR. An artboard titled Current or Baseline is the shipped state, not the proposal. Without `?f=` or a decision note, ask which artboard.

### What to read

Read the registry file, then `page.tsx` (for a canvas, `_client.tsx`, its `_components/*` group files and `_data.ts`) and every file it imports. Fixtures sit under the route's `_data/` in newer prototypes and under `src/features/<name>/data/` behind a `@/<name>/*` alias from the sandbox `tsconfig.json` in older ones; follow the imports, and read the exact file the route imports when a namesake exists elsewhere. Fixture comments are the design rationale (why a badge is outline, why a status has two meanings); quote them in the PR. Every file under `_components/` is a fork: chrome (account switcher, rail, top nav) that is prototype-only, or a copy of a kit or shell primitive whose header comment names the original. Read `src/features/<name>/README.md` or `HANDOFF.md` when present, and the group `layout.tsx` (legacy groups configure the shared nav and scope there).

Prototypes iterate. When several route groups or UIDs cover the same surface (`proto-logs`, `proto-logs-ai`, `proto-async-logs` and `proto-guardrails-logs` all cover the `logs` node), the linked UID is the one the designer means. Find siblings by grepping both registries for the same `sitemapNodes` or id stem and the canvas registry for the topic; a canvas can be newer than the prototype it refines, and main's `redirects()` shows which iteration the bare path was promoted to. Do not silently pick a newer one; if one exists, say so in the PR.

## 3. Check whether production already has it

Do this before reading prototype source in depth. It needs only the UID and the registry row, and it decides what the deliverable is. Prototypes are not always upstream of production: private endpoints shipped from PR #35967 on 2026-09-03 without citing the sandbox, and the `ner4dp` prototype was then edited on 2026-09-15 and 2026-09-16 to match production's copy and ZDR field; the `/logs` prototype (2026-03-05) never led the production Jobs tab (PR #15568, 2026-03-25).

- Resolve `sitemapNodes` through the sandbox sitemap, then grep `projects/web` for the page title and both nouns when a rename happened (`projects/web/next.config.ts` holds the redirects). Routes live under `projects/web/app/[locale]/`; features under `projects/web/features/`, `projects/web/components/` and `packages/frontend/`. Canvases have no sitemap nodes: grep for the fixture's keys, asset paths or the DES ticket number.
- Date production with `git log --follow --oneline -- <folder>/page.tsx`; a plain folder log starts at the last move (everything under `app/[locale]` moved there on 2026-09-06) or rename.
- `gh pr list --state all --search '<uid>'` shows earlier ports and open PRs by the designer; also `git grep -l 'design sandbox' origin/main -- projects/web packages/frontend` for ports whose comments name their source, such as `projects/web/app/[locale]/(home)/benchmarks/explore/MediaGallery.tsx`.
- If production exists, the deliverable is a delta: a table of prototype versus production versus what the API can express, production-only features kept and listed as deviations, and the direction of drift stated. The answer may be that no PR is needed. A resolve-and-plan run stops here.

## 4. Decide what kind of reference this is

```sh
GROUP=$(git -C "$SANDBOX" ls-tree -r -d --name-only origin/main app | grep -E '^app/[^/]+/prototype/<uid>$' | cut -d/ -f2)   # e.g. (proto-workspaces)
if [ -z "$GROUP" ]; then
  echo 'not a /prototype route'
else
  git -C "$SANDBOX" show "origin/main:app/$GROUP/layout.tsx" | grep -q DsRoot && echo DS || echo LEGACY
fi
```

- **DS** (layout wraps `DsRoot`, kit imports from `@/rebrand/components/ui`, tokens `--text-*` and `--radius-*`): a reference for layout, behaviour, component choice and copy. Token values still come from this repo's DESIGN.md, not from the prototype.
- **Legacy** (no `DsRoot`; a layout that is only `createProtoLayout({...})`; imports from `@/shared/components/ui`; raw Tailwind sizes and colours; the shared Navbar/Sidebar): a reference for information architecture and behaviour only. Never copy its styling, spacing, type sizes or colours.
- Every `/rebrand/<slug>` route is DS: `app/(rebrand)/rebrand/layout.tsx` wraps `DsRoot` (there is no `app/(rebrand)/layout.tsx`). Every external branch is legacy. A canvas is DS unless its registry row says `legacy: true`; confirm from the `_client.tsx` imports.

## 5. See the rendered page

In order of cost:

1. Prototypes have committed thumbnails in both themes, no auth needed: `git -C "$SANDBOX" show "origin/main:public/thumbnails/light/<registry.thumbnail>" > /tmp/<uid>-light.webp` (keep the registry's extension; older ones are `.png`). Canvases have none. For a legacy prototype the light one is enough.
2. Source citations by path are enough for most PRs.
3. design.openrouter.ai sits behind Cloudflare Access. Any non-browser fetch gets a 302 to `openrouter.cloudflareaccess.com`; that is expected, not a broken link, and the hub can also be down for humans while the 302 looks healthy. Never make the live URL a prerequisite; a signed-in human can screenshot it. An agent on a signed-in laptop can drive that browser read-only (`agent-browser --headed --profile Default open <url>` with the person's Chrome executable), never clicking a confirm and never putting captures with real data in the PR.
4. Run the sandbox in the checkout you created: `pnpm install && pnpm dev --port 4xxx` (install regenerates the gitignored registry indexes), then open `http://localhost:4xxx/prototype/<uid>/...` directly and confirm the served app is the sandbox. Prototype and canvas routes render from fixtures with no `.env.local`; the hub at `/`, `/lab` and the media tools need Cloud SQL and GCS keys and 500 without them.
5. Devin sessions only: the Cloudflare Access service token in the environment (`CF-Access-Client-Id` and `CF-Access-Client-Secret` headers) returns the rendered HTML from design.openrouter.ai. It does not open Vercel previews.

## 6. Map onto openrouter-web

Work in a worktree off `origin/main` (`git worktree add .claude/worktrees/<des-nn-slug> -b <you>/<des-nn-slug> origin/main`, then `bun install --frozen-lockfile` inside it); never switch the primary checkout. Read `packages/frontend/AGENTS.md`, `projects/web/AGENTS.md`, `packages/frontend/data-layer/AGENTS.md` and `packages/frontend/data-layer/REVIEW.md` before writing code. The default is to modify the existing surface found in section 3, not add a parallel one.

**A new page** under a section needs more than a folder: the section registry (`projects/web/app/[locale]/(user)/(dashboard)/settings/constants.tsx` for settings), the item in `projects/web/app/[locale]/(user)/(dashboard)/Sidebar.tsx` with its visibility flags, a workspace-capability decision in `projects/web/app/workspace-route-capabilities.ts` (CI enforces it; blocked nav entries render disabled through the shared components, never hidden, per `projects/web/REVIEW.md` → Workspace capability review), the HIPAA and ePHI surface check in root `AGENTS.md`, and the page under `app/[locale]`.

**Gating.** Ask whether the surface also ships behind a Statsig flag (`packages/frontend/feature-flags/registry.ts`), an entitlement (`packages/entitlements/gates`), or an org-admin check, and compose them into one gate component that shows the loader until values settle and fails closed. Leaf controls that act on a capability-gated surface use `useWorkspaceCapabilityGate`. To see an entitlement-gated page locally, set localStorage `devpanel.entitlement-overrides` (see `packages/frontend/hooks/entitlement-overrides-storage.ts`).

**Kit.** Sandbox `@/rebrand/components/ui/<kebab-name>` (the alias points at `src/features/rebrand/components/ui`) maps to `packages/frontend/components/ui/<PascalName>`, imported as `@openrouter-monorepo/frontend/components/ui/<Name>`. Exceptions: `copy-button` is `CopyToClipboardButton` (one directory deeper, `.../ui/CopyToClipboardButton/CopyToClipboardButton`), `sonner-toaster` is `Toast` with `use-toast`, `date-range-picker` is `DateRangePresetPicker`, `data-table` is `Table` plus `TableCells`, `TableVirtualBody` and `TableFilter`, `combobox` is `Select`, `MultiSelect` or `QuickSelect`, `toggle` (the selection check on cards and rows) is `Checkbox`, or `Switch` for an on/off control; `carousel` has no counterpart. Confirm props against the local file every time. Page shells are not in the kit: `DashboardPage`, `LoggedInGate`, `OrgGate` and `projects/web/components/Takeover` live in `projects/web`; a prototype `_components/` fork of one of them means use or extend the original. Read `packages/frontend/components/ui/DESIGN_PORTING.md` and `packages/frontend/components/ui/RADIX_TO_SEMANTIC_MAP.md` before mapping a legacy prototype. The sandbox `cn` from `@/shared/lib/utils` is `@openrouter-monorepo/frontend-utils/cn`. Icons: lucide-react matched by meaning, per `packages/frontend/AGENTS.md`; when the file you extend still imports heroicons, add the new icon from lucide and migrate neighbours only if the diff stays small.

**Tokens and copy.** Token names are shared (`--text-*`, `--radius-*`, semantic colours); values come from DESIGN.md and `packages/frontend/components/ui/theme.css`, never from a raw value the prototype hard-coded. Sentence case for every UI string per `packages/frontend/AGENTS.md` and DESIGN.md → Typography → Capitalization; the sandbox is not linted for it. When production already uses a different name for the surface, keep production's and cite the review that chose it.

**i18n.** Sandbox copy is plain JSX. Here every display string is translated at the source and the catalog is committed with the change, per `projects/web/AGENTS.md` → User-facing copy (changed-file lint fails `bun run verify` otherwise); run `bun run --cwd projects/web i18n:extract` after adding copy. Navigate with `useLocalizedRouter` (`projects/web/i18n/use-localized-router.ts`) and the shared `Link`, and format dates with the locale formatters; never `next/link` or `toLocaleDateString` directly.

**Data.** Locate the real Zod schemas (`packages/frontend/<feature>/`, the `cfw-frontend-api` route) before trusting the prototype's fixtures. Replace fixtures with the TanStack Query data layer; if that needs a new `cfw-frontend-api` route, the route and the UI are separate layers and ship as a stack per root `AGENTS.md` → Pull Requests. Where a field the design hinges on does not exist (`resumeAt`, a `pending` status, an alias), do not fake it: name the field and the UX branch that disappears with it in the PR. The API decides where persistence happens; adjust primary labels, read-only fields and resume entry points to the step that creates the record. Every fetch and mutation needs loading, error and retry states; the prototype has none.

**Prototype-only mechanics.** Grep the prototype for `inert`, `outside scope`, `prototype-only`, `sample data`, `sessionStorage`, `localStorage` and review params. Each hit is either a real route or mutation to build, or something to drop. Out-of-scope navigation rendered as spans becomes live links; a menu item with no handler and no API route is dropped and named in the PR. The forked chrome contributes one fact, where the new item sits in the rail.

**Mobile.** DS prototypes render tables as card lists below `md`. Every change here is exercised at about 390px and at desktop (`projects/web/AGENTS.md` → Responsive and mobile conventions), and the kit `Table` has no card mode, so either write the card list (copy an existing one) or collapse the table to one column below `md` the way the rankings tables do; never a `min-w-*` table inside `overflow-x-auto`. State the choice in the PR.

## 7. Verify and open the PR

- Tests per root `AGENTS.md` → Testing: a colocated `*.dom.test.tsx` for every form, mutation and state the port adds (`packages/frontend/AGENTS.md`), plain-function tests for new helpers such as step resolution or error copy, run with `bun run --cwd projects/web test::dom`.
- `bun run verify` from the worktree.
- Capture the surface in light and dark, phone and desktop, with `.agents/skills/frontend-screenshots/SKILL.md`; `.agents/skills/local-dev-env/SKILL.md` and `.agents/skills/clerk-dev-signin-token/SKILL.md` get a dashboard page running with seed data. Compare against the thumbnails or a live render, and check `agent-browser errors --json` before calling a difference drift: dev-only hydration mismatches blank out text that production renders. The PR's Vercel preview is SSO-gated too, so the PR body carries the captures.
- Once the PR leaves draft, run `bunx pacwich affected list --base "$(git merge-base origin/main HEAD)" --head HEAD --ignore-uncommitted --json`; if it names `@openrouter-monorepo/web` or `@openrouter-monorepo/test-web-e2e` and the PR changes rendered output or page behavior (a design port always does), run the visual regression and smoke suites per `.agents/skills/update-visual-regression/SKILL.md` and record the result in the PR.
- Remove the archive copy when the implementation is done: `rm -rf "$SANDBOX_MAIN"`. Each run makes a fresh `mktemp` dir and nothing else cleans it up — do not use an `EXIT` trap for this, since agent shells can exit per command and would delete the copy mid-workflow.

The PR description links the sandbox URL and the resolved source (repo, branch or commit SHA, folder), names the iteration and, for a canvas, the artboard, lists the states implemented, the fields and actions dropped because the data does not exist, the production-only features kept, and the direction of drift from section 3. Commit messages follow root `AGENTS.md` → Pull Requests (`<type>: <short description>`, no trailers).

## Gotchas

- A `/prototype/<uid>/<path>` whose `<path>` folder is missing is usually a dynamic segment (`[...slug]`, `[wsId]`); look for bracketed directories before assuming a client-side state machine in the nearest `page.tsx`.
- A bare `/prototype/<uid>` page is often only a redirect to a default child plus the draft explorer.
- Old links to `/prototype/26vaf0/notifications-next/...` redirect to `.../notifications/...`; the folder is `notifications`.
- `pnpm reindex` output (`src/shared/data/prototypes/index.ts`, the canvas `files.ts` and `loaders.ts`) is gitignored; `git show origin/main:` cannot read it and `pnpm install` regenerates it.
- The sandbox's synced copy of the spec (`public/rebrand-design-system.md` and the `/system` Design MD tab) can lag; read this repo's root `DESIGN.md` only.
- A route folder can carry its own `_components/` copy of a feature component that differs from the namesake under `src/features/<name>/components/`; read the one the route imports.
- If you must read someone else's clone, its working tree can be on another branch or dirty; that is why every snippet above reads `origin/main`.

## Improve this skill

The URL table mirrors `rewrites()` and `redirects()` in the sandbox `next.config.ts` and was last checked against origin/main `f5e2b93c` on 2026-09-22; the legacy count, kit exceptions and registry field counts date from the same day. When a link does not resolve with the table, re-read that file on the sandbox's origin/main and update the table in the same PR as the implementation.
