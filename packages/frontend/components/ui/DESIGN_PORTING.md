# Porting the design system into a host repo

The rules in the root [`DESIGN.md`](../../../../DESIGN.md) are host-agnostic. This file is the mechanics of installing them in a repo with an existing token system, plus the per-page checklist for pages written before the current two-family type system. Written against openrouter-web (`packages/theme/index.css`, hsl-channel tokens, Tailwind `@theme`), but the traps generalize. None of this is a design rule: if it disagrees with `DESIGN.md`, `DESIGN.md` wins.

## Installing the tokens

**1. Tokens are complete CSS colors — kill the `hsl(var())` wrappers.** Every rebrand token is a full color value, most with alpha baked in (`--border: #03080A14`). Host systems that store bare HSL channels (`--background: 0 0% 100%`) and wrap consumption in `hsl(var(--…))` **cannot hold these values** — `hsl(#03080A14)` is invalid and fails silently. Porting means: token _values_ replace the channel triplets, and every `hsl(var(` wrapper goes — in the theme CSS **and** in TS/SVG props (`grep -r "hsl(var(" --include="*.ts*"` before swapping; chart axis props are a known instance).

**2. Chart end-state: keep the TS constants; add the CSS tokens beside them.** The existing `defaultColors` and `OVERVIEW_CHART_COLORS` are hex-identical to `chart-1..20` and the role tokens by construction — so **the TS constants remain the source of truth for SVG props** (zero chart-code churn; a `useChartColors`-style hook is only needed where a value is theme-_dependent_, i.e. the status/neutral keys). Add the `--chart-*` CSS custom properties alongside for className/CSS contexts (identity chips, legend dots). Do **not** port a sandbox hook wholesale or rewrite working chart imports — that's motion, not migration.

**3. Theme scoping: the invariant, not the mechanism.** The requirement is that the token custom properties **and** the font variable classes are in scope at `document.body` (portals mount there). A sandbox can satisfy it with a `.rebrand-theme` wrapper + a `PortalTheme` shim; a host adopting the system app-wide should instead define tokens at `:root`/`.dark` and put font variable classes on `<body>` — openrouter-web already does the latter (`projects/web/app/layout.tsx`), in which case **no portal shim is needed**.

**4. The utility layer.** The recipes assume these custom properties exist (canonical source: [`theme.css`](./theme.css) in this directory): `--text-{hero,display,title,section,heading,prose,body,button,overline}`, `--radius-{sm,md,lg,xl,full}`, `--focus-border`/`--focus-shadow`/`--error-border`/`--error-shadow`, and the extended surface tokens (`--surface`, `--card-hover`, `--selected-bg`, `--input-bg`, `--text-faint`, `--accent-{subtle,border,hover}`, `--doc-surface`, `--text-prose-body`, status `--*-bg` pairs, status `--*-text` tokens). Port the names as-is — renaming forks the recipes.

**5. Fonts.** Jakarta: `next/font/google` `Plus_Jakarta_Sans` (variable — no `weight` option). Gordita: a **licensed** commercial face — the woff2 set must be procured/copied (weights 100–950 under `public/fonts/gordita/`); until it's available, `.font-brand` falling back to Jakarta 700 is the sanctioned degraded state (the system stays coherent, just quieter).

**6. `tabular-nums` at the theme root.** Set `font-variant-numeric: tabular-nums` on the theme root (`body` when adopted app-wide) rather than per-column: an equivalent on `<main>` is not enough, because portals render outside `<main>` — numeric tooltips and popovers silently lose digit alignment. Root-level placement covers them; Jakarta's proportional defaults make this load-bearing (see `DESIGN.md` → Tables & data display → Numbers).

## Migrating a page from the single-font (all-Gordita) era

1. Do nothing for body/UI text — the theme default already flipped it to Jakarta.
2. Add `font-brand` to the page `h1` and to display-size stat values. Nothing else (marketing surfaces excepted — see `DESIGN.md` → Brand voice vs interface).
3. Delete every `font-mono` that isn't a code block, inline code, or masked secret. Where the deleted mono sat on an aligned digit column, add `tabular-nums` in its place — mono was silently providing the alignment.
4. Chart code: replace `chartN` keys from the old `useChartColors()` shape with `categorical[N-1]`, and move metric-bound series (cost, requests, token kinds) to their semantic role keys.

## Migrating legacy Radix color utilities

See [`RADIX_TO_SEMANTIC_MAP.md`](./RADIX_TO_SEMANTIC_MAP.md) for the step-by-step map. Components that still only have a legacy implementation live in this same directory next to the rebrand primitives.
