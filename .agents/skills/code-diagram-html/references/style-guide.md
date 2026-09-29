# code-diagram-html — style guide

The complete CSS token system + component patterns for the **OpenRouter-brand** diagram style. Paste these tokens into the `<style>` block of every diagram. The palette, type, and semantic colors are lifted straight from the monorepo design system (`packages/frontend/components/ui/theme.css`, light theme) so a diagram reads like it belongs in the product.

`docs/batch-image-urls.html` in this repo is the reference implementation — when in doubt, match it.

## CSS variables

```css
:root {
  /* OpenRouter brand palette — 6 core (v2/theme.css) */
  --ink:    #03080A;  /* text, code-panel bg, section rules, entry node */
  --cloud:  #FCFCFE;  /* page background */
  --grape:  #7624F4;  /* light-mode accent — h1 word, ticket #, highlight path */
  --volt:   #C8FF00;  /* energy pop — highlight underline, code strings */
  --coral:  #FF6849;  /* warning callouts, secondary accent */
  --royal:  #035ADE;  /* info, royal-tinted identifiers in code */

  /* Semantic tokens (light theme) */
  --background:    var(--cloud);
  --foreground:    var(--ink);
  --card:          #FFFFFF;
  --muted:         rgba(3, 8, 10, 0.03);   /* soft surface / code pill bg */
  --muted-fg:      rgba(3, 8, 10, 0.69);   /* captions, labels */
  --border:        rgba(3, 8, 10, 0.12);
  --border-strong: rgba(3, 8, 10, 0.16);
  --accent:        var(--grape);
  --accent-subtle: rgba(118, 36, 244, 0.07);
  --accent-border: rgba(118, 36, 244, 0.28);

  /* Status (positive/negative/info map to design-system display tokens) */
  --positive:      #00BF6F;
  --positive-text: #007544;
  --positive-bg:   rgba(0, 191, 111, 0.08);
  --negative:      #FF2D55;
  --negative-text: #BF0024;
  --negative-bg:   rgba(255, 45, 85, 0.07);
  --info:          var(--royal);

  --radius-md: 6px;
  --radius-lg: 8px;
  --radius-xl: 12px;

  /* Type — Plus Jakarta Sans is the brand --font-sans. Embed it inline
     (see "Fonts" below); never link an external CDN. Mono stays a
     system stack so there are zero external requests. */
  --sans: 'Plus Jakarta Sans', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  --mono: ui-monospace, 'SF Mono', 'JetBrains Mono', Menlo, Monaco, 'Cascadia Code', monospace;
}
```

There is **no serif** in this style — OpenRouter's headings are Plus Jakarta Sans, tight tracking, weight 700. The Claude-era ivory/clay/serif look is gone.

## Fonts — embed, never link

The skill's self-contained rule (one file, no CDN) still holds, and the brand needs Plus Jakarta Sans. Resolve both by embedding a subset of the repo's variable font as a base64 `@font-face` at the top of `<style>`. One variable woff2 covers weights 400–800 and subsets to ~30 KB.

```bash
# from repo root — subset the brand variable font to latin + the glyph/arrow
# chars a diagram uses, output woff2 (needs: pip install fonttools brotli)
python3 -m fontTools.subset \
  projects/web/public/fonts/jakarta/PlusJakartaSans-VariableFont_wght.ttf \
  --unicodes="U+0020-007E,U+00A0-00FF,U+2010-2015,U+2018-201F,U+2022,U+2026,U+2032-2033,U+2192,U+00B7,U+2212" \
  --layout-features='*' --flavor=woff2 --output-file=/tmp/jakarta-subset.woff2

base64 -w0 /tmp/jakarta-subset.woff2   # paste into the src url below
```

```css
@font-face {
  font-family: 'Plus Jakarta Sans';
  font-style: normal;
  font-weight: 400 800;                 /* variable font: one face, all weights */
  font-display: swap;
  src: url(data:font/woff2;base64,<PASTE>) format('woff2');
}
```

If embedding isn't practical, fall back to the system stack in `--sans` (drop the branded name) — but never add a `fonts.googleapis.com` link. The render step waits on `networkidle`, so an external font can stall it in a restricted network.

## Page chrome + Bauhaus brand rule

Open the `<body>` with a thin four-color rule — a nod to the rebrand's geometric grid. It's the one flourish; keep everything else disciplined.

```html
<div class="brand-rule"><span class="s1"></span><span class="s2"></span><span class="s3"></span><span class="s4"></span></div>
<div class="page"> … </div>
```

```css
* { margin: 0; padding: 0; box-sizing: border-box; }

body {
  font-family: var(--sans);
  background: var(--background);
  color: var(--foreground);
  line-height: 1.55;
  padding: 0 0 96px;
  -webkit-font-smoothing: antialiased;
  font-feature-settings: 'case' 1, 'calt' 0;
}

.brand-rule { display: flex; height: 5px; width: 100%; }
.brand-rule span { flex: 1; }
.brand-rule .s1 { background: var(--grape); }
.brand-rule .s2 { background: var(--royal); }
.brand-rule .s3 { background: var(--volt); }
.brand-rule .s4 { background: var(--coral); }

.page { max-width: 1160px; margin: 0 auto; padding: 56px 32px 0; }
```

## The glyph logo

Inline the rebrand OR glyph (from `projects/web/public/brand/rebrand/openrouter.glyph.svg`) in the header and footer. Set `fill="currentColor"` so it takes the surrounding text color.

```html
<div class="brandline">
  <svg class="glyph" viewBox="0 0 599.50008 424.5955" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path fill="currentColor" d="M465.95505,1c70.18551,0,127.07865,56.89523,127.07865,127.07865s-56.89314,127.07865-127.07865,127.07865l126.04929,126.05058c16.01193,16.01105,4.67227,43.38762-17.96889,43.38762H211.79775C94.82524,424.5955,0,329.77027,0,212.79775S94.82524,1,211.79775,1h254.1573ZM211.79775,85.7191c-70.18342,0-127.07865,56.89523-127.07865,127.07865s56.89523,127.07865,127.07865,127.07865,127.07865-56.89523,127.07865-127.07865-56.89523-127.07865-127.07865-127.07865Z"/>
  </svg>
  <span class="wordmark">OpenRouter</span>
</div>
```

```css
.brandline { display: flex; align-items: center; gap: 12px; margin-bottom: 26px; }
.brandline .glyph { width: 30px; height: auto; color: var(--ink); flex-shrink: 0; }
.brandline .wordmark { font-weight: 800; font-size: 17px; letter-spacing: -0.02em; color: var(--ink); }
```

## Header

```html
<header class="page-head">
  <div class="brandline"> … glyph + wordmark … </div>
  <div class="eyebrow"><span class="ticket">PR #29133</span>&nbsp;&nbsp;services/batch-api · packages/batch</div>
  <h1>Batch now admits <em>public image URLs</em> — but never base64.</h1>
  <p class="lede">…one paragraph plain-English summary…</p>
  <div class="prompt-box"><span class="label">Why now</span> …one sentence…</div>
</header>
```

```css
header.page-head { margin-bottom: 60px; max-width: 880px; }
.eyebrow {
  font-family: var(--mono); font-size: 12px; letter-spacing: 0.06em;
  text-transform: uppercase; color: var(--muted-fg); margin-bottom: 16px;
}
.eyebrow .ticket {
  color: var(--accent); font-weight: 600;
  background: var(--accent-subtle); padding: 2px 8px; border-radius: var(--radius-md);
}
h1 {
  font-weight: 700;                 /* Jakarta, not serif */
  font-size: 44px; line-height: 1.08;
  color: var(--ink); margin-bottom: 22px; letter-spacing: -0.03em;
}
h1 em { font-style: normal; color: var(--accent); position: relative; }
h1 em::after {                       /* the Volt highlight swipe under the accent phrase */
  content: ''; position: absolute; left: 0; right: 0; bottom: 2px; height: 8px;
  background: var(--volt); opacity: 0.55; z-index: -1; border-radius: 2px;
}
.lede { font-size: 16.5px; color: var(--foreground); margin-bottom: 24px; max-width: 760px; }
.prompt-box {
  background: var(--card); border: 1.5px solid var(--border);
  border-left: 4px solid var(--accent);
  border-radius: var(--radius-xl); padding: 18px 22px; font-size: 14.5px; max-width: 800px;
}
.prompt-box .label {
  font-family: var(--mono); font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em;
  color: var(--accent); display: block; margin-bottom: 8px; font-weight: 600;
}

/* inline code — used anywhere in prose */
code {
  font-family: var(--mono); font-size: 0.86em; background: var(--muted);
  padding: 1px 6px; border-radius: var(--radius-md); color: var(--ink);
}
```

## Section heading

Numbered, with a **2px ink** underline (heavier than the Claude version) and a grape number.

```html
<div class="section-head">
  <span class="num">01</span>
  <h2>How one content part is judged</h2>
  <span class="meta">2 guards · normalized request</span>
</div>
```

```css
section { margin-bottom: 68px; }
.section-head {
  display: flex; align-items: baseline; gap: 16px; margin-bottom: 28px;
  padding-bottom: 14px; border-bottom: 2px solid var(--ink);
}
.section-head .num { font-family: var(--mono); font-size: 13px; font-weight: 600; color: var(--accent); }
.section-head h2 { font-weight: 700; font-size: 27px; color: var(--ink); letter-spacing: -0.02em; }
.section-head .meta { margin-left: auto; font-family: var(--mono); font-size: 12px; color: var(--muted-fg); }
```

## Swim-lane sequence diagram

For the **Sequence** spine — a CSS grid where column 1 is the step label and columns 2..N are actors. Highlighted cells (`.active`) get a soft grape tint; markers come in `.grape` (default), `.ok` (green success), `.mute` (neutral).

```css
.swimlanes {
  display: grid; grid-template-columns: 170px repeat(4, minmax(0, 1fr));
  background: var(--card); border: 1.5px solid var(--border); border-radius: var(--radius-xl); overflow: hidden;
}
.lane-head {
  background: var(--ink); color: var(--cloud); padding: 14px 18px;
  font-family: var(--mono); font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; font-weight: 600;
}
.lane-head + .lane-head { border-left: 1.5px solid rgba(252, 252, 254, 0.15); }
.step-label {
  padding: 18px; border-top: 1px solid var(--border); font-family: var(--mono);
  font-size: 11px; letter-spacing: 0.04em; text-transform: uppercase; color: var(--muted-fg); display: flex; align-items: center;
}
.step-cell { padding: 18px; border-top: 1px solid var(--border); border-left: 1.5px solid var(--border); font-size: 13px; color: var(--foreground); }
.step-cell.active { background: var(--accent-subtle); }
.step-cell .marker { display: inline-block; width: 10px; height: 10px; border-radius: 50%; background: var(--accent); margin-right: 8px; vertical-align: 1px; }
.step-cell .marker.ok { background: var(--positive); }
.step-cell .marker.mute { background: var(--muted-fg); }
.step-cell code { font-family: var(--mono); font-size: 12px; color: var(--ink); background: var(--muted); padding: 0 4px; border-radius: 4px; }
```

Add `@media (max-width: 900px) { .swimlanes { grid-template-columns: 110px repeat(4, minmax(0, 1fr)); } }` to the responsive block so lanes collapse on a laptop.

## Flow diagram (branch + merge)

Pure CSS, no SVG, no JS. Vertical flex column of `.flow-node`, `.flow-line`, and `.flow-fork` rows. The trunk into a fork is a `.flow-line` above it; each branch column is a `.flow-branch`. Highlight the path the lede is about with `.highlight` (grape), and draw the arrowhead only on the line into the terminal / convergence node.

```html
<div class="flow">
  <div class="flow-node entry">batch line submitted</div>
  <div class="flow-line"></div>
  <div class="flow-node"><span class="label">normalize + flatten</span><code>batchContentParts(body)</code></div>
  <div class="flow-line accent arrow"></div>
  <div class="flow-node highlight"><h4>Guard 1 — content type</h4><code>assertTextOnlyBody</code></div>
  <div class="flow-line"></div>
  <div class="flow-fork">
    <div class="flow-branch">
      <div class="branch-label">audio / video / file</div>
      <div class="flow-line"></div>
      <div class="flow-node error"><h4>422</h4>unsupported content type</div>
    </div>
    <div class="flow-branch highlight">
      <div class="branch-label">image_url part</div>
      <div class="flow-line accent arrow"></div>
      <div class="flow-node terminal"><h4>202 Accepted</h4>URL forwarded to provider intact</div>
    </div>
  </div>
</div>
```

```css
.flow { display: flex; flex-direction: column; align-items: center; width: 100%; max-width: 1000px; margin: 0 auto; }

.flow-node {
  background: var(--card); border: 1.5px solid var(--border-strong); border-radius: var(--radius-lg);
  padding: 13px 20px; font-size: 13px; text-align: center; min-width: 240px; max-width: 420px; color: var(--foreground);
}
.flow-node h4 { font-weight: 700; font-size: 14.5px; color: var(--ink); margin-bottom: 3px; letter-spacing: -0.01em; }
.flow-node .label {
  display: block; font-family: var(--mono); font-size: 10px; text-transform: uppercase;
  letter-spacing: 0.06em; color: var(--muted-fg); margin-bottom: 5px; font-weight: 500;
}
.flow-node code { font-family: var(--mono); font-size: 12px; color: var(--ink); background: var(--muted); padding: 1px 5px; border-radius: 4px; }

.flow-node.entry {
  background: var(--ink); color: var(--cloud); border-color: var(--ink);
  font-family: var(--mono); font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; font-weight: 600;
}
.flow-node.terminal { border-color: var(--positive); background: var(--positive-bg); }
.flow-node.terminal h4 { color: var(--positive-text); }
.flow-node.error { border-color: var(--negative); background: var(--negative-bg); }
.flow-node.error h4 { color: var(--negative-text); }
.flow-node.highlight { background: var(--accent-subtle); border-color: var(--accent-border); }
.flow-node.highlight h4 { color: var(--accent); }

.flow-line { width: 2px; height: 26px; background: var(--border-strong); position: relative; flex-shrink: 0; }
.flow-line.accent { background: var(--accent); }
.flow-line.arrow::after {
  content: ''; position: absolute; bottom: 0; left: 50%; transform: translateX(-50%);
  width: 0; height: 0; border-left: 5px solid transparent; border-right: 5px solid transparent; border-top: 8px solid var(--accent);
}

.flow-fork { display: grid; grid-template-columns: 1fr 1fr; width: 100%; position: relative; padding-top: 2px; }
.flow-fork::before { content: ''; position: absolute; top: 0; left: 25%; right: 25%; height: 2px; background: var(--border-strong); }
.flow-branch { display: flex; flex-direction: column; align-items: center; }
.flow-branch .branch-label { font-family: var(--mono); font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted-fg); margin-top: 9px; margin-bottom: 3px; font-weight: 500; }
.flow-branch.highlight .branch-label { color: var(--accent); font-weight: 600; }
```

### Forks with more than 2 branches

Nest a second `.flow-fork` inside a `.flow-branch` (the reference file stacks 2-way forks to express 3 outcomes). A flat 3-way fork is possible with `grid-template-columns: 1fr 1fr 1fr;` and `::before { left: calc(100%/6); right: calc(100%/6); }`, but beyond 3 branches switch to a card grid.

## Cards (decision points / contrast)

Status is carried by a **4px top border** (grape/green/red), not a full tinted card.

```css
.cards { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 22px; }
.cards.three { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.card { background: var(--card); border: 1.5px solid var(--border); border-radius: var(--radius-xl); padding: 24px; }
.card.ok { border-top: 4px solid var(--positive); }
.card.no { border-top: 4px solid var(--negative); }
.card h3 { font-weight: 700; font-size: 19px; color: var(--ink); margin-bottom: 8px; letter-spacing: -0.01em; }
.card .tag {
  display: inline-block; font-family: var(--mono); font-size: 10.5px; font-weight: 600; text-transform: uppercase;
  letter-spacing: 0.04em; padding: 3px 9px; border-radius: var(--radius-md); margin-bottom: 14px;
}
.card .tag.ok { background: var(--positive-bg); color: var(--positive-text); }
.card .tag.no { background: var(--negative-bg); color: var(--negative-text); }
.card p { font-size: 13.5px; color: var(--foreground); margin-bottom: 12px; }
.card p:last-child { margin-bottom: 0; }
```

## Code panel

Ink background, light text, syntax classes tinted from the brand palette (grape keywords, volt strings, royal identifiers, coral literals). Apply the spans by hand — no highlighter library.

```css
.code { background: var(--ink); border-radius: var(--radius-xl); padding: 20px 24px; overflow-x: auto; margin-top: 16px; }
.code pre { font-family: var(--mono); font-size: 12.5px; line-height: 1.75; color: #E7ECEE; white-space: pre; }
.code .kw  { color: #C79BFF; }   /* keywords — grape-tinted */
.code .str { color: var(--volt); }
.code .cm  { color: rgba(231, 236, 238, 0.45); }
.code .fn  { color: #6FB6FF; }   /* identifiers — royal-tinted */
.code .lit { color: var(--coral); }
```

```html
<pre><span class="kw">const</span> hasImageURL = <span class="fn">isDefinedAndNotNull</span>(parsed.data.image_url); <span class="cm">// judged by URL, not type</span></pre>
```

## Files-touched table

Ink header row, mono cells, grape "kind" column (green for `new`).

```css
.files { background: var(--card); border: 1.5px solid var(--border); border-radius: var(--radius-xl); overflow: hidden; font-size: 13px; }
.files .row { display: grid; grid-template-columns: minmax(300px, 1.5fr) 130px 1fr; }
.files .row + .row { border-top: 1.5px solid var(--border); }
.files .cell { padding: 13px 16px; font-family: var(--mono); font-size: 12.5px; color: var(--muted-fg); }
.files .cell + .cell { border-left: 1.5px solid var(--border); }
.files .cell.path { color: var(--ink); }
.files .cell.kind { color: var(--accent); font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; font-weight: 600; }
.files .cell.kind.new { color: var(--positive-text); }
.files .head .cell { background: var(--ink); color: var(--cloud); font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; }
.files .head .cell + .cell { border-left-color: rgba(252, 252, 254, 0.15); }
```

## Callout

For "why this matters" asides — grape left rule by default, coral for warnings/gaps.

```css
.callout {
  background: var(--card); border: 1.5px solid var(--border); border-left: 4px solid var(--accent);
  border-radius: var(--radius-lg); padding: 18px 22px; margin-top: 20px;
}
.callout.warn { border-left-color: var(--coral); }
.callout h4 { font-family: var(--mono); font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--accent); margin-bottom: 6px; font-weight: 600; }
.callout.warn h4 { color: var(--coral); }
.callout p { font-size: 13.5px; color: var(--foreground); }
```

## Footer

Ink 2px top rule, mono meta on each side, a faded glyph in the middle.

```css
footer {
  margin-top: 68px; padding-top: 24px; border-top: 2px solid var(--ink);
  font-size: 12px; color: var(--muted-fg); font-family: var(--mono);
  display: flex; justify-content: space-between; align-items: center; gap: 16px;
}
footer .glyph { width: 18px; height: auto; color: var(--ink); opacity: 0.5; }
```

## Responsive break

```css
@media (max-width: 900px) {
  .cards, .cards.three { grid-template-columns: 1fr; }
  h1 { font-size: 34px; }
}
```

## Don'ts

- No box shadows. Borders + the cloud background do the work.
- No serif. Headings are Plus Jakarta Sans, weight 700, tight tracking.
- No external font/CDN links — embed the font (see "Fonts") or fall back to the system stack.
- No emojis (project rule).
- No SVG arrows between cells. The grid + tinted backgrounds + `.arrow` micro-line imply flow.
- No JS. If you reach for JS, you're building an app, not a diagram.
- Don't overuse Volt. It's a single highlight (the h1 swipe, code strings) — not a fill color.
