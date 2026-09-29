# Radix → semantic token map

A migration cheat-sheet for replacing every Radix color utility in the
codebase with a **brand color or semantic token**. This is _not_ the
legacy shadow mapping in `theme.css` (which redefines `--slate-*`,
`--green-*`, etc. so old class names silently inherit rebrand values). The goal
here is to migrate _away_ from Radix class names toward the semantic tokens
in `DESIGN.md`, so the accent-swap (Grape↔Volt) and surface hierarchy work
as intended.

Every Radix family/step listed below was found in use (non-story source) at
the time of writing. Counts are usage frequency.

## How to read the Radix 12-step scale

Radix assigns a fixed role to each step. The rebrand target depends on the role,
not just the hue:

| Step | Radix role | Neutral rebrand target | Color rebrand target (status/brand) |
|------|------------|-------------------|-------------------------------|
| 1 | App background | `bg-background` | color `/08` (`-bg` token) |
| 2 | Subtle background | `bg-muted` | color `/08` (`-bg` token) |
| 3 | UI element bg | `bg-[var(--card-hover)]` | color `/08` (`-bg` token) |
| 4 | Hovered element bg | `bg-[var(--card-hover)]` | color `/14` |
| 5 | Active/selected bg | `bg-[var(--selected-bg)]` | color `/14` |
| 6 | Subtle border | `border-border` | color `/14` |
| 7 | Element border / ring | `border-foreground/20` | color `/20` (accent-border) |
| 8 | Hovered border | `border-foreground/30` | color `/30` (status border) |
| 9 | Solid bg | `bg-foreground` | solid color |
| 10 | Hovered solid bg | `bg-foreground` (or `/e0`) | solid color (`/e0` hover) |
| 11 | Low-contrast text | `text-muted-foreground` | solid color |
| 12 | High-contrast text | `text-foreground` | solid color |

The opacity suffixes (`08 14 20 30 70 a0 e0`) come straight from the
DESIGN.md opacity scale — no custom hex.

Collapse a ramp onto the nearest token by _role_, don't recreate the ramp. If a step falls between two tokens, pick by intent (primary, secondary, or faint text?), not by hex proximity. The short form, generalized to any equivalent step:

| Radix                                         | Rebrand token                                                                  |
| --------------------------------------------- | ------------------------------------------------------------------------------ |
| `slate-12` (primary text)                     | `foreground`                                                                   |
| `slate-11` (secondary text)                   | `muted-foreground` (light `b0` / dark `a0`)                                    |
| `slate-9 / -10` (faint text, icons)           | `text-faint` (`70`)                                                            |
| `slate-3 / -4 / -5` (subtle fill)             | `muted` (`08`)                                                                 |
| `slate-6 / -7` (border)                       | `border` (`14`)                                                                |
| `green-9..11`                                 | `positive`                                                                     |
| `red-9..12`                                   | `negative`                                                                     |
| `amber-9..11` / `yellow-9`                    | `warning`                                                                      |
| `blue` / `violet-11` (info _status_ text)     | `info` (Royal)                                                                 |
| `link` / `link-hover` (and any colored link)  | the Links pattern — neutral at rest + hover promotion, **not** Royal           |
| `*-9` color _fills_ in charts                 | the `chart-*` palette                                                          |

Off-palette families sometimes used raw (`teal`, `lime`, `sky`, `indigo`) have **no** rebrand equivalent and resolve to the nearest brand/status/chart token, never carried over literally. A host's `success/-foreground` pairs map to `positive` + the tint treatment (`success → positive`, `error/danger → negative`, `info → info`); there are deliberately no `positive-foreground`-style tokens because statuses are never opaque fills (see DESIGN.md → Status & health).

## Group A — Neutrals → surface / text tokens

`slate` and `gray` are the same neutral in the rebrand (both derive from Ink in
light, Cloud in dark). Map by step role.

| Radix util (steps used) | Semantic token | Tailwind form |
|-------------------------|----------|---------------|
| `*-slate-1` / `*-gray-1` | background | `bg-background` |
| `*-slate-2` / `*-gray-2` | muted | `bg-muted` |
| `*-slate-3` / `*-gray-3` | card-hover | `bg-[var(--card-hover)]` |
| `*-slate-4` / `*-gray-4` | card-hover → selected | `bg-[var(--card-hover)]` |
| `*-slate-5` / `*-gray-5` | selected-bg | `bg-[var(--selected-bg)]` |
| `*-slate-6` / `*-gray-6` | border | `border-border` |
| `*-slate-7` / `*-gray-7` | strong border | `border-foreground/20` |
| `*-slate-8` / `*-gray-8` | placeholder border | `border-foreground/30` |
| `*-slate-9` / `*-gray-9` | text-faint | `text-[var(--text-faint)]` |
| `*-slate-10` / `*-gray-10` | text-faint / dim | `text-[var(--text-faint)]` |
| `*-slate-11` / `*-gray-11` | muted-foreground | `text-muted-foreground` |
| `*-slate-12` / `*-gray-12` | foreground | `text-foreground` |
| `*-gray-a4` (1 use) | translucent border | `border-foreground/10` |

`sand` (neutral-warm, used only in a swatch demo) → treat as `gray`.

## Group B — Accent (Grape light / Volt dark)

`violet` and `purple` were used as the brand accent. **These must become
accent tokens so they swap to Volt in dark** — do not leave them as a fixed
hue. Exception: if the usage is a _fixed data series_ that must stay Grape
in both themes, use `chart-1` (still accent, also swaps) or Royal.

| Radix util (steps used) | Semantic token | Tailwind form |
|-------------------------|----------|---------------|
| `bg-violet-3` / `bg-purple-3` | accent-subtle | `bg-[var(--accent-subtle)]` |
| `bg-violet-4..5` / `bg-purple-4..5` | accent (tint) | `bg-accent` |
| `border-violet-6..7` / `border-purple-6..7` | accent-border | `border-[var(--accent-border)]` |
| `border-violet-8` / `border-purple-8` | accent-border | `border-[var(--accent-border)]` |
| `bg-violet-9..10` / `bg-purple-9..10` | primary | `bg-primary` |
| `text-violet-9..10` / `text-purple-10` | accent-foreground | `text-accent-foreground` |
| `text-violet-11` / `text-purple-11` | accent-foreground | `text-accent-foreground` |
| `*-violet-12` / `*-purple-12` | accent-foreground | `text-accent-foreground` |
| `*-violet-1..2` / `*-purple-1..2` | accent-subtle | `bg-[var(--accent-subtle)]` |

`iris`/`indigo` lean blue-violet — see Group F (treat as Royal/info), since
DESIGN.md reserves the accent for interaction, not static indigo data.

## Group C — Positive / success → `--positive`

`green` (and `grass`, `jade`, `mint`, `teal` when used for "success"). In
dark, `--positive` is the brighter `#34DFAA` automatically.

| Radix util (steps used) | Semantic token | Tailwind form |
|-------------------------|----------|---------------|
| `bg-green-1..2` | positive-bg | `bg-[var(--positive-bg)]` |
| `bg-green-3` | positive-bg | `bg-[var(--positive-bg)]` |
| `bg-green-4..5` | positive `/14` | `bg-[var(--positive)]/[0.14]` |
| `border-green-6` | positive `/14` | `border-[var(--positive)]/[0.14]` |
| `border-green-7` | positive `/20` | `border-[var(--positive)]/[0.2]` |
| `border-green-8..9` | positive `/30` | `border-[var(--positive)]/[0.3]` |
| `bg-green-9..10` | positive (solid) | `bg-[var(--positive)]` |
| `text-green-9..12` | positive | `text-[var(--positive)]` |

Status badge bg uses the direct color at `/12` per DESIGN.md
(`bg-[var(--positive)]/[0.12]`), banner bg uses the `-bg` token.

## Group D — Negative / destructive → `--negative`

`red`, `ruby`, `tomato`, `crimson` → all the single negative color
(`#FF2D55`, constant across themes). Use `destructive` for buttons,
`negative` for status text/badges (they share the hex).

| Radix util (steps used) | Semantic token | Tailwind form |
|-------------------------|----------|---------------|
| `bg-red-1..3` / `bg-ruby-2..3` | negative-bg | `bg-[var(--negative-bg)]` |
| `bg-red-4..5` / `bg-ruby-4..5` | negative `/14` | `bg-[var(--negative)]/[0.14]` |
| `border-red-6` / `border-ruby-6` | negative `/14` | `border-[var(--negative)]/[0.14]` |
| `border-red-7` / `border-ruby-7` | negative `/20` | `border-[var(--negative)]/[0.2]` |
| `border-red-8..9` / `border-ruby-8` | negative `/30` | `border-[var(--negative)]/[0.3]` |
| `bg-red-9..10` / `bg-ruby-9` | destructive | `bg-destructive` |
| `text-red-9..12` / `text-ruby-10..12` | negative | `text-[var(--negative)]` |
| `bg-red-12` | destructive (solid) | `bg-destructive` |

## Group E — Warning → `--warning`

`amber`, `yellow`, `gold` → single warning color (`#FFAB00`, constant).

| Radix util (steps used) | Semantic token | Tailwind form |
|-------------------------|----------|---------------|
| `bg-amber-1..3` / `bg-yellow-1..3` | warning-bg | `bg-[var(--warning-bg)]` |
| `bg-amber-4..5` / `bg-yellow-4..5` | warning `/14` | `bg-[var(--warning)]/[0.14]` |
| `border-amber-6` / `border-yellow-6` | warning `/14` | `border-[var(--warning)]/[0.14]` |
| `border-amber-7` | warning `/20` | `border-[var(--warning)]/[0.2]` |
| `border-amber-8..9` | warning `/30` | `border-[var(--warning)]/[0.3]` |
| `bg-amber-9..10` / `bg-yellow-9..10` | warning (solid) | `bg-[var(--warning)]` |
| `text-amber-9..12` / `text-yellow-10..12` | warning | `text-[var(--warning)]` |

Note: warning is dark text on a light chip — pair with `text-foreground`
where you need legible labels on a solid warning fill.

## Group F — Info / Royal + blue-violet data → `--info`

`blue`, `indigo`, `iris`, `sky`, `cyan` (when used as "info" / link-ish /
data). Royal is `#035ADE`, constant across themes, and is also `chart-2`.

| Radix util (steps used) | Semantic token | Tailwind form |
|-------------------------|----------|---------------|
| `bg-blue-1..3` / `bg-indigo-2..3` | info-bg | `bg-[var(--info-bg)]` |
| `bg-blue-4..6` / `bg-indigo-4..5` | info `/14` | `bg-[var(--info)]/[0.14]` |
| `border-blue-7..8` / `border-indigo-6..8` | info `/20` | `border-[var(--info)]/[0.2]` |
| `bg-blue-9..10` / `bg-indigo-9..10` | info (solid) | `bg-[var(--info)]` |
| `text-blue-9..12` / `text-indigo-11..12` | info | `text-[var(--info)]` |
| `text-sky-11` / `text-cyan-*` (info use) | info | `text-[var(--info)]` |

If indigo is being used purely as the brand accent (active state, primary
CTA) rather than info, send it to Group B (`bg-primary`) instead.

## Group G — Coral / promotional → `--promo`

`orange` → Coral (`#FF6849`). **Promotional only** ("New" badges, upgrade
CTAs), never primary actions. Also available as `chart-6`.

| Radix util (steps used) | Semantic token | Tailwind form |
|-------------------------|----------|---------------|
| `bg-orange-1..3` | promo-bg | `bg-[var(--promo-bg)]` |
| `bg-orange-4..6` | promo `/14` | `bg-[var(--promo)]/[0.14]` |
| `border-orange-6..8` | promo `/20`–`/30` | `border-[var(--promo)]/[0.2]` |
| `bg-orange-9..10` | promo (solid) | `bg-[var(--promo)]` |
| `text-orange-9..12` | promo | `text-[var(--promo)]` |

## Group H — Data-viz category / modality maps → chart palette

These families appear _only_ in category/modality color maps
(`use-case-category-color.ts`, `modality-colors.ts`, etc.), where the goal
is N visually distinct hues. Collapse them onto the 6-color chart palette,
picking by nearest hue. The chart tokens are hex and are the sanctioned
data-viz set in DESIGN.md.

| Radix family (in maps) | Nearest rebrand chart token | Hex (light) |
|------------------------|------------------------|-------------|
| `purple` / `violet` | `chart-1` (accent / Grape) | `#7624F4` |
| `blue` / `indigo` / `sky` / `cyan` | `chart-2` (Royal) | `#035ADE` |
| `green` / `teal` / `jade` / `mint` | `chart-3` (positive) | `#00BF6F` |
| `yellow` / `amber` / `gold` / `lime` | `chart-4` (warning) | `#FFAB00` |
| `red` / `ruby` / `crimson` / `pink` / `plum` | `chart-5` (negative) | `#FF2D55` |
| `orange` / `tomato` | `chart-6` (Coral) | `#FF6849` |

For a category map needing more than 6 distinct swatches, the palette
repeats — there is no 7th brand hue. If genuinely more are required, vary
lightness via the opacity scale on an existing chart token rather than
introducing a new Radix hue.

Families seen only in swatch/demo grids (`sand`, `plum`, full 1–12 ranges
of `lime`/`teal`/`sky`/`cyan`/`pink`) carry no semantic weight outside the
maps above — they should not survive migration as Radix names.

## Quick lookup — the highest-frequency utilities

The 12 most common in the codebase, with their direct replacements:

| Radix util | Count | Semantic replacement |
|------------|-------|----------------|
| `text-slate-11` | 348 | `text-muted-foreground` |
| `text-green-11` | 221 | `text-[var(--positive)]` |
| `border-slate-6` | 219 | `border-border` |
| `text-red-11` | 176 | `text-[var(--negative)]` |
| `text-slate-12` | 171 | `text-foreground` |
| `bg-green-9` | 139 | `bg-[var(--positive)]` |
| `bg-slate-3` | 124 | `bg-[var(--card-hover)]` |
| `bg-red-9` | 119 | `bg-destructive` |
| `bg-slate-2` | 117 | `bg-muted` |
| `text-amber-11` | 108 | `text-[var(--warning)]` |
| `text-blue-11` | 82 | `text-[var(--info)]` |
| `bg-green-3` | 78 | `bg-[var(--positive-bg)]` |
