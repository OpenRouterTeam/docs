---
name: viz
description: The color and chrome law for every chart, diagram, and data illustration we produce — slide assets, marketing images, HTML explainers, product charts. Covers which palette a series draws from, how axes and gridlines are painted, the sanctioned fill opacities, and how to emphasize a point without recoloring it. Use before drawing anything with a series, an axis, a node, or a connector, and when reviewing a visual for brand correctness.
argument-hint: '[what you are drawing, e.g. "cost vs intelligence scatter" or "request lifecycle diagram"]'
last-reviewed: 2026-08-06
---

# Viz — Color and Chrome Law for Charts, Diagrams, Illustrations

The spec is openrouter-web's root `DESIGN.md`, sections **Data viz**, **Entity identity**, and **Modality identity**. It is the single source of truth and it wins over this file. This skill exists because that document is long, its chart rules sit deep inside it, and the failures below happen when a visual is drawn without reading them.

**Read the Data viz section before drawing.** Not the token block, the prose. The token list tells you which hexes exist; the prose tells you which one a given series is allowed to use.

## The four failures this prevents

Every one of these has shipped. They are the reason this skill exists.

1. **Axes and frames in near-black.** Chart chrome is neutral, never `#000`, never an invented gray.
2. **The accent used as a data fill.** Grape and Volt signal interaction. A product-style series is never accent-colored, not even the one series the slide is about.
3. **Emphasis by recoloring.** Highlighting a point by switching it to the accent breaks both rules at once. Emphasis is opacity, a ring, and a label.
4. **Invented fill alphas.** A number that "looked about right" instead of the sanctioned value.

## Choosing a series color

Ask what the series *is*, in this order. Stop at the first match.

1. **Is it one of the named metrics?** Cost, requests, prompt or completion or reasoning tokens, cached or uncached tokens, credits, BYOK, session-length steps. Then it uses that metric's **semantic role token**. A metric keeps its color on every surface, so cost is the same color in a deck as it is in the product.
2. **Does it encode good, bad, or caution?** Uptime health, a budget over its threshold, an error rate. Then, and only then, a **status color**. Status colors are never generic series colors.
3. **Is it an identifiable entity?** A model, provider, app, author. Then a **categorical slot**, assigned by stable hash so the entity keeps its color across filters, queries, and surfaces. A curated pinned map is fine as long as every hue comes from the twenty and the map is stable app-wide.
4. **Is it a modality?** Fixed assignments, never hash-picked, and never carried by color alone. Always with the icon and a visible label or tooltip.
5. **Anything else, genuinely anonymous series.** Sequential cycling through the categorical slots.
6. **Is it the aggregate "other" or "rest of" bucket, or a flat no-change sparkline?** The slate uncached-tokens role. That is the sanctioned neutral series color.

**Never** the accent, in either theme, for any of these. **Never** a hex that is not in the spec.

## Chrome, the non-series parts

- **Axis ticks, tick labels, axis titles** — the muted foreground token.
- **Axis lines, tick marks, gridlines, reference lines** — the border token.
- **Gridlines are dashed and quiet.** The product reference uses a three-on-three dash.
- **Chart micro-type** — the twelve pixel overline size for ticks, legend rows, and tooltip labels. Chart chrome takes the dense-data exemption; do not go below twelve.

In a deck or an exported asset these come from the rebrand tokens. In a Recharts context they come from the chart-colors hook's neutral keys, because Recharts sets SVG attributes in a way that makes custom-property resolution unreliable. Hand-authored drawing markup must put paint tokens in stylesheet declarations, not directly on presentation attributes. The capture browser resolves the attribute form, but other renderers do not consistently do so, and `DESIGN.md` records that it does not resolve where our charts are built. The stylesheet path behaves consistently across the renderers these assets pass through.

Token syntax follows the source stylesheet. Chart tokens and extended tokens such as `--text-faint` are complete colors and must be used bare. HSL component tokens, including `--background`, `--foreground`, `--muted-foreground`, `--border`, `--primary`, and `--accent`, must be wrapped as `hsl(var(--token))`. The harness injects the product's Geist Mono face as `var(--font-mono)`, which is allowed for chart micro-type and code labels alongside the injected brand sans.

## Source line

Charts and marketing assets carry exactly one `data-viz-source` element whose text begins with `Source: ` and has non-empty text after the prefix. Place it at the bottom-left of the frame in chart micro-type at twelve pixels, using `hsl(var(--muted-foreground))` declared in the stylesheet. Diagrams are exempt because they carry no data, but a diagram may include one source line and it must follow the same shape. A chart or marketing asset with genuinely no external source must declare `data-viz-source-exception` and a non-empty `data-viz-source-exception-reason` on the root `<html>` element instead.

## Fill opacity, the only sanctioned values

- **Area chart** — a **gradient** from the series color to transparent. The sanctioned top-stop values are twelve percent for a dense product chart or thirty-five percent for a single-series hero. The bottom stop is zero. It is a fade, not a flat wash.
- **Stacked or banded areas** — the exception, because a fade makes overlapping bands unreadable. Flat fill at forty percent with a full-opacity stroke on the band's top edge.
- **Identity surfaces** — chip background twelve, border twenty, hover wash four.

No other alphas. The allowlist is discrete, not a range. Nearby values in production components are drift, not additional sanctioned levels. Use the nearest sanctioned step or declare an explicit exception when a missing level is required. Slash alpha in a component color value is the same quantity as opacity and uses the same discrete allowlist; moving it from an opacity property into `hsl(... / alpha)` does not create a new sanctioned level. A stylesheet exception carried by a class applies only when every element carrying that class declares the exception and its reason; shared classes with an unmarked element are not exempt.

## Emphasis without recoloring

The rankings scatter is the reference implementation. Copy its mechanics.

- **Dim the context, do not brighten the subject.** Points outside the focus set drop to roughly a quarter opacity while keeping their own identity color. Focus points stay at full. Hovering a point takes it to full and pushes the rest down further.
- **Rings, not repaints.** A pinned point is a filled dot at its identity color, ringed in the same color at partial opacity, with a background-colored stroke separating it from what is behind.
- **Labels are neutral by default.** Entity labels use the foreground token at the chart micro-type size, medium weight. A value label in a multi-point progression may take the semantic role color of the point it labels because it carries that point's value, not an independent identity.
- **Connectors and frontier lines are neutral.** The Pareto frontier is a muted-foreground polyline, two wide, finely dotted. A connector is chrome, not data.

## Diagrams and illustrations

Diagrams have no series, so the palette rules mostly do not apply, but three do.

- **Connectors, wires, and arrows are neutral** on the muted-foreground token. The faint text token is for de-emphasized text, not structure. A colored connector is making a claim; make sure you mean it.
- **A degraded or failing path may use a status color**, because it encodes bad. Nothing else in a diagram may.
- **The accent is allowed on a diagram**, unlike a chart, but only as identity or emphasis on a surface, never as one of several comparable elements. If three boxes are peers and one is accent-colored, that reads as "selected", so make sure that is the meaning.
- **Standalone marketing assets may declare `data-viz-kind="marketing"`** and use the accent for at most one subject. Mark the subject with `data-viz-subject` and target it either with that attribute selector or with the marked element's class or identifier. Product charts protect color as encoding, while a single-subject marketing asset has no encoding to protect and can use the accent as the brand pointing at itself. Keep non-focus points neutral, not dimmed identity colors. Keep frontier connectors neutral even when a reference composition colors them because the connector remains chrome here.
- Every asset must declare exactly one recognized `data-viz-kind`: `chart`, `diagram`, or `marketing`. This marker makes the relevant semantic checks explicit and cannot be omitted to bypass them.

Every diagram must be intelligible without color. Labels, arrowheads, and baselines, always.

## Social square, the format for a post

A slide asset scaled down to a phone is unreadable, so an asset destined for X, LinkedIn, or Slack is authored as its own thing: a `1080 × 1080` artboard captured framed, at the sizes below. One artboard applies to a whole source directory, so square assets live in `docs/viz-assets/social-examples`, apart from the `1280 × 720` examples, and `social-square.html` there is the worked example.

```bash
VIZ_SOURCE_DIR=docs/viz-assets/social-examples VIZ_ARTBOARD_WIDTH=1080 \
  VIZ_ARTBOARD_HEIGHT=1080 VIZ_CAPTURE_MODE=framed \
  bun run --cwd tests/web-e2e viz:capture
```

- **Frame** — `96px 64px 56px` padding. The top value clears the band the framed wrapper reserves for the lockup, so content starts below it without a shift.
- **Eyebrow** — one mono line at twenty-one pixels on the muted foreground, naming the metric and the date range: `Tokens per week on OpenRouter | Sep 1, 2025 — Aug 30, 2026`.
- **Headline** — a sans claim at fifty-eight pixels, tight tracking, at most two lines. It states the finding, not the chart's subject. The eyebrow already says what is plotted.
- **Chart type** — twenty-four-pixel mono tick labels, three y ticks, five x ticks. Chart micro-type's twelve-pixel floor is a floor, not a target; a phone needs roughly double.
- **Direct labels over legends and over axes.** The numbers the post is about ride the marks as forty-six-pixel bold value labels. A legend is a wrapped chip row under the headline at twenty-two pixels, five entries at most, with variants of one model summed into a family so the labels stay short.
- **Footer** — the source line bottom-left, `openrouter.ai/rankings` bottom-right on the foreground token.
- **Fill the artboard.** Framed capture shifts content down for the lockup band but never scales it, so the plot height is sized by hand until the axis labels sit just above the footer. A short headline frees a block of vertical space that has to be given back to the plot, and an SVG whose `viewBox` height differs from its CSS height silently shrinks the chart inside its box.
- **Annotate a comparison week with chrome, not with a labelled point.** A dashed rule, vertical at that week or horizontal at its value, with its label parked in empty plot space. A dot plus text next to a steep curve collides with the curve at this type size.
- **Weight the chrome up.** Product-scale gridlines and reference rules disappear on a phone: gridlines take the muted foreground at one and a half pixels, an annotation rule three pixels with a long dash. Neutral, still, just not the faintest neutral.

The reference posts use Volt for the leading series. Do not copy that: the accent stays out of data positions, and the wordmark carries the brand.

## Self-check before you ship

Walk the visual and answer each of these out loud.

1. Every series color traced back to a rule above, by name.
2. No accent anywhere in a data position.
3. Every axis line, tick, and gridline on a neutral token, with no raw hex or off-token gray anywhere in the file.
4. Every fill alpha is one of the sanctioned values.
5. Emphasis carried by opacity, ring, and label, never by hue substitution.
6. Renders correctly in both themes, since a categorical hue is theme-constant while everything around it flips.
7. A chart or marketing asset has exactly one valid source line, or a declared root source exception; a diagram is exempt.
8. Meaning survives in grayscale.

## Authoring harness

Use the repository-owned harness rather than copying token values into an asset:

```bash
bun run --cwd tests/web-e2e viz:capture
```

It reads `packages/frontend/components/ui/theme.css`, injects the light and dark token sets, the repository's Plus Jakarta Sans face, and the product's Geist Mono face into the fixed `1280 × 720` slide artboard. Assets should name `var(--font-sans)` or `var(--font-mono)` rather than loading a machine-local or external font. The harness waits for both embedded faces and records the resolved family in the manifest. Transparent output is the deck path. Set `VIZ_CAPTURE_MODE=framed` for a standalone asset. Framed capture measures the painted content after layout, aligns the full horizontal lockup to that content inset, reserves a fixed top band for the lockup, and shifts the asset content below that band before capture. The light-surface lockup is used on light captures and the dark-surface lockup on dark captures. The lockup is sourced from `projects/web/public/brand/v2/openrouter-light.svg` or `openrouter-dark.svg`, not the smaller navigation bitmap variants. The resolved content inset is recorded in the mode-local manifest alongside the images. If content is edge-to-edge or cannot be measured, the wrapper uses a safe fallback inset. Do not add that furniture to the asset source. The default remains transparent. Override the artboard with `VIZ_ARTBOARD_WIDTH` and `VIZ_ARTBOARD_HEIGHT`; the source directory can be changed with `VIZ_SOURCE_DIR`, and `VIZ_OUTPUT_DIR` should name the parent output directory because the harness appends the selected mode. The source `manifest.json` is a JSON array of HTML filenames.

The worked examples in `docs/viz-assets/examples/manifest.json` are `chart.html`, `diagram.html`, `stacked-bar.html`, `bubble-scatter.html`, and `dot-plot.html`, and `docs/viz-assets/social-examples/manifest.json` holds `social-square.html`. A manifest must only contain assets that share one artboard. Keep these lists synchronized with the manifests when adding or removing an example.

Before accepting an asset, run:

```bash
bun run --cwd tests/web-e2e viz:validate ../../docs/viz-assets/examples/<asset>.html
```

The validator catches raw hex and common named colors only in color-bearing declarations and presentation attributes, token references placed directly on presentation attributes, literal colors hidden in local custom properties, non-brand typography, area-fill opacity outside the discrete sanctioned values `0`, `12%`, `35%`, `40%`, or `100%`, general dimming/ring/stroke opacity outside the production/spec set, axis or grid selectors whose stylesheet paint is not a neutral token, and the required source line or root source exception for chart and marketing assets. It applies the strict area-fill rule to stylesheet selectors that identify an area, band, or fill; generic stylesheet selectors cannot always be attributed statically and fall back to the general opacity rule. Chart and extended tokens are complete colors and must be used directly; HSL component tokens must be wrapped as `hsl(var(--token))`. A literal-color specimen must declare `data-viz-exception` and a non-empty `data-viz-exception-reason` on the element itself; stylesheet declarations targeting that element by class or identifier inherit the exception. An undeclared literal still fails. Stylesheet coverage is not total: rules inside at-rules such as `@media` are matched by a flat scanner rather than parsed, so selector and declaration attribution can shift and nested chrome rules may go unchecked. It cannot infer semantic misuse of a valid token, inspect computed styles or generated SVG, recognize rasterized colors, or decide whether an element is a data position without an explicit `data-viz-kind` marker. Rendering in both themes and human review remain required.
The focused validator and token-source tests run unconditionally in the repository's CI unit job through the dedicated `test:viz` script. That script names exactly those two files; it does not discover the other manual-only tests under `tests/web-e2e`, and it stays unconditional because theme.css changes are not linked to this workspace in the affected-workspace dependency graph. They are also not part of the product-workspace unit-test run. Run `bun run --cwd tests/web-e2e test:viz` explicitly when changing this skill or validator.
