---
version: alpha
name: OpenRouter Rebrand
description: >-
  OpenRouter's rebrand design system. A 6-color brand palette where everything
  is derived via opacity, with a theme-dependent accent swap (Grape in light,
  Volt in dark). Token values below are the LIGHT-mode normative set; the dark
  swap is documented in prose under Colors.
colors:
  # ── Brand palette (6 core colors — everything else derived via opacity) ──
  ink: "#03080A"      # Near-black. Dark-mode bg, light-mode text.
  cloud: "#FCFCFE"    # Near-white. Light-mode bg, dark-mode text.
  grape: "#7624F4"    # Accent in LIGHT mode. Primary buttons, active states.
  volt: "#C8FF00"     # Accent in DARK mode. Primary buttons, active states.
  coral: "#FF6849"    # Marketing/brand accent only — DEPRECATED in product UI (too close to status reds).
  royal: "#035ADE"    # Info status + promotional callouts. Never a button or accent. (Not a chart color — charts use the prod palette below.)

  # ── Semantic surfaces (light mode) ──
  background: "#FCFCFE"
  foreground: "#03080A"
  card: "#FFFFFF"
  card-foreground: "#03080A"
  popover: "#FFFFFF"
  popover-foreground: "#03080A"
  surface: "#FFFFFF"          # Nav / sidebar solid surface
  doc-surface: "#FFFFFF"      # Softer reading surface for long-form content
  card-hover: "#03080A05"     # Neutral row/card hover
  selected-bg: "#03080A08"
  input-bg: "#FFFFFF"

  # ── Accent (Grape, light) ──
  primary: "#7624F4"
  primary-foreground: "#FCFCFE"
  secondary: "#7624F414"          # accent-tinted = selected/active state
  secondary-foreground: "#7624F4"
  accent: "#7624F414"
  accent-foreground: "#7624F4"
  accent-subtle: "#7624F408"      # ghost hover bg
  accent-border: "#7624F420"
  accent-hover: "#7624F4e0"       # primary button hover
  ring: "#7624F4"

  # ── Text hierarchy ──
  muted: "#03080A08"
  muted-foreground: "#03080Ab0"
  text-faint: "#03080A70"
  text-prose-body: "#03080A"      # long-form body (matches foreground in light)

  # ── Borders & inputs ──
  border: "#03080A14"
  input: "#03080A14"

  # ── Status ── the status text split: display value (fills/tints/borders/
  # icons-next-to-text, vibrant, SAME hex in both themes — like the chart
  # palette) + -text value (theme-tuned for AA ≥4.5:1 — text & lone signals;
  # darkens in light, brightens in dark).
  positive: "#00BF6F"
  positive-text: "#007544"
  positive-bg: "#00BF6F14"
  negative: "#FF2D55"
  negative-text: "#BF0024"
  negative-bg: "#FF2D5514"
  warning: "#E5A000"
  warning-text: "#8A6000"
  warning-bg: "#E5A00014"
  info: "#035ADE"
  info-text: "#0352C9"
  info-bg: "#035ADE14"
  promo: "#035ADE"          # = Royal; promotional callouts (Coral deprecated in UI)
  promo-text: "#0352C9"
  promo-bg: "#035ADE14"
  destructive: "#E11D48"
  destructive-foreground: "#FCFCFE"

  # ── Chart palette (hex for Recharts SVG fills) ──
  # Categorical set = openrouter-web prod's `defaultColors` (viz/shared.ts),
  # index-assigned to arbitrary series. NOT the brand palette — the accent
  # (Grape/Volt) is never a chart fill. Same hex in both themes.
  chart-1: "#0088FE"   # blue
  chart-2: "#00C49F"   # mint
  chart-3: "#FFBB28"   # yellow-orange
  chart-4: "#FF8042"   # orange
  chart-5: "#FF6347"   # tomato
  chart-6: "#4682B4"   # steel blue
  chart-7: "#9ACD32"   # yellow-green
  chart-8: "#DA70D6"   # orchid
  chart-9: "#40E0D0"   # turquoise
  chart-10: "#FF69B4"  # hot pink
  chart-11: "#DAA520"  # goldenrod
  chart-12: "#7B68EE"  # medium slate blue
  chart-13: "#F08080"  # light coral
  chart-14: "#6B8E23"  # olive drab
  chart-15: "#DB7093"  # pale violet red
  chart-16: "#3CB371"  # medium sea green
  chart-17: "#BDB76B"  # dark khaki
  chart-18: "#800080"  # purple
  chart-19: "#FF4500"  # orange red
  chart-20: "#2E8B57"  # sea green

  # ── Semantic chart roles ── prod's OVERVIEW_CHART_COLORS: a metric keeps
  # its color on every surface. Use when the series IS the metric.
  chart-cost: "#6366F1"              # indigo
  chart-requests: "#22C55E"          # green
  chart-tokens-prompt: "#3B82F6"     # blue
  chart-tokens-completion: "#A855F7" # purple
  chart-tokens-reasoning: "#F43F5E"  # rose
  chart-tokens-cached: "#F59E0B"     # amber
  chart-tokens-uncached: "#94A3B8"   # slate (neutral counterpart to cached)
  chart-credits: "#8B5CF6"           # violet
  chart-byok: "#FBBF24"              # amber-400
  # Ordered session-length steps use theme-specific values for AA-readable
  # labels painted directly on the page background.
  chart-session-length-single:
    light: "#2563EB"
    dark: "#60A5FA"
  chart-session-length-short:
    light: "#0F766E"
    dark: "#2DD4BF"
  chart-session-length-core:
    light: "#B45309"
    dark: "#FBBF24"
  chart-session-length-long:
    light: "#A21CAF"
    dark: "#E879F9"

typography:
  # Two families. Plus Jakarta Sans = the interface font (.rebrand-theme default).
  # Gordita = brand voice, opt-in via .font-brand — in-product only the page
  # title and display-size stat values; marketing display type broadly.
  hero:
    fontFamily: Gordita
    fontSize: 36px
    fontWeight: 700
    lineHeight: "1.2"
    letterSpacing: -0.025em
  display:
    fontFamily: Gordita
    fontSize: 24px
    fontWeight: 700
    lineHeight: "1.2"
    letterSpacing: -0.025em
  title:
    fontFamily: Gordita
    fontSize: 20px
    fontWeight: 600
    lineHeight: "1.2"
    letterSpacing: -0.025em
  heading:
    fontFamily: Plus Jakarta Sans
    fontSize: 16px
    fontWeight: 600
    lineHeight: "1.35"
  section:
    fontFamily: Plus Jakarta Sans
    fontSize: 16px
    fontWeight: 500
    lineHeight: "1.35"
  prose:
    fontFamily: Plus Jakarta Sans
    fontSize: 16px
    fontWeight: 450
    lineHeight: "1.7"
  body:
    fontFamily: Plus Jakarta Sans
    fontSize: 14px
    fontWeight: 450
    lineHeight: "1.625"
  button:
    fontFamily: Plus Jakarta Sans
    fontSize: 14px
    fontWeight: 500
  overline:
    fontFamily: Plus Jakarta Sans
    fontSize: 12px
    fontWeight: 500
    letterSpacing: 0.05em

rounded:
  sm: 4px
  md: 6px
  lg: 8px
  xl: 12px
  full: 9999px

spacing:
  xs: 4px
  sm: 8px
  md: 12px
  lg: 16px
  xl: 24px
  2xl: 32px
  3xl: 48px
  4xl: 64px
  5xl: 80px
  6xl: 96px

components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    rounded: "{rounded.md}"
    typography: "{typography.button}"
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
  button-outline:
    backgroundColor: transparent
    textColor: "{colors.muted-foreground}"
    rounded: "{rounded.md}"
  button-outline-hover:
    backgroundColor: "{colors.muted}"
    textColor: "{colors.accent-foreground}"
  button-ghost-hover:
    backgroundColor: "{colors.accent-subtle}"
  card:
    backgroundColor: "{colors.card}"
    textColor: "{colors.card-foreground}"
    rounded: "{rounded.lg}"
  card-hover:
    backgroundColor: "{colors.card-hover}"
    textColor: "{colors.accent-foreground}"
  input:
    backgroundColor: "{colors.input-bg}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.md}"
  badge-default:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    typography: "{typography.overline}"
    rounded: "{rounded.full}"
  badge-secondary:
    backgroundColor: "{colors.secondary}"
    textColor: "{colors.secondary-foreground}"
  badge-outline:
    backgroundColor: transparent
    textColor: "{colors.foreground}"
---

## Overview

This is OpenRouter's rebrand design system. It is built on **six core brand colors** — everything else (tints, borders, hovers, status backgrounds) is **derived from them via opacity**, never with new hex values.

The defining move is the **accent swap**: the interactive accent is theme-dependent.

- **Light mode → Grape (`#7624F4`)** is the accent. Volt is never used.
- **Dark mode → Volt (`#C8FF00`)** is the accent. Grape is never used.

Token values in the front matter are the **light-mode normative set**. The dark swap and all dark-mode surface values are documented under Colors below — the format has no native dark field, so light is treated as canonical and dark is the documented override.

Design discipline:

- **No odd pixel values.** Sizes, padding, and radius use even increments only (10, 12, 14, 16, 20, 24).
- **Derive with opacity.** All tints use the opacity scale below. No custom hex outside the six brand colors and the status colors — **except third-party vendor/provider logos** (see exception below).
- **Two type families**: Plus Jakarta Sans for the interface, Gordita for brand voice (page title + display stats in-product; display type on marketing surfaces). See Typography.

## Working with this document

This file is the complete rule set for product UI. The primitives in `packages/frontend/components/ui/` implement it, and `theme.css` in that directory is the runtime home of the tokens below. Read the rules, use the primitives, and take names from the public surface. `theme.css` is where a value lives, not a place to copy one from. Migration material lives next to the primitives: [`RADIX_TO_SEMANTIC_MAP.md`](packages/frontend/components/ui/RADIX_TO_SEMANTIC_MAP.md) for legacy Radix utilities and [`DESIGN_PORTING.md`](packages/frontend/components/ui/DESIGN_PORTING.md) for installing the token system in a host repo and for pages from the all-Gordita era. Legacy components that have not been rebranded yet sit in the same `components/ui/` tree as the rebrand primitives.

### Priority order

When two rules conflict, the earlier one wins.

1. **Meaning.** Status colors, number formatting, labels, and states must be true to the data: a no-data cell is `text-faint`, a failure is `negative`, an aligned digit column is `tabular-nums`, a destructive action confirms. A wrong signal is worse than an off-brand one.
2. **Existing primitives and tokens.** Use a rebrand primitive when one covers the need, and only the names in the public surface below. Never invent a variant, a hex value, a font size, a z-index, or a spacing step.
3. **Usable in both themes and by keyboard.** Focus ring on every control, AA contrast in light and dark, semantic markup, shape-preserving loading, the same component reads correctly with the accent swapped.
4. **Hierarchy.** One focal point per view, tier-based typography, parent-owned spacing, borders for structure in light mode.
5. **Brand expression.** The accent, the two Gordita moments, the chart palette, per the rules below. Brand never overrides 1 to 4.

### Public surface

The names an agent may write. The set is complete: if a need has no name here, use the nearest token by role and say so in the PR rather than adding a value.

- **Colors.** The semantic Tailwind utilities (`bg-background`, `text-foreground`, `bg-card`, `bg-popover`, `bg-muted`, `text-muted-foreground`, `border-border`, `border-input`, `bg-primary`, `text-primary-foreground`, `bg-accent`, `text-accent-foreground`, `bg-destructive`), the extended surfaces (`surface`, `card-hover`, `selected-bg`, `input-bg`, `text-faint`, `accent-subtle`, `accent-border`, `accent-hover`, `doc-surface`, `text-prose-body`), the status tokens (`positive`, `negative`, `warning`, `info`, `promo`, each with `-bg` and `-text`), the chart palette (`chart-1` to `chart-20` and the `chart-*` role tokens), the `tier-*` tokens, and the fixed `chart-N` slots assigned under Entity identity and Modality identity. Tints come from the opacity scale on these names, never from a new hex. Tailwind's own palette (`text-green-500`, `bg-slate-100`) and the legacy Radix steps (`text-slate-11`) are not part of the surface for new code.
- **Type.** The nine tiers `hero`, `display`, `title`, `heading`, `section`, `prose`, `body`, `button`, `overline` (as `text-[length:var(--text-*)]` or the matching utility), the leadings `tight`, `snug`, `body`, `prose`, and the family classes `font-brand` and `font-mono` under the rules in Typography. No arbitrary `text-[13px]`.
- **Shape and space.** `rounded-sm` to `rounded-xl` plus `rounded-full`, the Tailwind spacing scale at even values, and the z-index utilities generated from `packages/theme/index.css` (`z-above`, `z-sticky`, `z-overlay`, `z-fixed`, `z-modal`, `z-alert`, `z-notification`, `z-popover`, `z-popover-overlay`, `z-popover-tooltip`). The icon sizes `icon-xs` to `icon-lg` and the content widths `content` and `wide` in Layout are role names, not classes: write them as the Tailwind size they resolve to (`size-3` to `size-6`, `max-w-5xl` and `max-w-7xl`).
- **States.** `--focus-border`, `--focus-shadow`, `--error-border`, `--error-shadow`, `opacity-50` for disabled, `card-hover` for hover, `selected-bg` for selected.

Two rules follow. **No synonyms**: `text-faint` is not `text-foreground/70`, `card-hover` is not `bg-muted/50`, and a status is not its `chart-*` lookalike. **No literals**: reference the var in a `calc`, never its current value (`var(--leading-snug)`, not `1.35`), and never carry a token's hex into TSX, SVG, or inline styles when the token can be referenced.

### Generated-design reflexes to reject

These are the patterns that generated UI produces by default. Each is named so a reviewer can point at it. The rule that governs each lives in the linked section.

- **Accent on repeated data.** Colored table cells, per-row values, dense link lists, chart fills in the accent. Repeated data is `foreground`, status, or `chart-*` (Accent usage, Links).
- **Accent as selection.** Accent-tinted selected cards, filled-accent toggle buttons, accent selection bars. Selection is `selected-bg` plus a visible control (Selection states).
- **Hover painted as active.** Accent on hover, or hover reusing the selected treatment. Hover is neutral `card-hover` everywhere (Hover row).
- **Mono for anything that is not code.** Model slugs, IDs, hashes, numbers, timestamps in `font-mono`. Only code, inline code, masked secrets, and `kbd` are mono (Numbers, Code & secrets).
- **Spinner over blank.** A full-page or region spinner where a skeleton fits (Loading & skeleton).
- **Off-palette color.** A raw hex, a Tailwind palette class, a Radix step in new code, a fourth status hue for "neutral", or a brand color used as a chart series (Colors, Status & health).
- **Off-scale sizes.** `text-[13px]`, `text-[15px]`, odd pixel padding, 11px chart ticks. Snap to the nearest tier by role, and use the dense-data exemption only where it applies (Typography, Layout).
- **Gordita creep.** `font-brand` on section headers, buttons, table cells, or body copy. Two roles only: the page title and display-size stats (Typography).
- **Weight as state.** A nav item, tab, or segment that goes bold when active. State is color and background at the Nav weight (Nav weight).
- **Shadows for depth.** Shadows on resting cards, buttons, or banners. Elevation between surfaces is hierarchy and borders (Elevation & Depth).
- **Filled Ink or Cloud button.** A high-contrast neutral button that competes with primary (Buttons).
- **Tinted callouts.** An accent-tinted banner, a colored card for information without status, a tinted CTA card. Non-status callouts are neutral, promo is Royal (Banner / toast, CTA card).
- **Bumped menu rows.** Dropdown, select, or command rows taller than the standard row height (Hover row).
- **Invented z-index.** A `z-50` or `z-[999]` outside the ladder, or page floaters hoisted to `z-modal` (Layout).
- **Authored capitals.** Title Case labels, ALL CAPS overlines, a capitalized second word in a button (Capitalization).
- **Token values as literals.** A leading, size, or color written as the number it happens to be today (Public surface).

### Review before handoff

Check in this order and fix what fails before asking for review.

1. **Both themes.** Toggle dark mode. The accent is Grape in light and Volt in dark and nothing else changed hue. Muted and status text still read on their surfaces.
2. **Keyboard.** Tab through every control. Each shows the neutral focus ring, dialogs trap focus, Enter submits forms, `Escape` closes overlays.
3. **States.** Loading is a skeleton in the final layout, empty and error states follow the empty-state composition, destructive actions confirm with a named button, disabled is `opacity-50`.
4. **One focal point.** One primary button, one accent moment, one page title in Gordita. Everything repeated is neutral.
5. **Tokens only.** No hex, no Tailwind palette class, no Radix step, no arbitrary font size, no invented z-index, no literal token value in a `calc`.
6. **Copy.** Sentence case, no authored caps, labels named for the action (`Delete workspace`, not `OK`).
7. **Layout.** Page gutters `px-4` to `px-6`, content width from the scale, dense-data exemption applied deliberately and nowhere else, reflow at `md` before anything shrinks, banner-aware sticky offsets.
8. **Reflexes.** Read the list above once more against the diff.

## Colors

### The six brand colors

| Color | Hex | Role |
|-------|-----|------|
| **Ink** | `#03080A` | Near-black. Dark-mode background, light-mode text. |
| **Cloud** | `#FCFCFE` | Near-white. Light-mode background, dark-mode text. |
| **Grape** | `#7624F4` | Accent in **light** mode — primary buttons, active states. |
| **Volt** | `#C8FF00` | Accent in **dark** mode — primary buttons, active states. |
| **Coral** | `#FF6849` | Marketing/brand accent only — **deprecated in product UI** (reads too close to the status reds). Promotional UI moved to Royal. **Never** for actions. |
| **Royal** | `#035ADE` | Info status **and promotional callouts** ("New" badges, upgrade CTAs). **Never** a button or accent. (No longer a chart color — the chart palette mirrors prod; see Data viz.) |

### The opacity scale

Every derived color is a brand color with a hex-alpha suffix. This is the entire derivation system:

| Suffix | Use |
|--------|-----|
| `05` | card bg (dark), card hover (light, neutral Ink) |
| `08` | selected bg (light), card hover (dark, neutral Cloud), ghost button hover, accent-subtle bg |
| `0a` | input bg (dark), selected bg (dark) |
| `14` | border, accent bg, input border, status `-bg` (banner/wash) |
| `20` | accent border |
| `30` | status border (banners) |
| `70` | text faint |
| `a0` | text muted (dark — Cloud `a0` on Ink ≈ 7.8:1) |
| `b0` | text muted (light — Ink `b0` on Cloud ≈ 7.5:1) |
| `e0` | accent hover (primary button hover) |

The muted split is deliberate: the same alpha lands differently per theme — Ink `a0` on Cloud measured **5.9:1** vs Cloud `a0` on Ink at **7.8:1**, so light-mode secondary text read visibly weaker (and light mode gets no halation boost). Light steps up to `b0` to equalize the themes; dark stays `a0`.

### Dark-mode swap

In dark mode the accent flips to **Volt** and the neutral surfaces invert. Every `primary` / `secondary` / `accent` / `ring` token resolves to Volt-based values, and surfaces derive from Cloud-on-Ink instead of Ink-on-Cloud:

| Token | Light | Dark |
|-------|-------|------|
| `background` | `#FCFCFE` | `#03080A` |
| `foreground` | `#03080A` | `#FCFCFE` |
| `card` | `#FFFFFF` | `#FCFCFE05` |
| `popover` (opaque overlay) | `#FFFFFF` | `Cloud 5% composited onto Ink` (opaque, ≠ background) |
| `surface` | `#FFFFFF` | `#FCFCFE03` |
| `doc-surface` | `#FFFFFF` | `#FCFCFE0c` |
| `card-hover` | `#03080A05` | `#FCFCFE08` |
| `selected-bg` | `#03080A08` | `#FCFCFE0a` |
| `input-bg` | `#FFFFFF` | `#FCFCFE0a` |
| `primary` (accent) | `#7624F4` Grape | `#C8FF00` Volt |
| `accent-hover` | `#7624F4e0` | `#C8FF00e0` |
| `muted-foreground` | `#03080Ab0` | `#FCFCFEa0` |
| `border` / `input` | `#03080A14` | `#FCFCFE14` |
| `positive` / `positive-text` | `#00BF6F` / `#007544` | `#00BF6F` (same) / `#34DFAA` |
| `negative` / `negative-text` | `#FF2D55` / `#BF0024` | `#FF2D55` (same) / `#FF2D55` |
| `warning` / `warning-text` | `#E5A000` / `#8A6000` | `#E5A000` (same) / `#FFAB00` |
| `destructive` (button fill) | `#E11D48` | `#E11D48` (same) |
| `info` / `info-text` (+ `promo`) | `#035ADE` Royal / `#0352C9` | `#035ADE` (same) / `#4D8DFF` |
| `text-prose-body` | `#03080A` | `#FCFCFEe6` |

The categorical chart palette (`chart-1`…`chart-20`) is the **same hex in both themes**. The ordered session-length roles use theme-specific values because they also paint small text labels directly on the background. Each step is chosen to meet AA contrast in its theme.

**Status display colors are the same hex in both themes** — like the chart palette, a status wash, fill, or icon keeps its hue when the theme flips (`#00BF6F` / `#FF2D55` / `#E5A000` / `#035ADE`; all clear the 3:1 non-text bar on Ink). What's theme-tuned is the **`-text` value**, because **status as text must pass WCAG AA (≥4.5:1)** on `background`/`card` — and the direction of "readable" inverts per theme: light `-text` darkens (`#007544` / `#BF0024` / `#8A6000` / `#0352C9`, tuned to pass even inside the status tints), dark `-text` brightens (`#34DFAA` / `#FF2D55` / `#FFAB00` / `#4D8DFF`) — dark mode's status glow lives in the text, exactly where it's read. `promo` = Royal and follows `info`. `destructive` is `#E11D48` in both themes (the Cloud button label needs 4.5:1 on the fill; the old dark `#FF2D55` measured 3.6:1).

**Text selection.** `::selection` uses an accent tint (`accent` bg = accent at `14`, `foreground` text) — on-brand, not the browser default blue. Set it once globally.

### Images & media in dark mode

Photos and full-color illustrations render as-is in both themes. The cases that need handling:

- **Monochrome marks / line art / diagrams** that are dark-on-transparent (logos, glyphs, inline SVGs you don't control): provide a theme-aware source where possible (`hidden dark:block` swap, like the footer wordmark), or invert as a fallback (`dark:invert`, plus `hue-rotate-180` if the asset carries hue). Never leave a dark glyph invisible on Ink.
- **Screenshots / framed images on a busy edge:** give them a `border-border` (or the framed-avatar `ring`) so they don't bleed into the surface; `rounded-xl` for media headers.
- **Fades/scrims over an image** originate from a **surface token** (`background`/`card`), never raw `white`/`black` (see Surface hierarchy).

### Accent usage

The accent (Grape/Volt) marks **the one thing that matters** — a single focal point or an interactive affordance. Its power comes from scarcity: the moment it repeats across data it stops signaling and miscolors neutral information as if it were special. Decide by **frequency + intent**, not by "static vs interactive":

- **Use accent for** all interaction (primary buttons, active tab/sidebar indicators, link *hover*, focus rings, the logo glyph) **and singular emphasis** — one focal point per view: a hero/conversion CTA, a single highlighted metric or recommended option, a bounded wayfinding set (e.g. a stepper). One per view; if you'd apply it twice, it's not emphasis.
- **Swap to neutral** (`foreground` / `muted-foreground`) for **anything repeated across data**: table cells, per-row or per-card values, list metrics, repeated links (links are neutral at rest, accent on hover — never `text-primary` for dense links).
- **Swap to status** (`positive`/`negative`/`warning`) for **anything encoding meaning or a threshold**: deltas and trends (sentiment-colored), or a value crossing a limit (a budget bar nearing its cap shifts from accent to `warning`/`negative`).

**Delta / trend semantics.** Color a change by *sentiment, not sign*: up-is-good metrics → `+` green / `−` red; for **cost-like metrics where lower is better** (spend, latency, error rate), invert — a decrease is `positive`. A flat/zero change is neutral (`muted-foreground`); no-prior-data is `text-faint` with a neutral glyph, not a colored zero.

**Pattern rulings** (generalize these to any equivalent case):

| Pattern | Ruling |
|---------|--------|
| Single highlighted metric / recommended option | **Accent** — singular emphasis |
| Conversion CTA (hero button, CTA-card action) | **Accent** — on the **button**, never a tinted card surface (see CTA card) |
| Stepper / bounded wayfinding set | **Accent** (tint) |
| Progress / usage bar fill | **Accent** when singular (one account-level bar); **neutral** when repeated (per-row lists); **status** override when it crosses a threshold |
| Repeated metric / value / delta | **Status** if it carries sentiment, else **neutral** — never accent |
| Tier / status / metadata / recruiting label (e.g. "Enterprise", "Hiring", "Beta", "Alpha") | **Neutral / outline** — it's a persistent *label* on a thing, not a CTA. A standing label like "Hiring" on a nav link is `outline` (or `secondary` if it marks a selected/active item); it is **not** promo. |
| Promotional callout ("New", launch, upgrade) | **Royal** (`promo`) — reserved for a *transient announcement* of a launch/upgrade. The test: "New" on a just-shipped item is promo; a label that's true indefinitely ("Hiring", "Beta") is a metadata label → neutral. A callout with no launch to announce is **neutral** (see Banner → Callout flavor), which keeps promo scarce. (Coral previously held this job — deprecated in UI, too close to the status reds.) |

`secondary` badges are accent-tinted = a **selected/active state only** (e.g. a label on the currently-selected item). `outline` badges are neutral display values — the default for a standing metadata/recruiting label. `default` (filled accent) is a **CTA** badge only. **Don't reach for `promo` just because a label should "stand out"** — a recruiting/metadata label is neutral; promo is for genuine launch/upgrade announcements. Accent is **never** a chart fill (see Data viz).

### Surface hierarchy

`background` (page) → `surface` (nav/sidebar, solid) → `card` (cards/tables) → `doc-surface` (content-heavy reading pages).

Surface distinction is **dark-dominant**: in light, `card` (`#FFFFFF`) and `background` (`#FCFCFE`) read the same to the eye — **borders carry the structure**. In dark, the elevation difference is visible. Don't rely on the surface shift in light mode to communicate hierarchy.

**Applying the elevation tint — alpha vs. composite.** A raised surface is the page color lifted by a small tint (in dark, `Cloud` at the `05` step). *How* that tint is applied depends on whether the surface lies on the page or floats above it:

- **In-flow** (lies on the page — cards, tables, chrome): layer the tint as **alpha**. The opaque page shows through it — that translucency *is* the hierarchy. → `card` / `surface` / `doc-surface`.
- **Floating overlay** (a portal that pops *over* arbitrary content — *popovers, dropdowns, selects, dialogs, sheets, tooltips*): composite the **same** tint onto an **opaque base**, so page content can't bleed through. → `popover` (= the `card` tint flattened into `background`; opaque in both themes).
- **Sticky chrome** (a header / sub-nav / TOC that stays pinned while the page scrolls *under* it — not a portal): may be a **high-opacity translucent** `background` with `backdrop-blur-sm` (`background/95`; `/80` where the blur is supported, `/50` for a thin mobile action bar). It reads as "the page, frosted," which is the intent — distinct from a portal overlay, which must be fully opaque. Any **fade/scrim gradient** (edge masks, sticky fades) must originate from a **surface token** (`background`/`card`), never raw `white`/`black` or a Radix step.

Same elevation, two methods. A floating surface separates from the page by **tone + border + shadow**, never by transparency. The rule generalizes: *if it overlaps the page, its base is opaque* — don't reach for a translucent token (`card`/`surface`) on anything that floats.

### Data viz

Chart colors come from **openrouter-web prod**, codified as two palettes with distinct jobs — **not** the brand or status palette:

- **Categorical** (`chart-1`…`chart-20`) — prod's `defaultColors` (`viz/shared.ts`), **slot-assigned** to arbitrary series where color carries no fixed meaning (one model = one slot, one provider = one slot). *Slot-assigned* means "drawn from these 20," not "must be sequential": when series are identifiable entities (models, providers, apps), prefer **hash-stable** assignment (prod's `stableColorForLabel`) so an entity keeps its color across filters and queries; plain sequential cycling is for genuinely anonymous series. **Curated maps are also fine** (e.g. prod's benchmark table pinning providers to specific hues) as long as every hue comes from the 20 and the assignment is stable app-wide.
- **Semantic roles** (`chart-cost`, `chart-requests`, `chart-tokens-prompt`, `chart-tokens-completion`, `chart-tokens-reasoning`, `chart-tokens-cached`, `chart-tokens-uncached`, `chart-credits`, `chart-byok`, `chart-session-length-single`, `chart-session-length-short`, `chart-session-length-core`, `chart-session-length-long`) use prod's `OVERVIEW_CHART_COLORS` where applicable. **A metric keeps its color on every surface**. When a series *is* one of these metrics, use its role token, never a categorical slot. The session-length roles form an ordered ramp from one turn through 50+ turns.

Two standing rules:

- **The accent (Grape/Volt) is never a chart fill.** It signals interaction, not data.
- **Status colors stay semantic.** Use `positive`/`negative`/`warning` in a chart only when a series actually encodes good/bad/caution — never as generic series colors.

The categorical palette (`chart-1`…`chart-20`) is one shared palette with the same hex in both themes, so categorical series keep their color when the user flips theme. The ordered session-length roles are the deliberate exception because their small text labels require theme-specific AA contrast. Tokens are hex (not `oklch`) so Recharts SVG fills resolve correctly.

**Consumption — two paths by context:**
- **Recharts / SVG props** (fills, strokes, gradient stops): concrete color strings, not `var()` (Recharts sets SVG *attributes*, which don't resolve custom properties). In this repo that's the hook — `const c = useChartColors()` (from `@/rebrand/hooks/use-chart-colors`): `c.categorical[i % c.categorical.length]` for slot-assigned series, the named role keys (`c.cost`, `c.requests`, `c.tokensPrompt`, …), the **status keys** (`c.positive` / `c.negative` / `c.warning` — theme-dependent, for series that genuinely encode good/bad/caution, e.g. sentiment sparklines), and the **neutral keys** (`c.mutedForeground` / `c.border` — for axis ticks, gridlines, reference lines).
- **CSS / className contexts** (identity chips, legend dots, borders): reference the token directly — `var(--chart-7)`, `var(--chart-cost)`. Chart tokens are solid hex, so alpha steps derive via `color-mix(in srgb, var(--chart-N) 12%, transparent)` (see Entity identity), not 8-digit hex.

**Chart structure (the non-series parts):**
- **Axis ticks, gridlines, reference lines** — `muted-foreground` / `border` (via the hook's neutral keys in SVG props). Never a hardcoded `#666`/slate hex.
- **Aggregate "Other" / "rest of" series** — `chart-tokens-uncached` (the slate role): it's the sanctioned neutral series color.
- **Neutral sentiment** (a flat/no-change sparkline) — also `chart-tokens-uncached`, not `text-faint` (SVG needs a concrete color, and it should match other neutral series).
- **Area gradients** — the series color fading to transparent: top stop 12% opacity for dense product charts, up to 35% for a single-series overview hero chart; bottom stop 0. **Stacked areas** are the exception — a gradient fade makes overlapping bands unreadable, so stacked/banded series use a **flat** fill at 40% with a full-opacity stroke on the band's top edge. No other fill alphas.
- **Chart micro-type** (axis ticks, legend rows, tooltip labels) — `overline` (12px). Chart chrome falls under the dense-data exemption; snap prod's stray 11px ticks to 12.

### Entity identity

When a UI needs a **stable per-entity color** — a chat model's dot, a provider/author mark, modality or category chips — reuse the **categorical `chart-1`…`chart-20`** palette as the identity set. Assign by stable hash or index so an entity keeps its color everywhere it appears. Derive the three surfaces by opacity, exactly like a status color:

- **Dot / fill** — `chart-N`
- **Chip background** — `chart-N` at `12` (use `/12` since identity chips read alongside `08` status bg)
- **Chip text** — **neutral `foreground`**, never `chart-N`: chart hues are mid-tone *fill* colors and fail AA as text in light mode — identity rides the dot/tint/border, not the letters. **Border / stripe** — `chart-N` at `20`
- **Hover wash** — `chart-N` at `04` (an identity-tinted surface hover — e.g. a card hover while that entity's filter is active)

**Avatar fallbacks (initials)** use the identity *tint*, not the solid: `chart-N` at `12` background with **neutral `foreground` initials** — AA-safe in both themes, same construction as the chip. Solid `chart-N` fills are reserved for marks that carry no text (dots, swatches, bars); chart hues fail AA under light-mode Cloud letters.

This is the same palette as data viz, used for a different job — so identity never invents new hues. The one caveat: on a surface that shows both a chart **and** entity chips, offset the identity index so a chip doesn't match an unrelated series.

**Entity-keyed bars override the neutral-progress rule.** A repeated per-row bar whose fill is *the row entity's* chart color (e.g. a share-of-usage bar matching that model's series in the chart above) keeps the entity color — that chart↔table link is the point. "Progress bars are neutral when repeated" applies only to meaning-free progress fills.

**Entity-filter controls may wear the entity's color.** A tab/pill strip that filters *by* entity (modality tabs, provider filters) may use the entity's identity color for its active indicator and hover wash instead of the accent — there the color *is* the wayfinding. Constraints: every hue comes from the `chart-1`…`chart-20` mapping (never new hex); the identity color goes on the **indicator, the wash, and the entity's glyph** — label text stays neutral (`muted-foreground`, `foreground` when active) since chart hues fail AA as text in light; and generic navigation (routes, views, settings) keeps the accent.

### Modality identity

Model modality is platform-critical wayfinding, so its colors are **fixed assignments** from the categorical palette — never hash-picked. **Every modality sits on its own hue family** — no two assignments may collapse into look-alikes at the `/12` tint. The core four + rerank also clear the **3:1 non-text contrast bar against both themes' backgrounds** (the palette is theme-constant, so a slot must work on Cloud and Ink alike):

| Modality | Token | Slot | Value | Icon (lucide) |
|----------|-------|------|-------|---------------|
| Text | `modality-text` | `chart-1` | `#0088FE` blue | `Type` |
| Image | `modality-image` | `chart-20` | `#2E8B57` sea green | `Image` |
| Audio | `modality-audio` | `chart-12` | `#7B68EE` violet | `AudioLines` |
| Video | `modality-video` | `chart-19` | `#FF4500` orange-red | `Video` |
| TTS | `modality-tts` | `chart-10` | `#FF69B4` hot pink | `Speech` |
| Transcription | `modality-transcription` | `chart-9` | `#40E0D0` turquoise | `Mic` |
| File | `modality-file` | `chart-11` | `#DAA520` goldenrod | `File` |
| Embeddings | `modality-embeddings` | `chart-8` | `#DA70D6` orchid | `Boxes` |
| Rerank | `modality-rerank` | `chart-14` | `#6B8E23` olive | `ArrowUpDown` |

**Never color-only.** A modality is identified by its icon and color *together*, always with a visible label or a tooltip — color is redundant encoding, never the sole channel (color-vision deficiency collapses hue families; the glyph disambiguates). **Distinctness outranks glyph contrast for the long tail:** the four rarest modalities (`tts`, `transcription`, `file`, `embeddings`) sit on slots below 3:1 in light mode precisely so no two modalities share a hue family — their label/tooltip is mandatory, and they must never carry meaning by color alone.

**Modality badge** (the model-detail capabilities callout is the reference): a **20px `rounded-md` tile** — modality color at `/12` fill, the modality icon at **12px / stroke 2.5 in the modality color**, name in a tooltip. Use wherever a model's modalities are listed compactly (detail header, capability callouts, table cells).

**Modality tabs** (the multimodal filter nav on `/models` and `/rankings`): an underline tab strip where each tab is the **modality icon (`icon-sm` 16px) + label at the Nav weight + optional `tabular-nums` count**. Rest: icon and label both `muted-foreground`. Hover: modality wash at `/04`, icon takes the modality color, label promotes to neutral `foreground`. **Selected: 2px underline in the modality color, icon in the modality color, label in neutral `foreground` — no fill on the selected tab.** The "All" tab carries no modality and selects with the standard neutral tab treatment.

All other derivations follow the entity recipe — chip bg `/12`, border `/20`, wash `/04` — and label text always stays neutral: the color lives in the glyph, the indicator, and the tints, never the letters.

### Status & health

The three status colors double as a **sequential health ramp** when a value maps to good / acceptable / bad:

| State | Token |
|-------|-------|
| Good / healthy / pass | `positive` |
| Acceptable / caution / degraded | `warning` |
| Bad / failing / error | `negative` |
| No data / not applicable | `text-faint` (neutral — never a status color) |

Status as **inline text** (e.g. an uptime % or a state label in a dense table) uses the status token directly on `foreground`-weight text; status as a **fill/badge/banner** uses the `*-bg` opacity treatment. Don't introduce a separate "ok/neutral" hue — a no-data or inactive state is neutral (`text-faint` / `muted-foreground`), not a fourth color.

**The status text split (light).** A status color can't be vibrant *and* pass AA as text — so in light mode every status is **two tokens**: the **display value** (`positive` `#00BF6F` · `negative` `#FF2D55` · `warning` `#E5A000` · `info` `#035ADE`) for everything **non-text** — tint backgrounds, badge/bar fills, borders, and icons that sit next to a text label — and the **text value** (`positive-text` `#007544` · `negative-text` `#BF0024` · `warning-text` `#8A6000` · `info-text` `#0352C9`) wherever status renders as **text** (badge labels, inline status text, banner CTAs, deltas) *or* stands alone as the only signal (a bare status glyph with no label). The `-text` values are derived to pass **≥4.5:1 on status tints up to a `/25` wash as well as on `background`/`card`** — one text token works everywhere a status speaks, including inside its own tint. This is what keeps light-mode status washes as lively as dark mode's: the tint derives from the vibrant display hue, only the letters darken. **The display hex is the same in both themes**; in dark the `-text` token *brightens* instead (`#34DFAA` / `#FF2D55` / `#FFAB00` / `#4D8DFF`) — so the `-text` tokens are always the safe reach for status text in either theme, and dark keeps its glow where it's read.

**Legacy Radix steps** (`slate-11`, `green-9`, and the rest) collapse onto these tokens by *role*, not by hex proximity. The step-by-step map lives in [`packages/frontend/components/ui/RADIX_TO_SEMANTIC_MAP.md`](packages/frontend/components/ui/RADIX_TO_SEMANTIC_MAP.md).

**Statuses are never opaque fills.** There are deliberately no `positive-foreground`/`warning-foreground` tokens: status renders as tint bg (`*-bg` at `14`) + status-colored text, or plain status text — never `bg-positive text-white`. A host repo's `success/-foreground` pairs map to `positive` + the tint treatment (`success → positive`, `error/danger → negative`, `info → info`).

**Inverted micro-surfaces are allowed.** A `foreground`-on-`background` inversion (a tooltip value pill, a dark chip in a light tooltip) is a neutral emphasis device, not a brand-color violation — the Ink/Cloud ban applies to **buttons**. Keep inversions to micro-surfaces; a whole inverted card is a theme, not an emphasis.

## Typography

Even-increment scale only. **Two families**: **Plus Jakarta Sans** is the interface font — the `.rebrand-theme` default, everything renders in it unless opted out. **Gordita** is the brand-voice font, opt-in via `.font-brand`. A monospace stack (`font-mono`) survives **only for code and secrets** (see Tables → Code & secrets) — never for numbers, IDs, model slugs, or table columns. No other families.

### Brand voice vs interface (Gordita vs Jakarta)

The distinction is **rhetoric vs mechanics** — Gordita is what the brand *says*; Jakarta is what the interface *does*. "Marketing vs product" is a symptom of this rule, not the rule itself.

**In-product, Gordita appears in exactly two roles** — *the headline and the headline number*:
- The **page title** (`title` tier).
- **Display-size stat values** (`display`/`hero` numbers — the KPI figure, the pricing number).

Everything else in product UI is Jakarta — **section headers included**, plus card titles, table headers, nav, badges, dialogs, forms.

**On marketing/brand surfaces** (landing, campaign pages, slides, large empty-state heroes) Gordita carries the display typography broadly (`hero`/`display`/`title`); ledes and body copy are Jakarta.

**Guardrails** (all four must hold for `.font-brand`):
1. **Size floor 16px** — Gordita never renders below 16px (`heading` size); geometric forms go muddy small.
2. **Never interactive** — buttons, links, inputs are always Jakarta, even a giant marketing CTA.
3. **Never repeated data** — a stat value is a brand moment once per card; a numeric column is data (Jakarta + `tabular-nums`).
4. **Labels stay Jakarta** — a Gordita stat value takes a Jakarta `body`/`overline` label; a Gordita page title takes a Jakarta subtitle.

Scarcity is the point: if Gordita shows up more than a few times per viewport, it's creeping — audit against the two-role list.

### Capitalization

**Sentence case everywhere.** Capitalize the first word and nothing else. This holds for every string the interface authors — page titles, section headers, table headers, tabs, nav, button and menu labels, dialog titles, form labels, placeholders, empty states, toasts, tooltips, badges. "Delete intern", not "Delete Intern". "Add provider key", not "Add Provider Key".

Sentence case is the choice because Title Case has no decidable rule (every style guide draws the preposition line somewhere else, so two engineers produce two labels for the same button), it reads slower at UI sizes, and it collides with the tokens below — a Title-Cased label inside an `overline` renders as shouting.

**Three carve-outs, and only three:**
1. **Proper nouns** keep their own capitalization, including product and vendor names: "Install in Slack", "Generating OpenRouter API key", "Connect to GitHub".
2. **Verbatim third-party labels.** When copy instructs the user to click something in someone else's UI, quote that control exactly as it appears there — "Under *Your App Configuration Tokens*, click *Generate Token*" — because the user is pattern-matching against Slack's screen, not reading our prose. Mark it as a quotation (italics or `<em>`) so the casing reads as a citation rather than a lapse.
3. **Acronyms and identifiers** stay as they are: "API key", "VM zone", "ORI version", "HIPAA restrictions".

**Never ALL CAPS as authored text.** The `overline` tier applies uppercase as a *style* (`uppercase` + `tracking-wider`), so the string underneath stays sentence case and the tier can be restyled without a copy edit. Emphasis comes from weight, color, and size — never from capitalization.

### Implementation

**Loading.** Gordita is a local font (`next/font/local`, woff2 set in `public/fonts/gordita/`, weights 100–950) exposed as `--font-gordita`; Plus Jakarta Sans comes from `next/font/google` (variable, no `weight` option needed) as `--font-jakarta`. Both variable classes go on the theme wrapper. The theme carries exactly two family rules:

```css
.rebrand-theme { font-family: var(--font-jakarta), system-ui, sans-serif; }
.rebrand-theme .font-brand { font-family: var(--font-gordita), system-ui, sans-serif; }
```

**Portal trap (do not skip).** Radix portals (dropdowns, dialogs, tooltips) render outside the theme wrapper. Adding `.rebrand-theme` to `document.body` is not enough — the `next/font` **variable classes must ride along too**, or `var(--font-jakarta)` won't resolve on portals and they silently fall back to system fonts. In this repo `PortalTheme` takes a `fontClasses` prop and applies both to `body`; any port of this system needs the same move.

**Recipes** — the literal classNames:

```tsx
// Page title — the in-product Gordita moment
<h1 className="font-brand text-[length:var(--text-title)] font-semibold tracking-tight">Activity</h1>
// + Jakarta subtitle (no font class — Jakarta is the default)
<p className="text-[length:var(--text-body)] text-muted-foreground">Last 30 days</p>

// KPI value — the headline number (label stays Jakarta)
<span className="text-[length:var(--text-body)] text-muted-foreground">Spend</span>
<p className="font-brand text-[length:var(--text-display)] font-bold tracking-tight tabular-nums">$73K</p>

// Numeric table cell — Jakarta, aligned digits, never mono
<TableCell className="text-right text-muted-foreground tabular-nums">{fmtTokens(row)}</TableCell>
```

Everything not in the two Gordita roles needs **no font class at all** — writing `font-brand` is the exception, not a habit.

| Token | Size | Weight | Leading | Family | Use |
|-------|------|--------|---------|--------|-----|
| `hero` | 36px+ | 700 | tight (1.2) | Gordita | Marketing/campaign headlines & large empty states. **Floor, not a fixed size** — see note below. |
| `display` | 24px | 700 | tight (1.2) | Gordita | Pricing, hero/stat numbers |
| `title` | 20px | 600 | tight (1.2) | Gordita | Page titles |
| `heading` | 16px | 600 | snug (1.35) | Jakarta | Titles of contained surfaces: cards, dialogs, sheets, toasts — see Tier assignments |
| `section` | 16px | 500 | snug (1.35) | Jakarta | Section headings, incl. prominent/empty-state headings. Same size as `heading` — weight, position, and (optionally) the muted variant carry the distinction |
| `prose` | 16px | 450 | prose (1.7) | Jakarta | Reading body for **multi-paragraph content** — blog posts, rendered docs, chat transcripts. Width comes from the page layout, never from this tier |
| `body` | 14px | 450 | body (1.625) | Jakarta | Body, descriptions, links — product-UI copy (nav text is `body` size at 500 — see Nav weight below) |
| `button` | 14px | 500 | — | Jakarta | Button labels |
| `overline` | 12px | 500 | — | Jakarta | Meta labels, badges (uppercase, tracking-wider). w500 is the tier default — the smallest text never renders at the lightest weight |

**Pair leading with size:** hero/display/title → tight (1.2); section/heading → snug (1.35); prose 16px → prose (1.7); body 14px → body (1.625).

**Letter-spacing is inverse to size — and zero in the reading registers.** Gordita display tiers (`hero`/`display`/`title`) take `tracking-tight` (-0.025em); `hero` at ≥48px on marketing surfaces may deepen to -0.04em (geometric caps go gappy at display sizes). Jakarta headings (`heading`/`section`) default to 0, with -0.01em optional at w600. **Never add tracking to `body`/`prose`/`button`** — Jakarta's metrics are fitted at 14–16px and the w450 register already added stroke density; positive tracking loosens exactly what the weight tightened. `overline` takes `tracking-wider` (+0.05em) and only as part of the uppercase pairing (never wide tracking on mixed-case); marketing kickers on slides may go wider (0.12–0.22em).

**Rag control.** Heading tiers carry `text-wrap: balance` (no one-word orphan lines in titles and card headings); `p`/`li` carry `text-wrap: pretty`. Both ship as base-layer `:where()` rules in the theme (progressive enhancement — unsupported browsers ignore them); don't re-declare them per component.

**The body register is 450, not 400.** Jakarta renders thin at true 400 in the 14px UI register, so "normal" weight throughout the system is **450** (Jakarta is a variable font — 450 is a true instance). Implementation is two hooks on the theme root: `font-weight: 450` as the inherited default, plus a scoped `--font-weight-normal: 450` so an explicit Tailwind `font-normal` resolves to the same value. Unstyled text needs no weight class at all; never write a literal `font-[400]`.

**`prose` vs `body`.** Use `prose` wherever the user is *reading multiple paragraphs* — blog posts, rendered markdown/docs, chat message bodies, changelogs. Everything else (descriptions, helper text, table cells, single-paragraph card copy) stays on `body`. Prose keeps the 450 register and steps up to 16px with looser 1.7 leading. **The tier sets type only — never a width.** Prose fills whatever container the page gives it; don't cap prose (or any content) narrower than its sibling content just because it's long-form. Headings inside a prose flow follow the "Rendered long-form docs" rule below.

**Sizes are locked; weights are defaults.** The table's weight is what a tier renders at absent a reason — one step of local hierarchy (e.g. a 14px label at 500 next to 14px body at 450) is fine; two steps or a new size is not. (The Stat/KPI value: weight 500 at `section` size, 700 at `display`/`hero`.)

**Tier assignments.** `heading` is the title of a **contained surface — one per surface**: Card, Dialog/AlertDialog, Sheet, popover panel, toast/notification. The litmus is the border: a title **inside** the bounded surface is `heading`; a header sitting **above/outside** it (typically with a subtitle or an actions row, titling the region the surface lives in) is `section`. Sheet titles match dialog titles — no overlay title uses `title`. Text that is *repeated* or *interactive* belongs to the control register instead — `body` at the Nav weight (500): accordion triggers, settings-row labels, and **list-item names** (members, activity rows, entries in a selectable list). A list must not read as stacked card headers; if a repeated entry is a true card tile (thumbnail + title + description), its name is a card heading and stays on `heading`. One carve-out: a marketing FAQ accordion (editorial register) may step up to `section`.

**Nav weight.** Any nav element's text — top-nav links, sidebar rows, tab labels, segmented segments, menu rows — renders `body` size at **`font-medium` (500)**, the same weight as button labels, at rest and active alike. State changes are color/background, never weight. Non-nav body copy stays at the 450 default register. A nav/tab label may pair a **leading icon** — sized per the icon table (`icon-sm` 16px with a body-size label). Gap follows the context: **`gap-1.5` for an inline tab/link label**; **sidebar rows treat the icon as a gutter — `gap-2`–`gap-3`** — so the icon column aligns down the rail. Either way the icon **always inherits the label's color** through rest/hover/active, never independently colored (the one exception: an entity-filter tab's *entity glyph* — e.g. a modality icon — wears its identity color on hover/selected while the label stays neutral; see Modality identity). **Footer link columns are not nav** — they're reference content: `body` at the default register in `muted-foreground`, hover per the Links rule (promote to `accent-foreground`); only the footer's section headers carry weight.

**Responsive downshift.** UI tiers may drop **one tier below `md`** (a `display` page header → `title` on mobile) — never scale *up* except `hero` (see below). A desktop size picks its tier by the desktop value.

**A grid of stat cards is repeated data.** One KPI figure is a headline number (`font-brand` at `display`+); a *grid* of same-shape stat cards is data — all Jakarta, per guardrail 3. Gordita marks the view's *single* headline number, not every number in view.

**Rendered long-form docs.** Markdown/doc renderers (README-style content on a `doc-surface`) may reuse the `title` (h1/h2) and `section` (h3) *sizes* in **Jakarta** — the Gordita binding applies to product page titles, not prose headings, and a doc's many headings are repeated structure (guardrail 3). Body/list copy is the `prose` tier (16px, `leading-prose`); inline meta around the flow (captions, footnotes, table cells) stays on `body`.

**Section-header color.** Headings default to `foreground`. The prod rankings convention — icon and title both `muted-foreground`, sitting above full-bleed content — is a sanctioned variant for browse/editorial surfaces; whichever you pick, the icon always matches the title color.

**Map stray sizes back to the scale.** The UI scale is intentionally tight — when a source uses an off-scale size, snap it to the nearest tier by *role*, don't add a token: 15px body → `body` (14); 11px micro-label → `overline` (12); a large stat number → `display`/`hero`. The only legitimate off-scale UI value is the dense-data exemption (see Layout).

**`hero` is a floor, not a fixed token.** Every other tier is a single locked value (the "even-increment scale only" rule applies to UI type). `hero` is the exception: it's the **marketing/campaign headline** tier and is the *only* size allowed to scale **above** its 36px default — go larger and/or responsive (e.g. bigger on desktop) when a landing/campaign page calls for it. Keep weight 700 and tight leading. This carve-out is scoped to marketing headlines; don't scale UI tiers.

**Marketing & big-number registers reuse existing tiers — no new tokens.** A marketing *lede* (the intro sentence under a hero) is `section` size at **the 450 body register** in `muted-foreground` — i.e. an existing tier de-weighted, not a new one. A *big stat number* (pricing, dashboard hero figure) is `display` (24) → `hero` (36) at weight 700; a leading currency `$` sits one tier down with `align-top` (superscript). Pair a stat with a `body`/`overline` `muted-foreground` label.

## Layout

**Spacing** is base-8 (with a 4px half-step and a 12px micro-step), in two ranges:

| Range | Tokens | Use |
|-------|--------|-----|
| Component | `xs` 4 · `sm` 8 · `md` 12 · `lg` 16 · `xl` 24 | Padding and gaps *within and between adjacent* elements. Product UI defaults to the 14px body. |
| Section | `2xl` 32 · `3xl` 48 · `4xl` 64 · `5xl` 80 · `6xl` 96 | Vertical rhythm *between page sections*; scroll-anchor offsets. Larger steps for marketing/long-form, tighter for app surfaces. |

Pick from the scale by role — component spacing tops out at `xl` (24); reach into the section range only to separate whole sections.

**Icon sizes** pair with the adjacent text tier — don't size icons arbitrarily:

| Token | Value | Pairs with |
|-------|-------|-----------|
| `dot` | 6px | status dots, legend swatches (not an icon — a filled indicator) |
| `icon-xs` | 12px | inline with `overline` / dense meta |
| `icon-sm` | 16px | `body` / `heading` (default UI icon) |
| `icon-md` | 20px | `section` / `title` |
| `icon-lg` | 24px | `display` / standalone |

Icon library: a single line-icon set (e.g. Lucide/Heroicons-outline) at a consistent stroke; the 14px (`size-3.5`) in-cell size is allowed only under the dense-data exemption. Brand/provider logos are sized to the adjacent text, not the icon scale.

**Containers & shell.** Content widths: `content` 1024px (standard app), `wide` 1280px (data-dense / marketing). There is **no prose/reading width** — long-form content shares its page's container. Page gutter: `px-4` mobile → `px-6` desktop. Top nav height is a fixed **56px**, but a promo/maintenance banner may sit above it. Banner awareness differs by case: **sticky/fixed top offsets** must *add* the banner's measured height — `var(--sticky-banner-top, 0px)` for sticky/scroll-margin, `var(--navbar-top, 0px)` for fixed viewport chrome (e.g. `top-[calc(56px+var(--sticky-banner-top,0px))]`); bare `top-14` overlaps the banner and is rejected by the `sticky-offsets-banner-awareness` test. **Fill-height regions** must *subtract* the banner's measured height so the region fits the remaining viewport — most full-viewport areas use `var(--navbar-top, 0px)` (e.g. `min-h-[calc(100dvh-var(--navbar-top,0px)-3.5rem)]`).

**Dense-data exemption.** Tables and other information-dense controls may use the half-step grid (e.g. 10/14px cell padding, 28/32px rows, 14px `icon` in cells) and `text-overline`-sized captions where the even-increment scale would otherwise force wasteful height. This is the *only* sanctioned departure from the scale; don't use it as a general escape hatch.

### Operational task workspaces

Mission Control pages that configure and launch durable work keep lifecycle state ahead of configuration. Lead with one current/latest-run summary containing status, progress, last activity, operator, logs, and the active cancellation action. An operator should never need to scroll through a long form to discover that work is already running.

Generic Backfills remains in the destructive utility category so its risk is communicated consistently, but it is default-pinned on the Mission Control home screen so the operational workspace is discoverable without scrolling to the final category.

Use the current/latest-run summary as the single history entry point at every breakpoint. Its “All history” action opens a right-side sheet containing every durable run for the task, newest first; do not duplicate history in a persistent page column. History rows always show status, progress, operator, time, and the runbook label or “Custom input,” and identify their association with the selected preset in text rather than by color alone.

Treat reviewed runbook presets as versioned-in-practice operational snapshots even when their current storage is code-defined. Keep the selected configuration strictly prospective: label it “Selected to run,” show the lock/editability and evidence state, and explain what Preview and Start will use. Present the runbook selector as a prominent “Run configuration” command with a taller, stronger selected value. Place “Create editable copy” directly beside that selector on desktop and immediately beneath it on mobile; it changes the selected input mode, so it belongs with selection rather than in the preset card or final Preview action row. Place the retained-evidence link beneath the right-aligned status badges with a checked-square status icon; the square indicates attached evidence and is not an editable acknowledgment control. Do not mix run counts or last-activity facts into this card; those belong exclusively to Latest run and All history. Copying values creates Custom input without changing the reviewed preset or inheriting approval.

Missing retained evidence is a production-risk state, never neutral metadata. Show a negative “No retained evidence” signal on the selected preset, repeat it in production preflight and the reviewed preview, and label Preview accordingly. Starting without evidence requires a separate explicit acknowledgment inside the preview sheet; until checked, Start remains disabled. Once acknowledged, the action is destructive-styled and names the exception (“Start without evidence”). The operation layer enforces the same gate so a presentation regression cannot bypass it.

Long operational forms are organized as bounded requirement groups, not loose fields separated only by whitespace. A multi-input requirement shows its input count in the group header and gives every input its own panel so operators can scan its structure before reading details. Do not number independent inputs as “Part X of Y”; make the field name the strongest text in each panel and put supporting field guidance in a label-adjacent info popover with a descriptive accessible name. Keep production-risk warnings and required acknowledgments inline—the popover pattern is for explanatory field guidance, not safety gates. Sequential ranges may use “Step” labels and directional connectors because their order is meaningful.

**Z-index** is a small named ladder defined in `packages/theme/index.css` — don't invent values: `z-above` (1, just above siblings) → `z-sticky` (49, sticky headers/rails, sheet backdrops) → `z-overlay` (50, page-launched dropdowns/popovers/tooltips, non-modal panes) → `z-fixed` (60, floating buttons that clear overlays) → `z-modal` (100, dialogs/sheets + scrim) → `z-alert` (105, confirmation dialogs above modals) → `z-notification` (110, toasts) → `z-popover` (1000, `FloatingPopover`) → `z-popover-overlay` (1001) → `z-popover-tooltip` (1002).

**Nested overlays.** A floater (dropdown, popover, select, tooltip) opened from *inside* a modal or sheet joins the **modal layer** (`z-modal`), and one opened from inside an alert dialog joins `z-alert`, stacking above its parent by DOM order; the `z-overlay` tier applies to floaters launched from the page. The rebrand primitives do this through the floating-layer context, so don't hand-hoist. Never blanket-hoist page-level floaters to `z-modal` to solve in-modal stacking — the hoist breaks the ladder everywhere else.

**Non-modal detail pane.** A sheet whose page must stay interactive behind it (inspector/detail panes over a table or log list) runs **scrimless — no dim at all**: any scrim, however light, signals "blocked." It keeps the opaque `popover` surface, its border and `shadow-lg`, and sits at **`z-overlay`** (not `z-modal` — nothing is blocked); it must carry its own close affordance since there's no scrim to click away.

## Elevation & Depth

Shadows are used **sparingly** — only where something **floats above the page** or needs functional lift:

- **Switch thumb** — `shadow-lg`
- **Dialog / modal** — `shadow-lg` (over a `background/60` scrim with a light `backdrop-blur-xs` (4px) — dimmed and softly frosted; the page's silhouette stays visible behind it.)
- **Toast / notification** — `shadow-lg` (they sit at the top of the z ladder and float over everything, so they take the same deep step as a dialog)
- **Popover / dropdown / hovercard / select** — `shadow-md`
- **Sticky header on scroll** — `shadow-sm` (only once content scrolls under it)
- Active segmented-control / tab segment — `shadow-sm`

**No shadows** on resting cards, buttons, or banners. Elevation between *surfaces* is communicated by the surface hierarchy (and in light mode, by borders) — shadow is reserved for elements that genuinely overlay the page, not for tonal layering.

### Motion

Motion is **restrained and functional** — it confirms a state change, never decorates. Three durations: `fast` 150ms (hover/color shifts), `base` 200ms (most enter/exit, expand/collapse), `slow` 300ms (larger overlays — sheets, dialogs). Default hover transition is `transition-colors`; reserve transform/opacity transitions for overlays and disclosure. Always honor `prefers-reduced-motion` (drop transforms, keep opacity).

## Shapes

Five radius tokens, even values only:

| Token | Value | Use |
|-------|-------|-----|
| `sm` | 4px | Small controls, active segments |
| `md` | 6px | Buttons, inputs, segmented-control track |
| `lg` | 8px | Cards |
| `xl` | 12px | Large grouped surfaces, media/image headers, feature cards |
| `full` | 9999px | Badges, pills, avatars |

Product UI tops out at `xl` (12px). Oversized radii — conversational chat bubbles, marketing flourishes (16–24px) — are a **deliberate exception scoped to those surfaces**, not new tokens; don't reach for them in app chrome.

## Components

### Focus

Every interactive element (button, link, input, control, menu item) shows the **same keyboard-focus treatment**: `border` promotes to `foreground/30` + a 3px glow (`0 0 0 3px foreground/6`), via the `--focus-border` / `--focus-shadow` tokens. Error state swaps to `--error-border` + `negative/10` glow. Focus is neutral, **not** accent-colored — it marks "where the keyboard is," distinct from the accent's "what's active/selected." Only show it for keyboard focus (`focus-visible`), not mouse clicks.

### Buttons (CTA hierarchy)

Filled accent `default` for primary actions, `outline` for secondary. Destructive variants exist for both. **No filled Ink/Cloud button** — too loud, competes with primary.

- **Primary text:** Cloud on Grape (light), Ink on Volt (dark). Destructive and promo always use Cloud.
- **Hovers:** primary → accent at `e0`; outline → `muted` bg, text promotes to `accent-foreground` (the standard hover promotion — same as links and hover rows); ghost → `accent-subtle` (`08`) bg.

**Variants:** `default` (filled accent), `outline`, `ghost`, `link` (text + underline, no chrome — follows the Links rule), `destructive`, `destructive-outline`. No tinted/"secondary" button — accent-tint means *selected/active* (badges, segments), not an action weight. A button whose job is to *select* rather than *act* is not a button variant at all — it's a toggle; see **Selection states**.

**Size scale** — `radius-md`, `text-button` (14px), `font-medium`, icon children `size-4`:

| Size | Height | Padding | Use |
|------|--------|---------|-----|
| `sm` | 32px (`h-8`) | `px-3` | dense toolbars, inline actions |
| `default` | 40px (`h-10`) | `px-4` | standard |
| `lg` | 44px (`h-11`) | `px-8` | prominent / marketing CTAs |
| `icon` | 40×40 (`h-10 w-10`) | — | icon-only (use `h-8 w-8` in dense rows) |

Add `w-full` for full-width (mobile, auth, card footers). Disabled = `opacity-50` + no pointer events (see Controls).

### Controls

Checkboxes, radios, switches, and segmented active states all use the accent — it shows what's selected/on, which is meaningful. **Don't strip it for "minimalism."** Unchecked states use `foreground/30` for visible contrast. Radio selected = `border-primary`. Toggle = `shadow-lg` thumb, `foreground/30` track when unchecked (the same unchecked treatment as every control).

**Disabled** (any control or button): `opacity-50` + `pointer-events-none`. Don't recolor — the dimmed state reads consistently in both themes.

When a control marks something *selectable* — an option card, a toggle button, a pickable row — its placement and the surface it sits on follow **Selection states** below.

### Selection states

Selection is signaled by an **explicit control**, not by surface color alone. One language at every scale — a table row, a selectable card, a toggle button:

- **Anatomy: control → content.** A leading checkbox (multi-select) or radio (single-select), **always visible** — the empty control is what tells a user the thing is selectable before they touch it, and it keeps every item's state legible without comparing neighbors (so "none selected" vs "all selected" is never ambiguous). The control is the standard 16px form control from Controls (unchecked: `foreground/30` border on `muted`; checked: accent fill + check, or the `border-primary` radio dot).
- **Selected surface: `selected-bg`** (`08` light / `0a` dark) — a neutral wash one step above `card-hover`. The border does **not** change, and the surface is never accent-tinted: the accent lives only in the 16px control. An accent-tinted surface at card scale reads as decoration, and a set of them reads as a wall of CTAs.
- **Hover stays neutral `card-hover`** — hover is never the selected treatment.

**Selectable card** — a plain `Card` (`bg-card`, `border`): leading checkbox, then the identity block (mark → name → meta). Selected → `selected-bg`; nothing else changes.

**Toggle button** — the `sm` button chassis (`h-8 px-3`, `radius-md`, `text-button` `font-medium`) with the leading checkbox baked in. Off: the outline idiom — `border-input`, `bg-background`, `muted-foreground` label, hover `card-hover` + the standard text promotion. On: `selected-bg`, `foreground` label; border unchanged. **Never render a selected toggle as a filled-accent button** — with every option on, the row is indistinguishable from a row of primary CTAs.

**Selection vs navigation.** This language covers *choosing things* — filters, option cards, pickable rows. *Being somewhere* — the active sidebar item, menu row, tab, segment — keeps its accent-tint active treatment (see Hover row): navigation marks exactly one current location, so the all-selected ambiguity can't arise there.

### Avatars

`rounded-full`, **opaque `background` base** with a `bg-muted` fallback tint on top. The opaque base matters: avatars are discrete objects that **overlap** (groups), so a translucent fill would let the avatar behind show through — same rule as floating surfaces, *anything that can overlap needs an opaque base*. Size by context — pair with the adjacent text tier like icons:

| Size | Value | Use |
|------|-------|-----|
| `sm` | 20px (`size-5`) | inline with body / dense rows |
| `md` | 24px (`size-6`) | list rows, cards |
| `lg` | 32px (`size-8`) | headers, detail |
| `xl` | 40px (`size-10`) | profile / standalone |
| `2xl` | 64px (`size-16`) | hero / preview — profile-edit dialogs, account headers, upload previews |

- **Framed** (on busy/image backgrounds): `ring-2 ring-border/50`. **Logo frame** (third-party provider/vendor marks in lists): opaque `background` base + `ring-1 ring-border/60`, `radius-sm` — vendor glyphs aren't theme-calibrated, so the frame guarantees contrast in both themes; third-party app favicons (`IconFrame variant='app'`) additionally switch the dark-theme ring to a solid white hairline that hugs the artwork. **Bare** (first-party glyphs and entity marks with token fills): no ring or bg — just the glyph. No resting shadow on any of the three.
- **Group** (overlapping stack): per-item `-me-2 last:me-0` with a `ring-2 ring-background` on each to punch them apart.

### Badge variants

All badges are `font-medium` (w500), `overline` size (12px), `rounded-full`.

| Variant | Style |
|---------|-------|
| `default` | accent bg + `primary-foreground` (CTA badges) |
| `secondary` | accent-tinted bg (selected/active only) |
| `outline` | border only, neutral text (display values) |
| `destructive` | destructive bg |
| `positive` / `negative` / `warning` / `info` / `promo` | status `-text` color for the label + display color at `/12` bg + `/14` border (the status text split — translucent vibrant wash, colored AA letters; the `-text` values are tuned to pass even on washes up to `/25`, so the alpha has headroom). Status badge backgrounds use the direct display color, not the global `-bg` token. |

A **Chip** is the removable/interactive cousin of a badge — a neutral `muted` fill, `rounded-md`, `body` text in `muted-foreground`, `card-hover` on hover, with an optional trailing `×` (ghost, `size-5`, fades in on hover). Use for active filters, multi-select tokens, and dismissible tags. (A *badge* labels/displays; a *chip* is removable or selectable.)

### Inputs

- **Default:** `border-input` (14 opacity).
- **Focus:** `border` at `foreground/30` + shadow glow `0 0 0 3px foreground/6`.
- **Error:** `border-negative` + shadow glow `0 0 0 3px negative/10`.
- Checkbox/radio unfilled: `muted` fill + `input` stroke.

### Tables & data display

**Row states.** Hover: `card-hover` bg (the neutral hover, same as every hover surface and action row — see Hover row). Selected: `selected-bg` (`08` light / `0a` dark) — the row's checkbox/control carries the explicit selected signal per **Selection states**; no accent bar or other ornament. Disabled/dimmed: `opacity-50`. Header row: `muted-foreground`, `overline` or `body` size. Dense tables use the dense-data exemption (10/14px cell padding, 28/32px rows).

**Numbers.** Always `tabular-nums` for any aligned/column numeric value, right-aligned in tables. This is **load-bearing, not cosmetic**: Jakarta's default digits are strongly proportional (a `1` is roughly half the width of a `0`), so an unaligned digit column looks visibly ragged — the font ships full `tnum` and the utility activates it. The theme root (`<body>`) also carries `tabular-nums` so portals (tooltips, popovers) inherit aligned digits; the per-element utility stays on aligned columns regardless. Numbers, IDs, hashes, and model slugs render in **Jakarta — never mono** (mono is reserved for code & secrets below). Abbreviate large counts (`1.2M`, `128K`); render a unit suffix in `muted-foreground` (`24 ` + `tok`), value in `foreground`.

**Truncation & empty.** Single-line values `truncate` (with a tooltip when overflowed); multi-line `line-clamp-2`. An empty/placeholder value is `text-faint`, often italic (`No description`) — never a blank cell.

**Code & secrets.** The **only** home of `font-mono` in the system, plus one affordance: **`kbd`/shortcut chips keep mono** (they render input literals, and mono is the established affordance). Inline code: `font-mono`, `card-hover` bg, no border, `foreground` text. Code *blocks*: `font-mono` on `doc-surface` (the reading-surface token) — **never** a hardcoded `#fafafa`/`#282c34`; syntax-highlight hues come from the `chart-*`/status palette, not new colors. A masked secret (`sk-or-…`) is `font-mono` at `muted-foreground`. Anything that is *about* code but isn't code — a model slug in a table, a finish reason, a request ID, a mime type — is Jakarta.

**Shared components with a mono prop** (`isMono`, `tone="mono"`): migrate the *call sites*, not the primitive. The primitive keeps its mono capability for whitelist survivors (masked keys); a primitive that *hardcodes* mono internally moves it behind a prop. Deleting mono from a shared cell component silently breaks legitimate uses on other pages.

**Dividers.** `Separator` / row borders use `border` at default; for *internal* sub-divisions within a card or list use `border/50` (lighter). Section rules in long-form get `my-4` vertical rhythm.

### Loading & skeleton

Loading is **shape-preserving**, not a spinner-over-blank: render skeleton placeholders that match the real layout. Skeleton fill = `muted`, `animate-pulse`, the same radius as the element it stands in (`full` for avatars/pills, `md` for blocks). For multi-row lists/tables, keep the column layout and stagger row animation (~50ms each). Use an inline spinner (`LoadingDots` / a spinning glyph in `muted-foreground`) only for in-button or tiny-region waits — never a full-page spinner where a skeleton fits.

### Destructive confirmation

Irreversible actions confirm in a dialog (`AlertDialog`): a `negative` framing (warning glyph + what's lost), then **Cancel (`outline`) on the left, Confirm (`destructive`) on the right**. The confirm button names the action ("Delete workspace"), never just "OK." Don't use a plain `default` accent button to confirm a destructive action.

### Full-page states (error / 404 / empty)

A whole-screen error, 404, or first-run empty state is the empty-state composition scaled to the viewport: **centered** in a `min-h-dvh` region, content capped at `max-w-md`, vertically stacked with `lg` gaps. A medallion icon (`icon-lg` in a `size-10`+ `muted` rounded container) → a `section`/`title` heading → `body` `muted-foreground` explanation → one primary action (`Button`) + an optional neutral link. **404/error**: neutral framing — *not* a red error screen (reserve `negative` for the icon or a small label, not the whole page). Keep the global nav/footer; only the content region swaps.

### CTA card

The "Ready to get started?" card — a self-contained card inviting one action, wherever it appears: often closing a marketing or content page, but also mid-page conversion moments, a docs "Next steps", a product "Create your first key". It is **not an empty state** (it doesn't stand in for missing content) and **not a banner** (nothing to announce or dismiss) — it's an invitation, and the skin is deliberately quiet: **`card` bg + standard `border`**, `rounded-xl`, a centered vertical stack at `px-6 py-8` (`md:py-10`) — roomier than a content card, but not a hero.

Anatomy: heading (`title` tier — Gordita on marketing surfaces; product pages may drop to `section` in Jakarta) → one `body` line in `muted-foreground` → the action row: **one primary accent `Button`** (`lg` on marketing) plus an optional neutral secondary (link or `outline`). The accent button is the card's **only** color — never tint the card surface (accent, promo, or status): a tinted CTA card fights "one accent per view" and reads as a callout instead of an invitation. No icon medallion (that's the empty state's mark), no dismiss.

### Links

The underline is always a **low-opacity tint of the link's own color** (`decoration-current/40`), so it derives automatically whether the link is neutral or colored — a neutral link gets a neutral underline, an `info`/`positive`/CTA-colored link gets a matching one. On hover the underline promotes to full (`hover:decoration-current`).

- **Default:** text in its color, `underline`, `underline-offset-2`, `decoration-current/40`.
- **Hover:** `decoration-current` (full). A *neutral* link also promotes its text to `accent-foreground` (and `currentColor` carries the underline with it); a colored link keeps its color.
- **Never** `text-primary` for repeated/dense links (tables, lists) — those stay neutral.

### Segmented control

Track: `muted` bg, `border`, `rounded-md`, `p-0.5`. All segments `font-medium` (Nav weight rule). Inactive segment: `muted-foreground`, hover → `accent-foreground` (the standard hover promotion — same as links, tabs, and hover rows). Active segment: `background` bg, `accent-foreground` text, `shadow-sm`, `rounded-sm`. Use for theme switchers, view toggles, compact tab-like selections. **Segmented tabs** (a tablist that switches content *panels*) wear the identical skin — same track, segment, and hover values; the only difference is semantics (tabs drive panels, a segmented control picks a value).

### Button group

A row (or column) of buttons fused into one control: shared variant (usually `outline`), inner corners squared and inner borders collapsed so they read as segments (`first`/`last` keep the outer radius). Use for related actions or a multi-state toggle that's heavier than a segmented control. An optional leading `muted` label cap (`rounded-md border bg-muted px-4 text-button muted-foreground`) prefixes the group.

### Accordion

Collapsible disclosure: each item is `border-b border-border`; the trigger is a full-width row (`py-3`, `body` at the Nav weight `font-medium` — a marketing FAQ accordion may step up to `section` size, per Tier assignments) with a trailing `icon-sm` chevron in `muted-foreground` that rotates on open (`transition-transform`, `base` duration); content is `body`, animates open/closed. Same focus ring as everything. Use for FAQs, advanced/optional settings, long option lists — not for primary navigation.

### Banner / toast

Background: status color at `14` (the `-bg` tokens). Border: status color at `30` (via `color-mix`) — same as Alert; see "Alert vs. banner" below. CTA text matches the status color, **not** the accent.

**Neutral banner** — the **default** for any banner with no status meaning (orientation, onboarding, "how this page works", info-without-status): `muted` bg + standard `border`, same anatomy as a status banner — leading `icon-sm` in `muted-foreground`, optional `font-medium` title in `foreground`, `body` copy in `muted-foreground`, and the **same underlined link CTA as every other banner** — just in `foreground` instead of a status color (never accent). When in doubt about a banner's flavor, it's neutral.

**Toasts** are the transient form: an opaque `popover` surface (they float — see surfaces), bottom-right stack on desktop / top on mobile, `z-notification`. Auto-dismiss ~5s (longer if they carry an action); errors persist until dismissed. Enter/exit at `base` (200ms).

**Callout flavor.** A non-status callout defaults to **neutral** (the neutral banner above). The only colored exception is **promotional**: announcing a launch, upgrade, or "New" uses **Royal** (`promo`). There is **no accent-tinted callout** — accent tint on a surface is the *selected-state* treatment, so painting it on a banner reads as selection, not information. Status banners always win — promo applies only when there's no positive/negative/warning/info meaning to convey; everything else is neutral.

**Alert vs. banner — same skin, different scope.** Both are bordered blocks (`rounded-lg`, `px-4 py-3`; status `-bg` + `/30` border, or the neutral `muted` + `border` skin; a leading `icon-sm` in the status color or `muted-foreground`, `body` text, optional title in `font-medium`). The leading icon is **top-aligned** (`items-start` + a small `mt-0.5` nudge), never vertically centered — so the icon sits with the first line of the title and the block reads consistently whether the text wraps to one line or three. This holds for both Alert and Banner. The **trailing CTA / dismiss is the opposite: vertically centered** (`self-center`) against the whole block — it acts on the banner, not its first line, so anchoring it to the top of a multi-line banner reads unmoored. The difference between the two is *placement*: an **Alert** is **contextual and inline** — it sits inside a form/section to speak to nearby content. A **Banner** is **page- or section-level** — full-width, often pinned at the top of a region, frequently with a dismiss `×` and a CTA. Same visual language, so an agent picks by where it lives, not by restyling.

### Calendar / date picker

A calendar is a **selectable grid** — day cells follow the standing hover and selection conventions, not custom styling. Rest hover on a day is neutral `card-hover` (hover is never the selected treatment); a **selected day** takes the standard selected tint — `accent` (`14`) with `accent-foreground` text. A **range** fills its interior days with `accent-subtle` (`08`) and keeps the two endpoints on the full `accent` tint so they read as the anchors. **Today is wayfinding, not selection**: mark it with a `ring-1 ring-border` on the cell — never the accent tint, which would read as selected. Weekday headers are `overline` (12px/500, `muted-foreground`); day numbers are `body` with `tabular-nums`; outside-month and disabled days drop to `text-faint`. Keyboard focus uses the standard neutral focus tokens (`--focus-border`/`--focus-shadow`), same as every control.

### Composition recipes

These aren't new primitives — they're the canonical way to assemble the ones above. Defined here so the recipe isn't re-guessed each time:

- **Form field** — a vertical stack (`gap-1.5`): `Label` → control → help/error line. Help text is `body` `text-faint`; error is `body` `negative` with a leading `icon-xs`. (The control's own focus/error treatment comes from Inputs.)
- **Settings row** — `flex items-center gap-4`, `px-4 py-3.5`: optional leading `size-8` `muted` icon medallion → title (`body` `font-medium`) + description (`body` `text-faint`) in a `flex-1` column → trailing control (switch/button). Stack these divided by `border/50` inside a card.
- **Stat / KPI card** — flat `Card`, `p-3`: label (`body` `muted-foreground`, Jakarta) + optional delta, the value as a big number (`section` size at weight 500, or `display`/`hero` at 700; always `tabular-nums`; `.font-brand` Gordita at `display` size and up — the "headline number", and only when it's the view's single headline, not one of a grid), and an optional sparkline beneath (chart palette, status color only if it encodes good/bad).
- **Model / entity card** — `Card`, hover `card-hover` when interactive: header row = `icon-md` mark + name (`heading` `font-semibold`) + provider byline (`body` `text-faint`), with a hover-revealed `↗`; a metric row beneath using `overline` uppercase labels + `body` values.
- **Code block** — `font-mono` on `doc-surface` (or `card`) inside a `rounded-lg border`, with an optional header strip (`h-9`, `overline` filename + copy button) and a `body`/`overline` body; syntax hues from the `chart-*`/status palette. Inline code and masked secrets follow Tables → *Code & secrets*.
- **Hover row** — a list row that is the hover convention made reusable: `rounded-md`, `px-4 py-2.5`, `body` (14px) `font-medium` (the Nav weight rule — rest and active alike); rest `muted-foreground`; **hover (rest→hover) → neutral `card-hover` bg + `accent-foreground` text** (the text promotion is the interactivity cue — the wash stays quiet); **active (the current nav location / current value) → accent-tint `accent` (`14`) bg + `accent-foreground`**. This is the single primitive behind sidebar nav items, **dropdown / menu rows (incl. the profile & org-switcher menu)**, and select options — they are the *same* row at the *same* `body` size, not a larger variant. Two rulings that are routinely gotten wrong: **(1) hover is neutral, active is accent** — painting `accent` (`14`) bg on plain hover wrongly applies the active-state treatment to hover; **(2) a menu row is `body` (14px)**, matching the sidebar — don't bump it above `body` just because it's in a dropdown. The accent-tint active treatment is *navigation* language; rows the user **selects** (multi-select lists, pickable options) follow **Selection states** — neutral `selected-bg` + an explicit control — instead.

### Logo

Glyph: `fill-primary` (accent — Grape light / Volt dark). Wordmark: `fill-foreground` (neutral). Four marks: Glyph, Wordmark, Horizontal, Stacked.

### Portal theming

Radix portals (Popover, Dialog, DropdownMenu) render outside the `.rebrand-theme` wrapper. The theme class is added to `document.body` via `useEffect` so portals inherit the CSS custom properties.

## Do's and Don'ts

**Do**

- Swap the accent per theme — Grape in light, Volt in dark. Never cross them.
- Use the accent for interaction and *singular* emphasis (one focal point per view) — see Accent usage.
- Derive every tint from the opacity scale.
- Carry structure with borders in light mode (surfaces read the same to the eye).
- Pair line-height with font size.
- Use Royal for info status and promotional callouts (`promo`). Coral is a marketing-only brand accent — deprecated in product UI. Chart series come from the `chart-*` palettes, never brand colors.
- Use even pixel values everywhere.

**Don't**

- Don't use the accent on *repeated* data (table cells, per-row values, dense links) or chart fills — use `foreground`, status, or the `chart-*` palette. (Singular emphasis is fine — see Accent usage.)
- Don't add a filled Ink/Cloud button — it competes with primary.
- Don't put shadows on cards, buttons, or banners.
- Don't introduce custom hex outside the six brand colors and the status colors — with one exception: **third-party vendor/provider logos** (Google, OpenAI, MetaMask, OAuth provider glyphs, etc.) keep their own brand colors. A vendor mark is identity, not UI color, so its hex is exempt from the palette; the surrounding chrome (frame, label, hover) still uses tokens. This applies only to the logo glyph itself — don't use it to justify off-palette hex anywhere else. The same logic extends to **embedded third-party widgets** (payment fields, password-manager save buttons, auth widgets): chrome the vendor renders is exempt — we can't token it. Requirements: use the vendor's theming hooks (at minimum match light/dark) where offered; keep the surrounding layout, labels, and spacing on tokens; and if the vendor allows full styling, build it natively instead of accepting their default skin.
- Don't rely on the light-mode surface shift for hierarchy.
- Don't use `text-primary` for repeated/dense links.
- Don't mark selection with accent surfaces — no accent-tinted selected cards, no filled-accent toggle buttons. Selection = neutral `selected-bg` + an explicit leading control (see Selection states).
