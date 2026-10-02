# Frontend review pilot

Status: layer 1 (lint) is implemented as `openrouter/no-off-design-surface` with a per-file baseline. Layer 2 (Perry) is twelve draft criteria with synthetic calibration cases in a manual-only skill; automated dispatch and merge enforcement are not enabled, and those criteria are not calibrated or approved for routine review.

Researched on 2026-09-22 against `openrouter-web` commit `9ae78e57ff18038c493442629a0488c1d29e8a35`. GitHub settings below were read separately on that date.

## Recommendation

Split the work by what can be decided from source alone.

1. **Layer 1, lint.** Anything a token name decides runs in the existing required `lint` check, in the editor, and in every coding agent's verify loop. This costs engineers nothing new and catches drift before a PR exists. The first rule, `openrouter/no-off-design-surface`, enforces the color, type-size, and z-index parts of [DESIGN.md → Public surface](../../DESIGN.md#public-surface) on changed frontend files.
2. **Layer 2, Perry.** Anything that needs judgement (the right status for the meaning, whether a responsive change kept a name or an action, whether reduced motion still reaches a usable state) becomes a conditional frontend pass in Perry, backed by the repository-owned `frontend-review` skill. It starts advisory, as a collapsed section of Perry's existing review body.

Engineers already run lint and already ask Perry, so neither layer adds a step. Layer 1 is the faster fix for the design team's complaint, because most off-system UI is visible in class names. Layer 2 needs Perry access and calibration before it runs on real PRs.

Designers own the standards and calibration examples, and the content of every rule: the allowed tokens, which classes a primitive accepts, the fix each diagnostic names, and the Perry criteria. Engineering co-owns the pipeline and rollout: where each rule runs, its runtime, baselines, and when it turns on. Routine feature PRs proceed through the normal engineering review process. Requests for a new design pattern or an exception can go to design without making every frontend PR wait for a designer.

Fraser identifies Allen Guan (`apguan`) as the production design-system owner and DS PR reviewer. Propose him as the pilot's design-system policy/calibration co-owner, paired with a frontend/tooling engineer, subject to his agreement. His [foundation PRs, direct reviews, and production examples](../../.agents/skills/frontend-review/calibration/history.md) are stronger calibration material than generic external preferences. This does not introduce a requirement for Allen to review every frontend PR.

Adapt Jakub Krehel's change-review method and accessibility references for layer 2, and evaluate Impeccable's detector against existing lint before choosing any additional enforcement tool. Use Rams' review/fix/recheck workflow as a reference for a small stateful integration around Perry, so findings survive between pushes and any eventual merge decision has current evidence.

## Layer 1: `openrouter/no-off-design-surface`

Source: [`scripts/oxlint/no-off-design-surface.ts`](../../scripts/oxlint/no-off-design-surface.ts), baseline in [`no-off-design-surface-baseline.ts`](../../scripts/oxlint/no-off-design-surface-baseline.ts). It scans string literals and template parts in `projects/web`, `projects/mission-control`, and `packages/frontend` (tests excluded) and reports:

| Token | Why | Pinned in baseline |
| --- | --- | --- |
| Legacy Radix step (`text-red-11`, `bg-slate-3`) | Renders, but outside the public surface; `RADIX_TO_SEMANTIC_MAP.md` names the replacement. | 469 |
| Tailwind default palette (`text-red-500`, `bg-emerald-500`) | Generates no CSS: `packages/theme/index.css` sets `--color-*: initial`, so the element inherits its parent's color. | 8 |
| Raw hex utility (`bg-[#ff0000]`) | Bypasses both themes. Third-party brand marks use a disable comment with a reason. | 81 |
| Off-scale font size (`text-[13px]`) | Outside the nine type tiers. `text-[length:var(--text-*)]` is allowed. | 81 |
| Arbitrary z-index (`z-[999]`) | Outside the z-index ladder. Numeric `z-10`/`z-0` local stacking is not flagged (see decisions). | 18 |
| Selected fill on hover (`hover:bg-accent`) | DESIGN.md → Generated-design reflexes: hover is neutral `card-hover`; `bg-accent` is the selected state. Also the Bauhaus audit's hover convention. | 52 |
| `transition-all` | Animates layout and paint properties by accident. Flagged by Vercel's Web Interface Guidelines, Rams, animations.dev, and FR-006. | 15 |
| Raw duration (`duration-300`, `duration-[350ms]`, `delay-150`) | DESIGN.md → Motion: durations come from the transitions.dev scale in `theme.css`, picked by usage. `duration-0` stays for instant changes. | 117 |
| Built-in or arbitrary curve (`ease-out`, `ease-in-out`, `ease-[cubic-bezier(…)]`) | DESIGN.md → Motion: `ease-smooth-out` by default, `ease-in-out-strong` for movement, `ease-drawer` for sheets. `ease-linear` stays for constant motion. | 27 |
| Tailwind size alias (`text-2xs`, `text-3xs`, `text-xs` to `text-6xl`, incl. `text-sm/6`) | DESIGN.md → Public surface names the nine tiers only. theme.css remaps the aliases with duplicates (`text-xs` = `text-sm` = 14px, `text-base` = `text-lg` = 16px), so the alias hides the role. The message names the exact tier per alias, from Carlos Arevalo's DES-94 v2 scale (2026-09-28): `xs`/`sm` → `text-body`, `base` → `text-section`, `lg` → `text-heading`, `3xl` → `text-display`, `4xl`/`5xl`/`6xl` → `text-hero`/`text-hero-lg`/`text-hero-xl`, `2xs`/`3xs` → `text-caption` (or `text-overline` when uppercase). | 5,693 |
| Off-scale leading (`leading-5`, `leading-relaxed`, `leading-[18px]`) | Leading pairs with the tier: `tight`, `snug`, `body`, `prose`. `leading-none` and `leading-[var(--leading-*)]` stay allowed. | 326 |
| Off-scale tracking (`tracking-wide`, `tracking-widest`, `tracking-[0.2em]`) | `tracking-tight` on Gordita tiers, `tracking-wider` on nav section headers, none on body/prose/button. `tracking-normal` stays as a reset. | 108 |
| Off-scale weight (`font-light`, `font-black`, `font-[400]`) | The scale uses 450 (`font-normal`), 500, 600, 700; never a literal weight. | 5 |
| Family class (`font-sans`, `font-serif`, `font-inter`, `font-geist-mono`) | Jakarta is the default; `font-brand` and `font-mono` are the only family classes. | 18 |
| Title Case by class (`capitalize`) | Sentence case everywhere (DESIGN.md → Capitalization). `uppercase` is not flagged: nav section headers are the one permitted use (design sync, 2026-09-23) and lint cannot tell them apart, so FR-013 reviews it until DESIGN.md removes uppercase entirely, when lint flags it everywhere. | 24 |
| Raw white or black (`bg-black/50`, `text-white`, `ring-white`) | Renders (`--color-white`/`--color-black` survive the palette reset) but sits outside the public surface. A scrim is `bg-background/60` (DESIGN.md → Surface hierarchy); text on a fill is `text-primary-foreground`. Photo overlays and logos take a disable comment. The kit's `Dialog`, `AlertDialog` and `Sheet` overlays still use `bg-black/50`; they are pinned until a kit PR moves them to `bg-background/60`. | 97 |
| Radius off the Shapes scale (`rounded-2xl`, `rounded-[3px]`, `rounded-xs`, `rounded-[var(--radius-md)]`, any side) | DESIGN.md → Shapes: `sm` to `xl`, `full`, and the `rounded-none` reset. `2xl`/`3xl` are the chat and marketing exception and take a disable comment; `xs` is the codemod alias for `sm`; the `var()` form is the same token written the long way. | 177 |
| Arbitrary spacing (`p-[13px]`, `gap-[10px]`, `-mt-[2px]`, `inset-[1rem]`) | Padding, margin, gap, space-between and inset use the spacing scale. Positioning (`top-[3px]`) is not included. | 17 |

The baseline pins 7,333 existing tokens across 1,691 files, rebuilt on `main` on 2026-09-28 after the design-system migration sweep with `bun run lint:design-surface:baseline`, so once enabled only new tokens fail. It merges `'off'` in `oxlint.config.ts` and runs through the opt-in `bun run lint:design-surface` until design has adjudicated the replay and the pilot week is clean. Migrations lower a file's count in the same PR. Satori `tw` props in OG image routes are exempt, because Satori renders them with Tailwind's own palette. A full frontend scan with only this rule takes about 2 seconds for 12,678 files (Apple-silicon Mac, 2026-09-28), well inside the 10-second budget in [Keep review fast](#keep-review-fast); CI lints changed files only.

Known gaps, measured on `main` on 2026-09-28: the rule reads every string literal, not only class props, because class lists also live in `cva` variants, maps and constants. None of the 6,791 findings measured before the radius, white/black and spacing kinds is prose; the one false-positive shape is CSS inside a string (`ease-in-out` in an inline `@keyframes` or `animation:` block, two hits, pinned). oxlint does not parse `.mdx`, so MDX pages go unchecked: 20 off-surface classes, all `text-sm` on the legal pages. Both are follow-ups before the flip, not blockers for the pilot.

The scan also found a live defect: the eight Tailwind-palette tokens are the Mission Control ban-candidate timing markers in `projects/mission-control/app/admin-utils/sentinel/ban-candidates/ban-candidate-account-timing.ts` (`bg-blue-500`, `bg-emerald-500`, …). None of those classes is registered, so the markers render without a color. They are pinned rather than fixed here and need a follow-up owner.

Next layer-1 candidates: hex written as a plain string (`color: '#94a3b8'`, 12 in color maps outside the exempt OG routes; the message points at `useChartColors()`), `outline-none` with no `focus-visible:` replacement in the same class list (36 on main, from Vercel and Rams; needs a check for primitives that restore focus), `font-brand` outside page titles and display stats, `font-mono` on text that is not code, an ID, or a number (720 tokens in 364 files on main, most of them legitimate, so it needs an element or content heuristic and a baseline before it can run), shadows on resting surfaces, opaque status fills (`bg-positive text-white`), synonyms such as `text-[var(--positive-text)]` or `hover:bg-muted/50`, and numeric z-index once design decides whether local stacking is allowed. In the last 30 days, the hover and `transition-all` kinds would have flagged 9 tokens in 8 merged PRs, including #45176 (`hover:bg-accent` in benchmark navigation); the duration and curve kinds, 36 tokens across 20 changed files, including #40731 (`duration-[0.35s]` and an arbitrary curve in `NavigationMenu`).

## Building on the design-system migration

Checked on 2026-09-24 against `origin/main`. Robert Sun's sweep moved hand-rolled controls in web and Mission Control onto design-system primitives (for example #46519 form controls and listboxes, #46522 and #46515 buttons, #46520 toggles, #46511 spinners and loading, #46510 empty states, #46526 and #46527 links), and #46552 added the matching guidance to the root, `packages/frontend`, web, and Mission Control `AGENTS.md` files. Outside `packages/frontend/components/ui/`, raw `<select>` fell from 21 to 8, `<input>` from 67 to 27, `role="button"` from 30 to 22, and `<button>` from 676 to 406.

Nothing enforces either one yet: the guidance is advice to agents, and no design rule landed in `oxlint.config.ts`. Layer 1 is what keeps the sweep from eroding. The pilot's goal is lasting adherence and craft, not cleanup, so the per-PR workflow does not adopt the sweep's method: Perry never asks for a screenshot or recording by default, and evidence is requested only when a finding cannot be confirmed without the rendered page.

### Pipeline: follow the existing lint

- Design rules run in the changed-files syntax pass of `oxlint.config.ts` through `scripts/oxlint-lint.ts`, so they add no job and no full-tree scan to `lint`.
- They stay syntax-only. The type-aware pass loads a TypeScript program per chunk and dominates lint time (#46204); a design rule does not need types.
- Any design task that must see the whole tree follows #46486: gate it on the shared git scope and skip it when no frontend source changed.
- `bun run lint:design-surface` is a pilot tool for replaying the rule across the tree, not a CI step.
- Measure each rule's incremental runtime against the 10-second budget in [Keep review fast](#keep-review-fast), and rebuild the `no-off-design-surface` baseline on post-sweep `main` before enabling it.

### Next lint candidates

1. **Raw form controls.** Built as `openrouter/no-raw-form-control` (off, in the pilot): flags `<select>`, `<input>` (file and hidden exempt) and `<textarea>` outside `packages/frontend/components/ui/`, with 32 pinned uses on 2026-10-01, 18 of them in the `/labs/library` port merged that day. `<label>` waits for a later pass. The original candidate: flag `<select>`, `<input>`, `<textarea>`, and `<label>` outside `packages/frontend/components/ui/`, naming the primitive from the `packages/frontend/AGENTS.md` list. The small remaining counts make a short baseline; DES-91 (a hand-rolled `<select>` in `FilterSelect.tsx`) is its first real incident. Raw `<button>` waits until the remaining 406 are sorted into legitimate uses and migrations.
2. **Restyled primitives.** Evaluate `@shadcn/lint`'s `no-restyle` with design-authored contracts (which classes `Button`, `Tabs`, `Card`, and `Input` accept) and messages that cite DESIGN.md. If it holds on a replay, FR-008 keeps only its layout-context failure mode. Before adopting it: pin the version, confirm it needs no install scripts or `trustedDependencies` entry, confirm the Oxlint floor (1.80; the repo runs 1.81), measure its runtime (it resolves components through TypeScript paths), and leave its `no-raw-colors` and `no-arbitrary-values` off so token drift is reported once, by `no-off-design-surface`.
3. **Escape hatches.** Once lint blocks the easy path, drift moves to disable comments on design rules without a reason, a baseline that grows, and variants added to a primitive to satisfy a rule. Reserve these for FR-009 or a new criterion rather than lint.

### Calibration from the sweep

The migration PRs are before-and-after pairs that should mostly pass, so replaying them is the false-positive test the synthetic cases lack. #46023 reverted #44484, the site-wide press feedback FR-009 asks about, which confirms that case.

### Carlos's review (2026-09-24)

Carlos Arevalo reviewed the demo and raised six gaps. Counts are from `origin/main` on 2026-09-24, outside `packages/frontend/components/ui/`, tests, and stories. Three can start now without waiting for the lint or Perry pilot; the rest extend it.

| Gap | Where it lives | Size today | Depends on this pilot? |
| --- | --- | --- | --- |
| Stories for kit components | A CI check: a new or changed `.tsx` in `packages/frontend/components/ui/` needs a sibling `.stories.tsx`. Kit only, helpers exempt. | 25 of 120 kit files have no story. | No |
| Page shells and marketing widths | Design picks one marketing shell and a content-width scale in DESIGN.md, then the pages migrate. Afterwards FR-010 extends to "use the shell and a width from the scale", and lint flags arbitrary `max-w-[…]`. | Marketing routes use 14+ widths (`max-w-2xl` to `7xl`, `max-w-[1280px]`, `prose`, `none`, …). | Decision and migration: no. The rule after it: yes. |
| Design on kit changes, and new components or variants | CODEOWNERS on `packages/frontend/components/ui/**` requests design on every kit change (requested, not required, so frontend PRs don't wait). New variants are FR-009's escape-hatch check; lint can flag `cva(` outside the kit. Rule-file approval is the ruleset in [Who can change what](#who-can-change-what). | 3 files outside the kit define variants. | CODEOWNERS: no. The checks: yes. |
| Spacing, radius, shadows, opacity | Radius and arbitrary spacing are `no-off-design-surface` kinds. Flagging `1.5`, `2.5` and `3.5` waits for DESIGN.md's spacing rule (Carlos Arevalo's proposal on #46648: multiples of 4 plus 2px, rows sized by `h-*`), which lands with the kit's row-height changes in one PR. Shadows and opacity need context (floating surfaces may cast shadows; fades animate opacity), so they start as a Perry criterion. | 151 off-scale radius, 16 arbitrary px spacing, 135 shadows, 188 `opacity-*` other than 0, 50, 100. | Yes |
| Raw `<button>`, `<select>`, … | Already [Next lint candidates](#next-lint-candidates) item 1. | 408 raw `<button>` left to sort. | Yes |
| Color, radius, and border overrides | `no-restyle` contracts cover every class category, not only size, so design writes which colors, radii, and borders each primitive accepts. FR-008 widens from size to any restyle lint cannot see. | Measured once the contracts exist. | Yes |

## Layer 2: draft Perry criteria

These are the draft criteria that lint cannot decide. FR-006 and FR-007 were added from animations.dev's performance and reduced-motion lessons after an evidence check on main: 121 looping-movement uses against 12 `motion-reduce:animate-none` guards, and 91 `transition-all` or layout-property transitions. Entrance-from-zero and `ease-in` rules were not added, because main has no uses. The [manual-only index](../../.agents/skills/frontend-review/SKILL.md) loads the draft files and [synthetic calibration cases](../../.agents/skills/frontend-review/calibration/cases.md). Historical incident examples and measured replay results are still needed before activation.

Existing lint remains the owner of checks it already enforces, including off-surface utilities, image alt attributes, static control labels, click/keyboard rules, Zustand selectors, and keyed submit-button swaps. General correctness, security, and data-layer review remain with their existing reviewers. The frontend pass adds evidence about the user-facing consequences and avoids duplicate comments.

| Review area | First criterion | Verification | Initial state |
| --- | --- | --- | --- |
| Tokens and primitives | `FR-001`: changed status feedback uses the status token that matches its meaning and rendering role. | Source and token-role tracing; rendered proof only for additional visual claims. | Draft; manual calibration only. |
| Accessible controls | `FR-002`: a changed icon-only or responsive control retains an accessible name in each affected layout. | Existing lint first, then computed accessible-name evidence for affected layouts. | Draft; manual calibration only. |
| Mobile actions | `FR-004`: an essential desktop action hidden at a breakpoint remains operable through a mobile path. | Desktop/mobile action parity and successful activation under the same permissions/data. | Draft; manual calibration only. |
| Reduced motion | `FR-005`: an animated disclosure reaches a usable final state with reduced motion enabled. | Open/close/reopen the real disclosure in reduced motion and verify its content/control state. | Draft; manual calibration only. |
| Motion | `FR-006`: changed motion animates `transform`/`opacity` (and color on hover), not layout properties, and names what it transitions. Adapted from animations.dev. | Source trace of transition and animation properties; frame cost is not measured. | Draft; manual calibration only. |
| Reduced motion | `FR-007`: looping or autoplaying movement stops or becomes opacity-only under reduced motion. Adapted from animations.dev. | Source trace of loop classes and reduced-motion variants, including shared components. | Draft; manual calibration only. |
| Tokens and primitives | `FR-008`: a sized primitive keeps its `size` variant's height, padding, and type; a container change does not resize a child that stretched. From the sign-up height incident (#27013 → #35862 → #39318). | Source trace of call-site overrides and container alignment; rendered height when unclear. | Draft; real incident. |
| Tokens and primitives | `FR-009`: a change to a shared primitive's defaults is a design-system decision and applies consistently. From #44484 (press feedback on every `Button`). Always a policy question; a CODEOWNERS entry for the few primitive and theme files is the deterministic complement. | Changed file under `packages/frontend/components/ui/` or a theme file, plus PR body for design sign-off. | Draft; real incident. |
| Motion | `FR-011`: changed motion fits what it does, per DESIGN.md → Motion: curve and duration tier by role, closes quicker than opens, floating surfaces grow from their trigger, a container enters once, and a state that can flip mid-animation is a transition. Adapted from animations.dev; the lint kinds only force a token, not the right one. | Source trace of curve, tier, origin, and entrance nesting against the motion's role; feel at speed is not measured. | Draft; synthetic only. |
| Motion | `FR-012`: motion on something triggered many times a day from the keyboard (a `⌘K` palette, an arrow-key highlight) is instant. DESIGN.md is silent, so it is always a policy question. Adapted from animations.dev. | Source trace from the keydown handler to the surface's animation. | Draft; both command palettes animate today. |
| Typography | `FR-013`: `uppercase` renders only on nav section headers, with the full recipe. Lint cannot tell a nav header from any other label, so review covers it until DESIGN.md removes uppercase. | Source trace of the element's role (nav group label or not). | Draft; manual calibration only. |

`FR-003` (a failed request shown as empty or success) is retired. It duplicated [root REVIEW.md → Unknown Values](../../REVIEW.md#unknown-values), which the general reviewer already owns. Its ID is not reused.

Primitive reuse, keyboard activation, dialog focus restoration, broader mutation feedback, autoplay, and motion craft beyond FR-011 and FR-012 remain follow-up criteria within these areas. Each needs its own trigger, exceptions, evidence, and calibration; the first four must not expand to cover them implicitly.

Every adopted check must provide a concrete diff signal, a canonical source, a demonstrated failure, an allowed near-miss, an actionable remedy, and a way to verify the fix. A recommendation that cannot meet that bar stays in optional design critique until it is better specified. A check that can be decided from source alone belongs in layer 1.

Use Jakub's scope/evidence method across these checks, the relevant accessibility and motion references within matched checks, and Rams' finding lifecycle for follow-through. Trial Impeccable only for measurable coverage beyond existing tooling.

## Validate before any org-wide change

Turning layer 1 on is an org-wide change: the next PR that adds an off-surface token fails lint. So it merges `'off'`, with an opt-in pilot command, and flips to `'error'` in its own one-line PR. Each step below runs before the one after it.

| Step | Who | Blast radius | What it proves |
| --- | --- | --- | --- |
| 1. Lint replay | Design + one engineer | None: read-only report | Would the rule have flagged real drift, and nothing legitimate, over recent history? |
| 2. Lint pilot | Designers and volunteer engineers | Only people who run it | `bun run lint:design-surface` runs the rule alone while it is `'off'` in `oxlint.config.ts`, so nobody's CI changes. |
| 3. Local layer-2 replay | Design | None: report in `.context/` | Whether each draft class finds the right things on historical PRs. |
| 4. Perry chat replay | Design, in a Slack thread with Perry | None: blind mode posts nothing | Perry applies the same classes the same way, with no Perry code change. |
| 5. Sandbox PRs | Design, in `OpenRouterTeam/openrouter-design-sandbox` | Sandbox only (repo allowlist) | Perry's mechanics once the pass exists: the review-body section, the setting, the citation allowlist. |
| 6. Opt-in in openrouter-web | Design team's own PRs | Design's PRs only (author allowlist) | Real behaviour and latency before the setting widens. |
| 7. Lint on for everyone | Every frontend PR | Changed files in the required `lint` check | A one-line PR sets the rule to `'error'` and regenerates the baseline on current `main`, so only new drift fails. |
| 8. Advisory on every frontend PR | Every frontend PR | Perry's collapsed advisory section; never blocks | A reviewed Perry PR widens the author allowlist once step 6 has run about two weeks with useful results. |

Merging the lint and skill PRs changes nothing for engineers: the rule lands `'off'`, and the skill is manual-only until a Perry change reads it. Suggested timing, to be agreed with engineering: steps 1 and 2 in the two weeks after the lint PR merges, and step 7 in week three or four once the pilot week is clean. Steps 3 to 6 and 8 start when Perry has a named maintainer, since each needs a Perry PR first. The pilot waits for DES-94: the size messages already point at `text-hero-lg`, `text-hero-xl` and `text-caption`, which land with that PR, so step 2 starts only once they are on `main`. If DES-94 also builds uppercase and `+0.05em` into `text-overline` (proposed in v2), FR-013's nav-header recipe and the `tracking-wider` wording in the tracking message change with it.

1. **Lint replay.** A replay script (local to design for now, `.context/design-lint-replay.ts`; it can move into `scripts/` if engineering wants to run it too) replays merged commits through the rule's classifier (`scripts/oxlint/off-design-surface-tokens.ts`) and writes one row per PR and file, net of tokens the same commit removed. The first run (2026-09-22, 21 days) flagged 18 PRs: 33 off-scale font sizes (mostly `text-[11px]`, which DESIGN.md maps to `overline`), 6 Radix steps, and 2 arbitrary z-index values. Design marks each row `real`, `allowed`, or `false positive`. Any `allowed` row becomes a rule exemption or a DESIGN.md decision before merge.
1. **Lint pilot.** `bun run lint:design-surface` (config `scripts/oxlint/design-surface.config.ts`) scans the three frontend roots with only this rule, in about 2 seconds for 12,678 files (measured on an Apple-silicon Mac on 2026-09-28; CI lints changed files only); the baseline keeps existing tokens quiet, so any output is new drift. Design runs it on their own branches for a week and on others' open PRs to check the messages. The flip to `'error'` is a one-line change to `oxlint.config.ts`.
1. **Local layer-2 replay.** In Claude Code or OpenCode: "run frontend-review on openrouter-web#28574", or on a synthetic case with its expected outcome withheld. The report lands in `.context/`.
1. **Perry chat replay.** Ask Perry in a thread for a blind review of a historical PR using the class files from this branch, with frontend findings tagged by FR ID. Blind mode posts nothing to GitHub.
1. **Sandbox.** Use the sandbox for Perry's mechanics, not rule accuracy: its DESIGN.md, paths, and tokens differ from production, and it has none of this repo's lint. It needs its own copy of the class files, because Perry reads frontend classes from the reviewed repo. Open seeded PRs and trigger Perry explicitly with the `perry/review` label.
1. **Opt-in.** Run the pass in `shadow`, then `advisory`, on design-team-authored PRs only, before anyone else's. Perry has a per-author opt-out today, not an opt-in, so the frontend-pass setting carries its own author allowlist.

## What we took from each source

Every rule below is restated against DESIGN.md, which wins when a source disagrees. A source's taste is not adopted wholesale: #44484 came from an agent following an installed motion skill that listed missing press feedback as a "missed opportunity", and design did not want it.

| Source | Adopted | Not adopted, and why |
| --- | --- | --- |
| Sandbox Bauhaus audit | Page over-overriding a component (FR-008); component vs spec on primitive changes (FR-009); sibling convention, as FR-008's "matches the siblings in its row"; hover is neutral `card-hover`, never the selected fill (lint `selected-hover`); resolve alpha, not just hue (FR-001 synonyms). | "600 only at `title`": stale since DESIGN.md gave `heading` 16px/600. Its full-page sweep and report tooling: this is a per-PR pass. |
| Sandbox design-review agent | Confirmed versus plausible observations (`FINDING` vs `EVIDENCE_GAP`). | Whole-page clarity critique: optional, not per PR. |
| Vercel Web Interface Guidelines | `transition-all` (lint); animate transform and opacity (FR-006); reduced-motion loops (FR-007); icon-only names (FR-002, with `jsx-a11y`). Candidates: `outline-none` without replacement, `min-w-0` for truncation, `tabular-nums` for number columns. | Title Case headings and buttons: DESIGN.md requires sentence case. `…` instead of `...` (430 uses on main): DESIGN.md is silent, so this is a policy question for design first. |
| Rams skill | Icon buttons, labels, removed focus outline (as above). | 44px targets: WCAG 2.5.5 is AAA, and DESIGN.md sets control sizes. A 0–100 score. |
| animations.dev (Emil) | Compositor-only properties (FR-006); reduced-motion loops (FR-007); easing, duration, origin, entrance, and interruptibility (FR-011); no motion on high-frequency keyboard input (FR-012); no font-weight change on state (DESIGN.md "Weight as state", no uses found on main). Inputs at 16px on touch are already met: `Input` has `pointer-coarse:text-base`. | `scale(0.97)` press feedback: design rejected it on #44484; press feedback is a DESIGN.md decision, not a default. The sub-300ms ceiling: DESIGN.md uses 350–500ms roles. "Default to flagging": the pilot is advisory. |
| transitions.dev (Jakub Antalik) | `transitions refine`'s rule, usage over nearest number, as the two motion lint kinds; its tokens are already in `theme.css` (#42678). Common-mistake candidates for FR-005: a sliding tab pill that animates in from zero on first paint, and padding on a `0fr` grid track that stops a disclosure fully closing. | The 32 recipes are implementation guides, not review rules. Pointer and touch recipes (card tilt, avatar-group hover, plus-to-menu FAB morph, input-clear glow) are off-pattern for openrouter-web's dashboard UI. |
| Impeccable detector | Candidate for rendered checks the static pass cannot do: measured contrast and overflowing text on a preview URL, for FR-001 and FR-008's evidence gaps. | Its DESIGN.md token checks duplicate our lint; taste checks (fonts, eyebrow labels) are not DESIGN.md policy. |

Agent-time guard (proposed, needs design sign-off): add one line to `packages/frontend/AGENTS.md` saying installed design and motion skills are advisory, and that their suggestions for shared primitives in `components/ui/` or theme tokens go to design first. That would have stopped #44484 at authoring time.

## What Perry's workflow means for layer 2

Perry's review-pr skill runs ten phases in one agent turn and never executes the PR's code. The facts that shape this pilot:

| Perry behavior | Consequence |
| --- | --- |
| Phase 4 runs a security pass on every tier: a signal-to-class table in `SKILL.md`, then each matched class file's failure modes. | The frontend pass is a second table in the same phase, loading only matched frontend classes. No new agent, no new service. It runs on trivial PRs too, because a two-line class change is exactly where drift lands. |
| Class files follow one shape (`This class applies when`, `Rule`, `Failure modes to reject`, `What the primitives do not give you`, `Test requirement`, `Calibration`), and a failure mode needs two independent incidents. | The four drafts now use that shape plus two frontend sections (`Not a finding`, `Evidence a static review cannot collect`). Every failure mode is marked `Candidate`, because none yet has two real incidents. That is Perry's own bar for automatic review. |
| Perry's `classes/` is a converged copy of openrouter-web's `security-review/classes/`, and it has already drifted: 5 classes versus 8 here (`agent-boundary`, `content-trust`, `data-retention` are missing). Its complex-tier security prompt hard-codes "its five siblings". | Do not copy frontend classes into Perry. `setup-worktree.ts` already fetches the base branch into the persistent clone, so Perry reads them with `git show origin/<base>:.agents/skills/frontend-review/classes/<file>` from the clone (the worktree is pinned at the PR head). Keep frontend classes out of the security track's directory. Reading from the base, not the head, stops a PR editing the policy it is reviewed under. |
| Static review only; no build, no browser. | Browser-dependent checks become action-item questions ("confirm the computed name at phone width"), which satisfies Perry's rule that every comment asks for something. Rendered evidence stays with the existing VR and screenshot workflow. |
| Every inline comment is an action item; on APPROVE, Perry resolves its own threads; `$PR_RISK_LEVEL` gates APPROVE. | During the pilot, put frontend results in a collapsed "Frontend review (advisory)" section of Perry's review body, not inline threads, and never let them raise `$PR_RISK_LEVEL`. On a COMMENT or REQUEST_CHANGES verdict, inline threads would stay open and block merge through the resolved-threads rule. |
| `--blind` mode reviews a PR with only its diff and source, suppresses posting, and writes findings JSON to `/tmp/perry-blind-out-<owner>-<repo>-<pr>.json`. It runs the full pipeline; there is no way to run one pass. | This is the calibration harness. Replay historical PRs in blind mode, filter the JSON by criterion ID, and score it against expected outcomes. Full runs cost more but are fine for a 20–30 PR replay; a `--classes` flag is an optimization, not a prerequisite. |
| A 15-minute watchdog and per-tier routing. | The proposed 90-second frontend-pass budget sits well inside it. |

### Perry's answers (2026-09-22)

| Question | Answer | Decision |
| --- | --- | --- |
| Read class files from the base branch and record the commit? | Base files are readable from the clone via `git show origin/<base>:<path>`. `review-sha-db.ts` records the reviewed head SHA and verdict, not the commit of any reference material. | Add a policy-SHA column next to the head SHA. Small; required before advisory publication so a stale result can be detected. |
| Will the body-vs-diff gate accept citations of files outside the diff? | No. `findBodyOutsideDiff` (`validators-diff.ts`) rejects any backticked path not in the diff headers or hunk text, and `post-review.ts` exits `19` (`BODY_OUTSIDE_DIFF`). | Extend the gate narrowly: a cited path passes if it exists at the recorded base SHA under an allowlist (`DESIGN.md`, `.agents/skills/frontend-review/**`, and the `REVIEW.md`/`AGENTS.md` files the classes cite). This keeps the hallucination check, since the file must exist, rather than dropping backticks to slip past it. Not needed for shadow mode, which does not post. |
| Can blind mode run only the frontend pass? | No; it runs all ten phases and every class. | Run the first replay in full blind mode and require every frontend finding to carry its FR ID. Add `--classes` only if replay cost becomes a problem. |
| What runs automatically, and is there a per-pass switch? | Auto: `pull_request.opened`, `ready_for_review`, `synchronize` (skipped when the head SHA was already reviewed), gated by `AUTO_REVIEW_ENABLED`; debounced 30 s, capped at 10 concurrent, per-author opt-out. Explicit: `perry/review` label, review request, `@perry` mention. No per-pass toggle. | Add a frontend-pass setting in `webhook-config.ts` with three values: `off`, `shadow` (run the pass, write results to Slack or a file, post nothing to GitHub), and `advisory` (review-body section). Default `off`. |

Two gaps follow from the trigger list. Base retargeting (`pull_request.edited` with a base change) is not a trigger, and the SHA short-circuit would skip it anyway, because the head is unchanged. Base advancement also triggers nothing. Neither matters for an advisory pilot, but both must be handled before any frontend criterion is enforced (see [Recheck on every relevant push](#recheck-on-every-relevant-push)).

### Perry build order

Perry agreed to this order (2026-09-22). Perry is one daemon reviewing every repo, so each Perry PR ships globally the moment it deploys. Isolation therefore comes from what each PR is allowed to change, not from where it runs.

1. **Plumbing, behaviour-neutral.** A nullable `base_sha` column on `reviewed_shas` (captured with `git -C <clone> rev-parse origin/<base>`), and `baseSha` plus `cloneDir` on `GateContext`. Nothing reads them yet: the SHA short-circuit and every gate behave exactly as today. Tests prove an existing review produces the same verdict and the same gate exits.
1. **Frontend pass behind a scoped setting.** A committed constant in `webhook-config.ts`, next to `AUTO_REVIEW_ENABLED`, carrying a mode (`off`, `shadow`, `advisory`), a repo allowlist, and an author allowlist. It defaults to `off` with both lists empty, so deploying it changes nothing. Phase 4's table gains a source column, and path-triggered rules (FR-009's `components/ui/` and theme files) are gated in code before any model call, because the preview showed a model stretching "primitive" to shared feature components. When FR-009 applies, code also counts the changed primitive's reach from `origin/<base>` (uses by variant, icon-only uses, what `render` turns it into, uses in nav, header, sidebar, menu and tab files) and passes it to the model, which cites those counts instead of estimating. With that summary, the preview's question for #44484 opened with reach and intent in 4 of 4 runs, against a generic sign-off question before. Phase 4's table then reads security classes from Perry's `classes/`, frontend classes from the clone's `origin/<base>:.agents/skills/frontend-review/classes/`. Findings carry their FR ID.
1. **Sandbox shadow.** Repo allowlist = `OpenRouterTeam/openrouter-design-sandbox`, mode `shadow`. The sandbox gets its own copy of the class files (it is a test fixture for "rules live in the reviewed repo"). Design opens seeded PRs and triggers Perry with the `perry/review` label. Results go to Slack only.
1. **openrouter-web blind replay.** Perry chat-mode `--blind` runs over 20–30 historical PRs, filtered by FR ID. Posts nothing.
1. **Citation allowlist.** `groundedInAllowlist(ref, baseSha, cloneDir)` in `validators-diff.ts`, a third grounding check beside `groundedInFile` and `groundedInDiffText`. The allowlist is the union of each class file's `## References` globs, read at the base SHA. A cited path passes only when it matches and exists at that SHA.
1. **Sandbox advisory**, then **openrouter-web advisory for design-team authors only.** Mode `advisory`, author allowlist = the design team. Everyone else still gets `off`.
1. **Before any enforcement.** Add `pull_request.edited` (base change) to `decidePullRequest` in `webhook-classify.ts`, and make the short-circuit in `review-dispatch.ts` compare both head and base SHA.

Step 1 is safe to ship now. Step 2 is safe once its default is proven `off`. Nothing reaches a non-design PR until step 6, and then only when the author allowlist is widened in a reviewed PR.

### Who can change what

The rules are Markdown; the engine that reads and enforces them is not.

| Part | Where it lives | Who changes it today | Proposed |
| --- | --- | --- | --- |
| Rules: `DESIGN.md`, `.agents/skills/frontend-review/**`, the design lint rules in `scripts/oxlint/` | `openrouter-web` | Anyone with write access, with one approving review. `.github/CODEOWNERS` covers none of these paths, and `main`'s ruleset has `require_code_owner_review: false`, so a CODEOWNERS entry alone would only request design's review. | A ruleset `required_reviewers` entry that requires the design team's approval on the rule paths, plus CODEOWNERS so the request is automatic. Lint rule code also needs the engineering pipeline owner. Needs a repository admin. |
| Engine: the ten-phase workflow, content gates, credential routing, the SHA dedup database, and the frontend-pass setting | `OpenRouterInterns/perry` | Perry's maintainers, through reviewed PRs. Design has no read access (the repository returns 404 to our accounts). | Name the maintainer who approves frontend-pass PRs, and give the design owner read access so replay results can be traced to code. |

Three properties keep the split safe:

- **A PR cannot change the rules that review it.** Perry reads class files from the base branch at a recorded commit, never from the PR head, so a rule edit applies from the next PR after it merges.
- **The gates stay on.** Content gates keep rejecting malformed reviews. The citation gate is extended by an allowlist that must exist at the recorded base commit, not bypassed.
- **Neither side can switch the pass on alone.** The mode and allowlists are committed constants in Perry, changed by reviewed PR, so design cannot widen publication by editing a rule, and engineering cannot change what a rule says by editing Perry.

## What exists, and what needs correcting

| Area | Verified state | Consequence for this project |
| --- | --- | --- |
| Design language | [`DESIGN.md`](../../DESIGN.md) defines product UI, semantic tokens, component conventions, and motion. [`packages/frontend/AGENTS.md`](../../packages/frontend/AGENTS.md) identifies `components/ui/theme.css` as the runtime token source, layered over `packages/theme/index.css`. | Cite the current rule and inspect the implementation. Legacy code is useful context, but does not establish the rule for new code. |
| Existing design scanner | [`design-scan`](../../.agents/skills/design-scan/SKILL.md) now recommends semantic status tokens, treats Radix steps as migration sources, points swaps at the layer-1 baseline, and states that `jsx-a11y` rules are already enforced. | It remains the scheduled legacy-debt audit. Its color findings and layer 1's baseline describe the same debt, so migrations lower the baseline count in the same PR. |
| Behavioral review | [`projects/web/REVIEW.md`](../../projects/web/REVIEW.md) covers truthful copy and in-flight mutations; [`packages/frontend/REVIEW.md`](../../packages/frontend/REVIEW.md) covers accessibility, layout, and state. [`REVIEW.md`](../../REVIEW.md) carries cross-cutting rules. | Link to these rules. Coordinate ownership with Perry's general review so one defect produces one finding. |
| Mechanical enforcement | [`oxlint.config.ts`](../../oxlint.config.ts), [`scripts/oxlint/`](../../scripts/oxlint/), and [`check-banned-utilities.mjs`](../../scripts/check-banned-utilities.mjs) already enforce frontend conventions. Oxlint runs on changed files, including unchanged lines inside them. | Inventory effective rules and overrides before adding any check. New rules need a legacy-debt strategy before becoming errors. |
| Class structure | [`security-review`](../../.agents/skills/security-review/SKILL.md) uses explicit signal-to-class lookup; its [`template`](../../.agents/skills/security-review/classes/_template.md) separates invariants, failure modes, evidence, and test gaps. | Reuse the structure in a separate frontend skill. Its security-specific investigation breadth and agent-per-class execution are not runtime requirements for this pilot. |
| Emil and motion material | `emil-design-engineering` and `review-animations` loaded successfully from this machine's user-level skills directory. Neither was present at the corresponding `.agents/skills/` path in this checkout. | Perry's access to these files is unverified. Record provenance and a revision for each adopted source, and commit permitted references or reviewed adaptations so reviews do not depend on an engineer's local installation. |
| Visual verification | [`web-e2e-pr.yaml`](../../.github/workflows/web-e2e-pr.yaml) is manual-dispatch only, with a preview-banner mismatch documented. [`update-visual-regression`](../../.agents/skills/update-visual-regression/SKILL.md) requires affected local production-build verification for ready PRs; it documents Mission Control's VR coverage gap. Shared primitives have [`Storybook configuration`](../../packages/frontend/.storybook-ui/main.ts). | Reuse head-commit evidence. Existing screenshots are not automatic pre-merge coverage, and production screenshots do not prove a PR's changes. |
| Merge requirements | `gh api repos/OpenRouterTeam/openrouter-web/rules/branches/main` reports one approving review, resolved review threads, and required checks `typecheck`, `lint`, `unit`, `unit-cfw-runtime`, `integration`, and `Check Merge Freeze`. Perry is not a named required status check in that response. | Advisory inline review threads can still delay merging when Perry's verdict is not APPROVE. Keep pilot results in the review body, and ensure Perry's normal verdict does not wait for the frontend pass. |
| Perry integration | Perry supplied its review-pr `SKILL.md`, class `_template.md`, and `info-disclosure.md`, and answered the integration questions against its code (2026-09-22). See [What Perry's workflow means for layer 2](#what-perrys-workflow-means-for-layer-2). | Build in the order in [Perry build order](#perry-build-order). Repository access is still 404; the answers are Perry's reading of its own code. |

## Source policy before rule writing

Use OpenRouter's current design and frontend documents as product policy. Use external skills as evidence and candidate guidance, with an explicit OpenRouter decision when adopting them. Keep a source index in the proposed skill with the source URL/path, revision, applicable surface, and any local adaptation.

Conflicting advice must be resolved per criterion before that criterion enters the pilot. Examples already found:

- `design-scan` recommends `text-green-10` for status feedback; `DESIGN.md` excludes legacy Radix steps from the new-code public surface.
- The local motion reviewer starts from a strict “default to flagging” posture and can block on subjective motion feel. That verdict policy is unsuitable for the advisory pilot.
- OpenRouter's motion scale explicitly includes 350–500ms roles. A generic sub-300ms rule cannot be imported as a universal limit.
- Emil's local `design-rules.md` recommends a 65ch reading width; OpenRouter explicitly gives long-form content the page's container width. Its hover-weight advice also needs reconciliation with the other local guidance.

An unresolved source conflict produces a policy question for the rule owners, not a violation on a feature PR. Accessibility criteria should cite the applicable standard and its exceptions; a stylistic preference or a generic tap-target recommendation must not be presented as a measured standards failure.

### Additional sources and adoption decisions

The second research note supplied by design was checked against upstream sources on 2026-09-22. Repository revisions observed during that check were `jakubkrehel/skills@267330e1adfc66a718fb65fa6918c1f06d0a689e` and `pbakaus/impeccable@83c2c735777c68e30ea536ab9cc97f7843456945`. This is a documentation/source evaluation; the detector has not been executed against OpenRouter.

| Source | Decision | Adaptation needed |
| --- | --- | --- |
| Jakub's [`interface-review`](https://github.com/jakubkrehel/skills/blob/267330e1adfc66a718fb65fa6918c1f06d0a689e/skills/interface-review/SKILL.md) | Adopt its review method: explicit base/head, removed-line inspection, bounded consumer expansion, change attribution, and stated coverage. | Use Perry's PR checkout and our output contract. Its local branch-plus-uncommitted mode belongs in an engineer's local invocation, never a remote PR review. Retain relevant asset, snapshot, and dependency changes in triage rather than inheriting its blanket exclusions. |
| Jakub's [`better-interface`](https://github.com/jakubkrehel/skills/blob/267330e1adfc66a718fb65fa6918c1f06d0a689e/skills/better-interface/SKILL.md) | Borrow evidence requirements, root-cause consolidation, and coverage reporting. | The entry point depends on six domain skills. Import selected reference material with its dependencies resolved; do not copy the entry point alone. Replace all-domain execution, its 15-finding cap, and automatic Block/Approve verdicts with our conditional advisory contract. |
| Jakub's [`better-accessibility`](https://github.com/jakubkrehel/skills/blob/267330e1adfc66a718fb65fa6918c1f06d0a689e/skills/better-accessibility/SKILL.md) and [`better-colors`](https://github.com/jakubkrehel/skills/blob/267330e1adfc66a718fb65fa6918c1f06d0a689e/skills/better-colors/SKILL.md) | Use as candidate references for keyboard/focus, forms, announcements, forced colors, zoom/reflow, and measured contrast. | Reconcile each recommendation with the applicable standard and product behavior. Do not import palette generation, token renaming, or form-submit policy wholesale. |
| Jakub's [`break`](https://github.com/jakubkrehel/skills/blob/267330e1adfc66a718fb65fa6918c1f06d0a689e/skills/break/SKILL.md) | Adapt its reachable worst-case scenarios into reusable Storybook or test fixtures. | Import the real component with production themes and fonts. Prefer persistent fixtures over generating a scratch route on each PR. Narrow containers test composition; they do not replace viewport-breakpoint tests. |
| Impeccable [`detector`](https://impeccable.style/docs/detector) | Trial as an optional source of deterministic diagnostics, especially where current lint has no equivalent. | Measure incremental value and runtime. Inspect JSON, apply an explicit rule allowlist, and map upstream rule IDs to our criterion IDs. Upstream primary/advisory classifications do not decide OpenRouter severity or merge policy. |
| Impeccable [`audit`](https://github.com/pbakaus/impeccable/blob/83c2c735777c68e30ea536ab9cc97f7843456945/skill/reference/audit.md) and broader critique | Use selected evidence-based checks for deeper, requested reviews. | Keep whole-surface scoring and subjective design critique outside the fast PR pass. A combined score cannot establish accessibility or conceal an untested domain. |
| Rams [skill](https://www.rams.ai/rams.md), [Action](https://www.rams.ai/action), and [GitHub integration](https://www.rams.ai/github) | Adopt the workflow concepts: versioned criteria, structured actionable findings, explicit next-push verification, and a separate merge policy. | The free skill is a short stateless checklist; the hosted engine supplies the broader product loop. Evaluate hosted review only if it adds value over Perry plus our tools. Keep OpenRouter's standards and severity decisions authoritative. |
| Sandbox `bauhaus-audit` and design-review agent | Inspected in `OpenRouterTeam/openrouter-design-sandbox` at `38e9b12034d2cca53effafd9b48d28f7de925837`; exact links and adaptations are in the [production evidence inventory](../../.agents/skills/frontend-review/calibration/history.md#sandbox-sources-now-located). | Reuse the four-layer cause analysis and clarity/evidence distinctions selectively. Discard stale branch/path/numeric assumptions and reconcile token-role policy with current production guidance. |

Jakub's repository declares MIT licensing; Impeccable declares Apache-2.0. Preserve the required notices when adapting substantive material. Keep source revisions explicit so upstream changes become deliberate policy updates.

Classify every criterion's authority as `accessibility standard`, `OpenRouter product standard`, or `heuristic`. For example, [WCAG 2.2 AA SC 2.5.8](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html) specifies 24×24 CSS-pixel targets with spacing and other exceptions. A preferred 40px or 44px target is a separate product or ergonomic rule; a 40px control is not automatically an AA failure. Conversely, an approved token that produces a measured contrast failure still warrants a finding against the responsible token/component. Product policy cannot exempt a verified accessibility failure.

### Rams: useful workflow, limited reusable engine visibility

Inspected the public skill, installer text, product pages, and methodology on 2026-09-22. The installer retrieves a Markdown file; it does not install a local review engine. The [MCP documentation](https://www.rams.ai/mcp) describes sending supplied files to a hosted service. The Action uses `master`, not `main`; its [implementation](https://github.com/rams-design/rams-action/blob/efc2a52e24a3c00267a864891697cd8cc2837459/index.mjs) and [action definition](https://github.com/rams-design/rams-action/blob/efc2a52e24a3c00267a864891697cd8cc2837459/action.yml) were inspected at revision `efc2a52e24a3c00267a864891697cd8cc2837459` after correcting the initial branch lookup.

The wrapper selects at most 20 UI files, sends their current contents to the hosted `review_files` tool, writes the returned structured content and optional patches, and gates on critical count or score. Its `since-last-run` state is a commit cursor; the wrapper does not persist finding identities or send prior findings and before/after contents for fix verification. The extension filter omits plain TypeScript helpers and deleted files, and the file cap can leave part of a PR unreviewed. These are useful integration examples, not a complete implementation of our coverage and finding-lifecycle contract. Hosted behavior and runtime accuracy still need a trial.

The [methodology page](https://www.rams.ai/rules) publishes categories and changes but explicitly says the rule text stays in the engine. Treat the advertised rule count, consistency, and re-review accuracy as vendor claims pending a trial. Versioned instructions make the policy repeatable; they do not make every model judgment deterministic.

There are documentation conflicts worth resolving if we trial the service: the skill page says no score while the downloadable skill asks for an undefined `XX/100` score; the methodology says it does not render while its changelog describes rendered verification; the GitHub FAQ says reviews do not block while the Action and Team pages describe blocking. Confirm the behavior of the exact product/plan instead of assuming these are interchangeable.

The free checklist overlaps existing lint and our other references. Some heuristics need qualification: a native button already supports keyboard activation without a custom `onKeyDown`; the skill's 44px target check cites WCAG 2.5.5, which is the enhanced AAA criterion, not the AA baseline. The homepage's illustrative hex-to-`text-emerald-500` fix also conflicts with our semantic-token policy. These are reasons to calibrate individual checks rather than import a generic score or verdict.

Rams is most useful here as a reference for the review lifecycle below. Its hosted service can be an optional comparison on the same three trial PRs if access is available; that comparison should establish custom-policy support, version control, structured output, fix-verification accuracy, and added latency before a purchase or integration decision.

### Impeccable evaluation contract

Run a small tool-selection trial before the broader review pilot. Pin the released CLI and engine artifacts corresponding to the evaluated source; the inspected repository declares CLI version `4.1.0`, but publication and runtime behavior still need verification. Keep source scanning and browser scanning as separately timed stages.

1. Select three representative historical PRs: a shared token/component change, a form/dialog change, and a motion-heavy change. Include accepted exceptions and a known or deliberately seeded regression in each case.
1. Compare base and head using existing lint plus the proposed reviewer, then add the detector to the same inputs. Have design and engineering adjudicate findings without seeing which tool produced them first.
1. Record unique confirmed findings, duplicates, false positives, missed known regressions, coverage, setup cost, and cold/warm duration. Three PRs establish feasibility; the larger replay set below establishes calibration.
1. Validate the JSON contract with cases for primary findings, advisory-only findings, no findings, and partial scan failure. The documented exits are `0` for no primary findings, `2` for primary findings, and `1` when at least one target could not be scanned. Exit `0` is not equivalent to zero observations; exit `1` is incomplete coverage even if other targets returned useful findings.
1. If structured design metadata is needed, follow the documented [preserve-DESIGN.md refresh](https://impeccable.style/docs/design-system) approach. Treat `.impeccable/design.json` as a derived artifact, validate it against canonical tokens in both themes, and make stale metadata visible. Review must not rewrite `DESIGN.md` or infer new policy from legacy styles.
1. Adopt only the checks that add reliable coverage within the runtime budget. Use native oxlint for checks it already expresses, and keep the external detector only where its coverage justifies the extra tool. Broad taste-based detections such as preferred fonts or eyebrow-label patterns remain outside enforcement unless design explicitly adopts a criterion.

## Review flow

| Stage | Work | Output |
| --- | --- | --- |
| Cheap scope selection | Inspect the actual PR-base-to-head diff and affected frontend dependencies. | Relevant surfaces, matching signals, and an explicit reason if skipped. |
| Existing lint | Reuse current diagnostics; later add only approved, deterministic checks. | Actionable lint errors under the existing `lint` check. |
| Focused Perry review | Load matched frontend class files and inspect changed code plus the context necessary to verify a finding. | High-confidence, diff-attributable findings with rule citations. |
| Conditional visual evidence | Read existing screenshots, recordings, Storybook examples, and test reports; request targeted missing evidence where needed. | Observations tied to a route/state and tested commit, or `not measured`. |
| Publication | Deduplicate against lint and Perry's other findings, then write a collapsed advisory section in Perry's review body. | Advisory summary with coverage and limitations. |
| Next-push verification | Recheck prior findings explicitly alongside newly relevant criteria. | Finding history with verified fixes, persistent issues, and unverified outcomes tied to the new head. |

### Scope selection

Use the PR's actual base, including native-stack layers, and the merge base with the head SHA. For this workspace the target is `origin/main`. Reuse the base-resolution conventions in [`scripts/lint-git-scope.ts`](../../scripts/lint-git-scope.ts); the reviewer additionally needs deleted paths and both sides of renames. Parse NUL-delimited Git output rather than splitting paths on whitespace.

The pilot should cover `projects/web`, `projects/mission-control`, `packages/frontend`, `packages/frontend-utils`, and `packages/theme`, including rendered copy, assets, fonts, styles, and UI configuration. Classify within those roots: a server-only edit does not automatically need every design class. Test, story, and snapshot changes supply evidence; test-only changes should not launch a general visual critique.

Handle these additional cases explicitly:

- Shared TypeScript helpers or dependencies can affect rendered UI without changing TSX. Reuse `pacwich affected` as a dependency signal, then narrow by the changed symbols and their frontend consumers. A broad affected-workspace result is a triage signal, not proof of a visual regression.
- Worker API data-shape changes may affect pages without a workspace import edge. Include a narrow signal for changed frontend-facing response contracts and trace consumers; use a manual force-review option for impacts the classifier cannot establish. This is a known coverage limitation until those mappings are reliable.
- Root dependency/configuration changes can affect rendering. Review relevant dependency changes rather than treating every lockfile edit as a frontend change.
- Public UI also exists in the docs and Astro blog. Record these as outside the proposed first pilot unless the team expands it; a global `.tsx/.css/.mdx` test would both miss `.astro` and pull in unrelated artifacts.
- Rule/document-only changes run policy validation and calibration checks, rather than a product-UI review.
- If diff or dependency classification fails, record `incomplete` and perform bounded conservative triage. An error must not appear as a clean skip.

Return the matched signal and relevant file paths with each decision so false skips can be investigated. A confirmed backend-only PR should incur the cheap classification step and launch zero frontend agents or browser sessions.

Read both sides of the diff. Explicitly inspect removed accessible names, focus handling, reduced-motion support, state feedback, and responsive alternatives; confirm that an equivalent replacement does not appear elsewhere in the change before reporting a regression. Bound consumer expansion to direct consumers by default, allowing a second hop for shared tokens/primitives. Start with at most five risk-ranked consumers, state the selection reason and number omitted, and report sampled coverage rather than implying a full sweep. Expand separately when the initial evidence indicates wider impact.

### Three kinds of criteria

| Kind | Appropriate examples to evaluate | Proof required |
| --- | --- | --- |
| Mechanical | A prohibited import or utility; a static JSX accessibility invariant. | An AST/native rule where available, valid and invalid fixtures, and deliberate exception handling. CSS/MDX need a suitable parser; the current oxlint runner does not target those extensions. |
| Contextual | Whether an existing primitive covers the need; whether error/empty/loading states tell the truth; whether a mobile-only control preserves the desktop action. | Relevant implementation and consumer context, a cited invariant, and an explanation of the user's consequence. |
| Visual or interaction | Clipping, hierarchy, actual focus behavior, contrast on a composed surface, or motion interruption. | Rendered evidence or a reproducible interaction. Source alone can identify risk but cannot establish a measured visual failure. |

These are candidate categories, not the final checklist. Start with three to five concrete criteria selected from repeated design incidents. Match classes through literal signals such as a changed token, control, state branch, breakpoint, or motion API. Load motion material only when the diff changes motion.

### Finding contract

Each finding carries a stable criterion ID, changed file/line or affected surface, source citation and authority type, observed behavior, user consequence, confidence, and smallest useful remedy. A visual finding additionally names the commit, route or story, state, viewport, theme, and evidence location.

Record attribution separately from severity: `Introduced`, `Regression`, or `Pre-existing`. Establish it against the base and the changed dependency path. An untouched consumer can regress because a shared token, primitive, or data contract changed; unchanged line numbers alone do not make it pre-existing. Attribute that finding to the changed cause and cite the consumer as impact evidence. Pre-existing debt stays outside this change's advisory findings and verdict.

Use distinct result labels:

- `FINDING`: a supported violation attributable to this change.
- `EVIDENCE GAP`: the check needs rendering or interaction evidence that is unavailable.
- `POLICY QUESTION`: sources conflict or an intentional new pattern needs a decision.

The run itself reports `complete`, `partial`, `skipped`, or `failed`, and lists what was actually checked. “No findings” never means “design approved.” Confidence and impact are separate: an AST match can be certain and still low impact.

Group repeated instances by root cause. Propose a maximum of three actionable findings in the summary, with additional confirmed findings in a linked or collapsed report; disclose truncation. Existing unrelated debt stays in `design-scan` or a follow-up issue. Inspect shared callers where needed to prove the new impact, without turning every PR into a whole-repository cleanup.

## From feedback to a review lifecycle

Rams highlights a gap that a checklist alone cannot close: automatic coverage and verified follow-through. After historical calibration establishes that the criteria are useful, add a thin integration around Perry and existing CI, with the following primitives. The initial replay only needs saved run reports. Reuse Perry's existing persistence and GitHub publishing facilities where available; inspect them before choosing storage or adding a service.

| Primitive | Minimum contract |
| --- | --- |
| Versioned policy | Stable criterion IDs, applicability, authority, exceptions, verification method, and enforcement mode. Record the policy revision and reviewer/model version on each run; policy updates invalidate affected results. |
| Run record | Repository/PR, target base ref and resolved tip SHA, diff merge-base SHA, head SHA, policy revision, selected criteria and surfaces, omitted coverage, per-criterion completion, evidence references, and timing. A skip includes its reason. |
| Finding identity | A persistent ID based on criterion and semantic subject/root cause, with current source anchors. A line number is a location, not identity; moving code must not manufacture a new finding or imply a fix. |
| Finding state | `open`, `verified fixed`, `accepted exception`, or `unverified`. Keep first-seen and last-checked SHAs, proof, and exception attribution. Reopen a verified finding when the defect returns. |
| Evidence record | A test result, measured observation, or contextual proof that names the criterion, inputs, and tested SHA. A proposed patch is a remedy, not evidence that the fix works. |
| Policy evaluator | A deterministic decision over criterion modes, findings, exceptions, coverage, and freshness. Perry supplies evidence; the evaluator decides whether the configured requirement is met. |

The smallest implementation can use one machine-readable run/finding artifact, the existing review storage, and an updated PR summary. Preserve the previous record long enough to support reruns; if CI artifacts are the storage, define retention and handle expiry as missing history. A dashboard, global score, new database, and separate reviewer fleet are unnecessary for the first pilot.

### Recheck on every relevant push

1. Receive PR open, ready-for-review, reopen, synchronize, and base-retargeting events automatically; arrange reevaluation when the target base advances. Define draft behavior explicitly. The local skill is an early-feedback path; universal PR coverage cannot depend on someone remembering to ask Perry.
1. Classify the current base-to-head diff, plus changes since the last reviewed head. Select newly relevant checks and explicitly revisit every prior open finding, even if its file was untouched in the latest push. Reuse previous evidence only when all relevant inputs still match.
1. Verify each proposed fix using its criterion's proof. A mechanical issue reruns its rule; a visual or interaction issue needs current rendered or behavioral evidence; a contextual issue needs an explicit re-evaluation of the original failure mode. A finding disappearing from a fresh model response is not proof of a fix.
1. If code was removed or renamed, verify removal of the affected behavior or follow it to the replacement. If verification times out, mark it `unverified`; preserve the last known finding. Resolving a GitHub thread or applying a suggestion alone does not change verification state.
1. Before publishing, re-resolve the PR target base ref and tip SHA, merge-base SHA, head SHA, and policy revision. Publish only if the entire tuple still matches the run. Retargeting or a changed base invalidates the current decision even if the head is unchanged; reclassify the new diff and explicitly establish any reusable evidence. Retain late/stale runs as history without overwriting the current summary or check. Include new, persistent, verified-fixed, exception, and unverified counts; avoid reposting unchanged comments.

Repair suggestions should name the existing primitive/token or include a small patch when the remedy is unambiguous. Engineers or their implementation agents apply fixes through the normal test-and-push workflow. The reviewer should not enter an automatic unbounded edit/review loop.

### Merge policy without a design score

Start with two explicit modes: `advisory` and `enforced`. Every new contextual or visual criterion starts advisory. Proven mechanical criteria can become enforced through the existing required lint job. If any contextual/visual criterion later earns enforcement, it needs an explicit verification procedure and a separately approved policy change; an LLM's severity label alone cannot opt it into blocking.

For enforced criteria, the requirement is satisfied only when the current head has completed the applicable checks and has no unresolved enforced finding, unless a valid scoped exception covers it. `pending`, `failed`, `partial`, stale evidence, or an unverifiable fix cannot produce a passing enforced result. Advisory failures remain visible and do not delay normal Perry approval. A fully classified out-of-scope PR gets an explicit not-applicable result, so a required check never hangs because a workflow was path-filtered away.

If enforcement grows beyond existing lint, expose one GitHub check on the exact tested commit and configure it as required only after calibration. Integrate with the repository's merge queue and base updates; test both PR-head and merge-group execution before activation. Keep that policy decision separate from the summary comment, because comments are feedback and GitHub thread resolution can otherwise introduce accidental gates.

Test the lifecycle using successive pushes that fix one issue, leave another open, introduce a new one, move the offending code, and revert a verified fix. Include duplicate events, a stale run completing late, a policy update, expired evidence, an accepted exception, a timeout, base advancement, and PR retargeting with an unchanged head. The expected finding states and check conclusions should be asserted independently of the reviewer prose.

The claim we can support is: every eligible PR was evaluated against the applicable adopted criteria, with current evidence for every enforced check. This does not establish that every aspect of the interface meets every design standard. Coverage and exception reporting keep that boundary visible.

## Keep review fast

Proposed pilot budgets, to be measured before adoption:

| Work | Initial target |
| --- | --- |
| Diff/path gate after checkout | Under 1 second for ordinary diffs; record dependency-expansion time separately. |
| Added deterministic lint | p95 incremental runtime under 10 seconds. Reuse the existing lint invocation and report its actual delta. |
| Perry frontend pass | p95 under 90 seconds, with a 120-second execution cutoff. Report queue time separately. |
| Agent concurrency | One frontend reviewer per PR during the pilot, running beside existing review work, with a repository-wide cap chosen by Perry's maintainer. |
| Added browser work | Zero by default in the fast pass; evidence capture runs separately when selected. |

Parallel execution still consumes capacity and can contend with normal review. Perry must publish its normal verdict without waiting for the advisory task, including on timeout. A late frontend result updates the summary without reopening a completed review. An existing correctness or security defect retains its normal severity; design classification must not downgrade it.

Cache completed results by target base ref and resolved tip SHA, merge-base SHA, head SHA, policy revision, and reviewer version. Cancel superseded runs. On a new head, base advancement, or retargeting, recompute scope; reuse only results whose inputs still match or have explicitly established equivalence. Visual evidence must identify the tested head or have an explicit equivalence check. The implementation should not install skills, research the web, or start a full dev stack during every review.

## Visual evidence strategy

Keep existing frontend verification requirements. This pilot should consume their results rather than duplicate builds.

- Start with the current production-build VR/smoke reports and screenshots attached to the PR. Storybook is useful for a changed primitive; it does not prove its page-level composition.
- Prioritize shared tokens/primitives, navigation/layout, new surfaces, responsive branches, overlays, and motion for additional evidence. A route without an existing snapshot still needs a way to expose its visual changes.
- Capture the affected states at phone and desktop widths, with light/dark and reduced-motion variants when relevant. Check interactions with keyboard/DOM tests or recordings; a screenshot cannot prove focus trapping or interruption.
- Adapt `break` scenarios for real reachable inputs: long or translated labels, unbreakable strings, empty data, pending/error/disabled states, and narrow containers. Select applicable axes per component rather than running their full Cartesian product.
- For the selected accessibility classes, verify accessible names/roles, focus entry/trapping/restoration, validation announcements, forced-colors behavior, and zoom/reflow as applicable. Use an automated browser audit such as axe as supporting evidence after checking existing tooling; keyboard, screen-reader announcements, and touch behavior need their own verification. Record the browser, input method, and assistive technology actually exercised. Automated scans and viewport emulation do not prove those interactions.
- Record unavailable environments, missing stories, and absent route coverage as evidence gaps. Mission Control needs a separate capture path during the pilot.
- Compare known baseline and head under the same capture conditions. A changed screenshot shows a difference, not whether the design is good. Preserve intentional-change review instead of automatically accepting new baselines.

Automating stable preview capture is a later infrastructure task. It should account for the currently documented preview banner and platform-specific baselines before becoming a merge requirement.

## How the design team contributes

Designers can submit a failing example and an accepted alternative through an ordinary PR. A Markdown template should ask for the following; engineering can help translate examples into signals and fixtures.

| Field | What to supply |
| --- | --- |
| Identity and ownership | Stable criterion ID, title, design owner, engineering owner, and lifecycle stage (`draft`, `pilot`, or `enforced`). |
| Scope and trigger | Product surfaces, concrete diff signals, and exclusion cases. |
| Rule | One sentence stating what must hold, its canonical citation, and whether its authority is an accessibility standard, an OpenRouter product standard, or a heuristic. |
| Failure modes | Each wrong shape with its user consequence and accepted remedy (the existing primitive or token, with an example). Two independent real incidents per failure mode before automatic review. |
| Not a finding | Near misses, intentional exceptions, and legitimate legacy contexts that must not be flagged. |
| Evidence a static review cannot collect | The rendered or interaction proof that would confirm a finding, and the question to ask the author when it is missing. |
| Calibration | Expected findings on replay cases, known limitations, and the decision on whether it may block. |

Draft repository layout:

```text
.agents/skills/frontend-review/
  SKILL.md                # scope, signal lookup, execution and output contract
  sources.md              # source provenance and precedence decisions
  classes/_template.md    # design-team contribution form
  classes/<criterion>.md  # one independently calibrated invariant per file
  calibration/            # small good/bad/exception review cases
scripts/oxlint/            # mechanical criteria that earn enforcement
```

Keep one canonical copy of frontend criteria in `openrouter-web`. Perry's repo should contain the dispatch and publication integration, resolving those files at a recorded policy revision rather than maintaining another class library. Review policy edits under the previously accepted policy; test proposed policy in calibration before activating it.

### Loading during implementation and review

Layer 1 needs no loading step: coding agents already run lint, and each diagnostic names the replacement. Layer 2 criteria stay out of `AGENTS.md` while they are draft, so ordinary frontend sessions do not load a manual-only skill. Once a criterion is approved for routine use, add a pointer to the signal-to-criterion index in `packages/frontend/AGENTS.md` in the same policy PR. Draft criteria must never acquire automatic enforcement merely because their files exist.

Perry reads the same canonical files at a recorded policy revision after integration. Local and PR reports list what was actually checked; browser-dependent criteria retain an evidence gap until exercised. The draft files include synthetic examples, not claims about historical incidents or completed tests.

Only policy/rule changes need the nominated design and engineering owners. Do not add a design-owner requirement across all frontend paths. Specific approved exceptions should name the criterion, scope, reason, and owner; temporary ones also need an expiry. A generic suppression comment must not exempt an entire PR.

The existing scanner can remain the scheduled legacy-debt audit and share canonical policy citations. Its automatic Slack posting and broad cleanup workflow do not belong in the per-PR skill.

## Rollout and acceptance

| Step | Deliverable | Owner | Exit condition |
| --- | --- | --- | --- |
| 1. Reconcile sources | Audit current lint coverage (done for color/type/z-index); correct stale scanner guidance (done); inventory local/sandbox sources and licensing/provenance; resolve conflicts for candidate criteria. | Design lead + frontend engineer | Each draft criterion has a current source and an explicit exception set. |
| 2. Draft and replay | Manual-only index, six narrow criteria, and synthetic good/bad/exception cases; then replay roughly 20–30 historical PRs. Run the optional three-PR detector comparison on a subset. | Design + frontend/tooling engineer | Per-criterion results establish usefulness, lint overlap, missing evidence paths, and cost before persistent tracking is built. |
| 3. Wire calibrated criteria into Perry | Tested classifier and separate integration PR in `OpenRouterInterns/perry`; automatic conditional dispatch, persisted findings, next-push verification, cancellation, deduplication, and one advisory section in the review body. | Perry maintainer | Scope fixtures include indirect changes and classification failures; successive-push/base-retarget tests prove finding-state transitions and fresh publication. Ordinary approval finishes before a delayed/failed advisory pass. |
| 4. Live shadow | Review a sample of live runs privately, checking eligible/skipped PRs and publication behavior. | Design + engineering owners | Inspect flagged and unflagged PRs, missed defects, and actual runtime/cost before public comments. |
| 5. Advisory pilot | Publish summaries on eligible PRs for about two weeks, extending the window if the sample is too small. | Same owners | Results are useful, false positives are understood, and merge latency has not regressed. |
| 6. Selective enforcement | Promote individual deterministic checks into existing lint after fixtures and baseline handling. Add a separate required check only if adopted enforcement needs it. | Rule owner | Explicit per-rule decision backed by replay and pilot evidence, with current-head and merge-queue behavior verified. Contextual/visual criteria remain advisory unless separately approved. |

Separate policy, lint tooling, and Perry integration into independently reviewable PRs. Stack dependent changes bottom-up where required by repository policy; cross-repo dependencies should be linked explicitly.

Report metrics per criterion and policy revision, with aggregate runtime/cost as a secondary view:

- Applicability: adjudicated applicable cases, selected cases, false selections, and missed selections. Sample skipped/unflagged PRs so missed applicability is visible.
- Completion: completed applicable checks divided by selected applicable checks, plus counts of evidence gaps, failed runs, and omitted surfaces. A selected check without required browser evidence is not completed.
- Precision: owner-confirmed findings divided by adjudicated findings, showing the numerator and denominator. No adjudicated findings means unknown precision.
- Missed regressions: confirmed defects missed divided by known defects in the adjudicated/replay set, including defects missed by scope selection. Separate unavailable evidence from completed checks that missed a defect.
- Duration and cost: per-criterion review time and evidence-collection time, plus shared overhead, total PR cost, and added time to ordinary approval/merge.

Proposed advisory-launch bar per criterion: at least 90% actionable precision on a representative adjudicated sample, successful detection of all its agreed replay regressions, and a dependable evidence path within the runtime budget. Sparse evidence is a reason to keep measuring, not to claim a percentage establishes reliability. A strong aggregate result cannot promote an uncalibrated criterion; disable or defer it independently.

For enforcement, require every valid/invalid/exception fixture to pass and no known unresolved false positive in the candidate rule's replay set. Because lint checks whole changed files, either migrate existing violations first or use reviewed, non-growing baselines. Do not surprise the next engineer with an unrelated cleanup requirement. A pilot rule can stay disabled in main lint while a separate advisory invocation gathers diagnostics; adding a warning to the existing lint config is not a reliable pilot mechanism here.

The pilot must have an off switch for frontend dispatch/publication that leaves normal Perry review operating. If a class becomes noisy, disable that class and retain its cases for recalibration. Check real merge behavior rather than assuming “advisory” is sufficient.

## Decisions needed next

1. Allen and design confirm layer 1's scope, especially whether numeric `z-10`/`z-0` local stacking is allowed (158 and 15 uses today) and which reflexes to add next.
1. Name an owner for the uncolored Mission Control ban-candidate timing markers.
1. Confirm Allen's proposed pilot policy/calibration role, and name the frontend/tooling engineer and Perry integration maintainer. Robert Sun is the natural pipeline partner, given the sweep and his lint performance work.
1. Name Perry's maintainer for the frontend pass, and ask a repository admin to require design-team approval on the rule paths.
1. Agree with engineering whether to evaluate `@shadcn/lint`'s `no-restyle`, and who writes its contracts (proposed: design, with Allen).
1. From Carlos's review: pick the marketing page shell and content-width scale, decide whether design is requested or required on `packages/frontend/components/ui/`, and which shadows and opacity values are allowed where.
1. Accept Perry's offer to ship build-order step 1 (behaviour-neutral `base_sha` column and `GateContext` fields) and step 2 (the scoped setting, default `off`).
1. Supply representative incidents for FR-002, FR-004, and FR-005, plus accepted look-alikes; choose the three historical PRs for the Impeccable comparison.
1. Confirm summary-only advisory publication and the proposed runtime/finding budgets.

The next step for layer 2 is collecting real incidents: every failure mode is a candidate until it has two. Then replay them, and #28574, through Perry's blind mode and record per-criterion results before any live run.
