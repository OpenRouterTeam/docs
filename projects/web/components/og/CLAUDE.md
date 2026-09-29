# OG card agent instructions

Building or editing an OpenGraph card in this folder (or any `opengraph-image.tsx`).
Read this first. It exists so OG cards match the design system instead of drifting
into raw Tailwind grays. It names the exact components, colors, type, and spacing a
card must use so the shipped card matches the design (prototype:
`/canvas/xzyecg/model-og-card`).

## The one thing that trips everyone up

These cards render through **Satori** (`next/og` `ImageResponse`), not a browser.
Satori **cannot read CSS variables**. `text-foreground`, `bg-card`, `var(--border)`
all resolve to nothing or to a Satori default — the card silently renders with the
wrong color. So in OG files the design tokens must be written as **literal hex
values**, copied from the table below (source of truth: root `DESIGN.md`).

This is the opposite of the rest of the app, where you must use token classes and
never hardcode hex. OG files are the documented exception.

## Colors — use these hex values (light mode)

| Role | Hex | Where |
|------|-----|-------|
| Background | `#FCFCFE` | card surface |
| Foreground (text, numbers) | `#03080A` | model name, stat values |
| Muted foreground (labels, meta) | `#03080Ab0` | `CONTEXT` / `INPUT` labels, "Released …" |
| Faint | `#03080A70` | `openrouter.ai` url, `/M` unit |
| Border | `#03080A14` | tile stroke *(see note)* |
| Tile fill | `#FFFFFF` | pricing tiles on the `#FCFCFE` card |
| Grape (accent) | `#7624F4` | brand glyph only — see accent rule |
| Positive text | `#007544` | status badge label |
| Positive tint | `#00BF6F14` | status badge background |
| Positive border | `#00BF6F20` | status badge border |

**Never** use `text-gray-600`, `text-gray-900`, `bg-gray-*` or any raw Tailwind gray.
Every one of those maps to a hex above.

Status badges follow DESIGN.md's tint-background plus status-text treatment; never use
an opaque fill.

**Border note:** DESIGN.md's `border` token is `#03080A14` (8% Ink). At 1× on screen
that hairline is correct, but OG images get downscaled and JPEG-recompressed by
X/LinkedIn and it nearly vanishes. For OG only, bump to **`#03080A24`** (~14%) so the
stroke survives. This is a medium-specific override, not a token change.

**Accent rule:** Grape (`#7624F4`) marks exactly one thing — the brand glyph in the
logo lockup. Do **not** tint the pricing tiles, labels, or borders with Grape. Repeated
data stays neutral; the accent loses meaning the moment it appears more than once.

## Typography — only three faces load

`getOgFonts()` loads **exactly** these; no other weight exists in the renderer:

- **Gordita Bold (700)** — model name + stat values. `style={{ fontFamily: 'Gordita' }}`.
- **Plus Jakarta Sans 400** — labels, suffixes, "Released …", url. (default `fontFamily`)
- **Plus Jakarta Sans 700** — bold inline emphasis.

Do not request Gordita Medium/Regular or Jakarta 500/600 — they won't render and Satori
falls back silently. Set the container `fontFamily: '"Plus Jakarta Sans"'` and opt into
Gordita per-element for display text.

Sizes: name ~72px Gordita/700; stat value ~52px Gordita/700; labels 15px
Jakarta 400 uppercase with `letter-spacing`; meta ~20–22px Jakarta.

Stat values and pricing suffixes share a flex `baseline`. Satori aligns the
suffix using its line box rather than the visible glyph baseline, so the 18px
suffix uses `line-height: 1.6` to seat flat letters (`M`, `m`, `e`) on the
stat-value baseline. Do not replace this with `alignItems: 'center'` or a
positional transform.

**Don't clip descenders.** The model name uses a tight
`letter-spacing` and one-line clamp. Two traps:

- **`line-height: 1` clips descenders** — the "g" in "Large", "p" in "Opus", any
  `g/j/p/q/y` gets its tail cut off by the line box. Set the name's
  `line-height` to **1.2** and add symmetric vertical padding (~`0.16em` top and
  bottom) so the clamp/overflow box doesn't shave the tail. Never use a
  bottom-only guard: it makes the centered provider mark sit low.
- **One-line clamp needs the trio together:** `whiteSpace: 'nowrap'` +
  `overflow: 'hidden'` + `textOverflow: 'ellipsis'`. Long names ellipsize, they
  don't wrap. Verify with a long name (e.g. "Llama 4 Maverick", "Mistral Large 3").

## Spacing & shape

- Card padding: **64px** (`p-16`) on all sides. Keep it.
- Tile radius: **`--radius-lg` = 8px** — write `borderRadius: 8`. (Not 12/`--radius-xl`.)
- **Satori has no flex `gap`.** `gap-*` classes are ignored. Space children with explicit
  `margin`/`padding` (e.g. tile row uses `mr-*` on each tile, not `gap`).
- Provider mark tile: 64×64, radius 8, on the provider's own brand background; add a
  `#03080A14` hairline only when the tile is white so it doesn't merge into the card.

## Content rules

- **One line for the name.** Use `short_name` / `formatModelName`, clamp to one line,
  drop the author-slug line. Long names shrink the font, they don't wrap.
- **Drop the author name** (keep the provider mark).
- Promote **Context / Input / Output** into three boxed tiles (label over big value).
- **Released date** sits under the tiles (Jakarta, muted-foreground).
- When a model has no pricing, **drop the tile** — never render `$0`.

## Logo

Use `<OpenRouterBrandLogo glyphFill="#7624F4" wordmarkFill="#03080a" height={44} />`.
It's an inline SVG (Satori can't fetch external logo files reliably). Two-tone is
correct: Grape glyph + Ink wordmark. Never single-color it.

## Before you finish

- [ ] No `var(--*)` and no raw `gray-*` anywhere in the OG file.
- [ ] Every color is a hex from the table above.
- [ ] Only Gordita 700 / Jakarta 400 / Jakarta 700 referenced.
- [ ] Small eyebrows, tile labels, and pricing suffixes use Jakarta 400; hierarchy
      comes from size, tracking, and color rather than a heavier unavailable weight.
- [ ] `gap-*` replaced with margin/padding.
- [ ] Name `line-height: 1.2` with symmetric vertical padding — no clipped
      descenders (test a name with a g/p/y, e.g. "Mistral Large 3").
- [ ] Long name ellipsizes on one line (nowrap + overflow hidden + ellipsis),
      doesn't wrap or overflow the card.
- [ ] Rendered the PNG at full 1200×630 and eyeballed it — borders visible,
      name on one line, marks legible on their tiles, nothing clipped at the
      right edge or bottom.

## Dark variant (if/when added)

Swap by role, don't invent: bg `#03080A`, foreground `#FCFCFE`, muted-foreground
`#FCFCFEa0`, border `#FCFCFE14` (→ `#FCFCFE24` for OG), accent flips Grape→Volt
`#C8FF00`, logo `glyphFill="#C8FF00" wordmarkFill="#FCFCFE"`. Grape never appears in
dark; Volt never appears in light.

## Components & sources this design uses

So an agent knows exactly what to reuse vs. rebuild:

| Piece | Source of truth | Notes |
|-------|-----------------|-------|
| Brand logo | `components/og/OpenRouterBrandLogo.tsx` | Inline SVG, two-tone. Reuse as-is. |
| Provider mark | `getAuthorImageAbsoluteURL()` via the shared author icon map | Reuse the local or favicon mark returned by the existing author-icon source. Color marks use the neutral white tile (with the OG hairline); pale tints are allowed only as backdrops. Monochrome-dark glyphs (OpenAI, xAI) use a black tile and an inverted mark when the rendered output confirms legibility. |
| Color tokens | root `DESIGN.md` (Colors table) | Hex only — Satori can't read the CSS vars. |
| Fonts | `getOgFonts()` in `utils/fonts/server` | Gordita 700, Jakarta 400/700 only. |
| Pricing shape | `deriveInlinePricing()` / `DisplayPricingItem` | Same data the on-page pricing uses. |

**Type sizes as prototyped:** name 72px Gordita/700 with `line-height: 1.2`
and symmetric vertical padding (~`0.16em`); stat value ~52px Gordita/700; labels
15px Jakarta/400 uppercase; meta 20–22px Jakarta.

Author (`/anthropic`) and provider pages keep their existing OG implementations.
Model-card provider fixtures are not evidence about those routes.

## Handoff (make this part of every design handoff)

A preview alone is not a handoff. When you share a canvas/design for implementation,
the recipient must also get the instructions — the *how*, not just the *what*.

**Process:**

1. Prototype in the canvas against real DS tokens/components (not approximations).
2. Write an instructions file like this one — name the components, the exact token
   hexes, the renderer constraints, and a pre-ship checklist.
3. Share **both** together: the preview link **and** a way to download this markdown.
   In the canvas, that means the Share/Preview view exposes the instructions file for
   download next to the artboard, so whoever opens the preview can grab the spec in one
   click and hand it straight to their agent.
4. The agent reads the markdown, builds against it, and runs the checklist.

The point: the analysis of *how* the design is built (which this file captures for the
OG card) travels with the preview, so implementation matches design without a meeting.
