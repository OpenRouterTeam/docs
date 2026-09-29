---
name: code-diagram-html
description: Build a single self-contained HTML diagram explaining how a code change works and what it impacts, then optionally render it to a PNG and post an explainer to Slack so reviewers get up to speed fast. Use when the user wants to "diagram this", "visualize this change", "make an HTML diagram", "explain this PR in Slack", or wants to understand a PR/feature visually. Output is one .html file in the OpenRouter brand style (Ink/Cloud/Grape palette, Plus Jakarta Sans, the OR glyph) — no build step, no JS frameworks, opens in any browser.
allowed-tools: Read, Write, Edit, Bash, Grep, Glob
argument-hint: '[topic or change to diagram, e.g. "PR #29133 batch image URLs" or "ECO-614 embeddings DO offloading"]'
---

# code-diagram-html

Build **one** self-contained HTML page that explains how a code change works and what its impact is. The page should let a reader go top-to-bottom and leave with a working mental model — without opening the source.

Output goes to `docs/<short-slug>.html` in the current repo (or `~/Desktop/<slug>.html` if no repo). One file, no dependencies, no JS frameworks.

When the goal is a Slack explainer (§ "Deliver to Slack" below), also render that HTML to a PNG and post a short text summary + the image + the raw `.html`. Slack can't render HTML inline, so the PNG is what people actually read in-thread.

## When to use

- "diagram this", "visualize this change", "make an HTML diagram"
- "I want to understand how X works" + a code path to study
- After a PR is staged and someone wants a one-pager mental model
- Pre-review explainer for a stacked PR
- "explain this PR in Slack" / "send an explainer so people can get up to speed"

## When NOT to use

- The user wants Mermaid / Excalidraw / Figma
- The user wants prose docs (use markdown, not this)
- The user wants a slide deck

## Authoring contract

Always:
1. **Read the actual code first.** Never invent file paths, function names, or flow steps. Use `Grep` / `Read` to confirm every claim. If a claim can't be sourced, drop it.
2. **One file, self-contained.** All CSS inline in `<style>`. No external CDN, no JS unless the page genuinely needs interaction. The brand font (Plus Jakarta Sans) is **embedded inline** as a base64 `@font-face` — never linked from a font CDN (see `references/style-guide.md` → "Fonts").
3. **Use the OpenRouter brand style in `references/style-guide.md`** — Cloud background, Ink text, Grape accent, Plus Jakarta Sans headings (weight 700, tight tracking), mono labels, the four-color Bauhaus rule, and the OR glyph in the header. Don't deviate, and don't reintroduce the old ivory/clay/serif look. If the diagram contains a series, axis, gridline, reference line, or chart-like comparison, read and follow the `viz` skill first. Its series, chrome, accent, and opacity law overrides this diagram style reference.
4. **Open with a one-paragraph lede.** What changed, in plain English. No jargon before the eyebrow.
5. **Show the flow, not the file tree.** A swim-lane sequence diagram > a list of "files changed".
6. **Contrast cases when there are branches.** If two providers / two adapters / two code paths behave differently, put them side-by-side, not in prose.
7. **Cite file paths inline.** Every code claim should sit next to a `services/.../foo.ts` reference so the reader can jump.

Never:
- Add emojis (global rule).
- Use `as` casts in any embedded TS snippet.
- Use Tailwind, React, or any framework — pure HTML+CSS.
- Add a "Conclusion" section. If the page needed a conclusion, it failed earlier.

## Workflow

### 1. Establish ground truth
- `git log` / `git diff` to see what changed. For a PR, `git diff --merge-base origin/<base> <branch>` is the honest delta.
- `Read` every file touched. Skim, don't deep-read everything — focus on the entry points and the new code.
- For each major decision in the diff, find the *line* where the decision is made. Note the file:line in scratch.

### 2. Pick the spine
A code-change diagram has one of four spines. Pick the one that fits the change and stick to it:

| Spine | When to use | Layout |
|---|---|---|
| **Sequence** | Request flows through N actors over time, mostly linearly | Swim-lane grid (rows = steps, cols = actors) |
| **Flow** | Code path **branches and re-converges** — different inputs / providers / states take different routes through the same function | Top-down node graph with forks and merges, pure CSS |
| **Decision tree** | One input → N independent terminal branches that don't reconverge | Cards in a 2- or 3-column grid, one card per branch |
| **Before / after** | Refactor or migration where the *delta* is the story | Two-column comparison, same row layout on both sides |

**Flow vs sequence:** if your story has phrases like "but the multimodal path also …" or "if the flag is set, …", you want a flow diagram, not a sequence. Sequence is for "and then, and then, and then." Flow is for "but if X, then …".

**Flow vs decision tree:** if the branches converge back into a single path (e.g., both adapters end up calling `_internalFetch`), use flow. If they truly terminate in different places, use cards.

If the change has more than one interesting spine, pick the most surprising one and put the others in supporting sections.

### 3. Draft the page in this order

1. **Header** — eyebrow (ticket/PR + service), `<h1>` (italic accent on the verb), lede paragraph, prompt-box with one-sentence "pattern" or "why now"
2. **Section 01 — the spine** (sequence | flow | decision | before/after)
3. **Section 02 — the gates / decision points** as cards (skip if the flow diagram already shows them)
4. **Section 03 — what's substituted / transformed / changed** as a code panel
5. **Section 04 — files touched** as a 3-column table (path / kind / why)
6. **Section 05 — observability** (logs, metrics, breadcrumbs added) as cards
7. **Footer** — branch name, commit count, date

Skip sections that don't apply. A 3-section diagram is fine if the change is small.

### Flow-diagram authoring rules

When building a flow-diagram section, follow these rules so the flow stays readable instead of turning into a tangle:

- **Top-down only.** No left-right flows. Reading order = vertical.
- **Max 2-way forks.** A 3-way branch becomes two 2-way forks stacked.
- **Label every fork branch.** Mono uppercase 10–11px under the horizontal line, before the next node. "yes / no", "text-only / multimodal", "hit / miss".
- **Reconverge or terminate explicitly.** Every branch either ends in a `terminal` node (success / error / sink) or merges back into the trunk. No dangling paths.
- **One fork per "row of attention."** If two forks happen back-to-back at the same level of detail, separate them with a labeled trunk node so the reader catches up.
- **Highlight the path the lede is about.** Use the `.highlight` grape tint on the nodes that match the change being described, leave the rest neutral. The reader should be able to trace one accent color from top to bottom.
- **Keep nodes ≤ 3 lines.** Title + one descriptor + (optional) one mono code reference. Anything longer goes in a card below the diagram.

### 4. Verify before saving

- Every file path mentioned exists (`Bash: test -f`).
- Every function name mentioned shows up in `grep`.
- Every quoted threshold / default value matches the source.
- The HTML opens cleanly in a browser (no validation errors that break layout).

## Deliver to Slack

Slack renders none of the HTML, so a diagram sent as an `.html` attachment is useless in-thread. Convert it to an image and lead with a short text summary.

### 1. Render the HTML to a PNG

Use the bundled renderer, which drives the environment's Chrome over its CDP endpoint and captures a full-page (not just viewport) screenshot at 2× scale:

```bash
python3 .agents/skills/code-diagram-html/scripts/render-to-png.py \
  "file://$(pwd)/docs/<slug>.html" \
  ~/<slug>.png
```

- The renderer connects to `CDP_ENDPOINT` (default `http://localhost:29229`, the Devin Chrome). `full_page=True` captures the whole document height, so a tall diagram comes out in one image.
- If the CDP connect fails with `ECONNREFUSED 127.0.0.1:29229` (child sessions and headless boxes have no attached Chrome), run `playwright install chromium` once and render with `p.chromium.launch()` plus `new_page(viewport={'width': 1240, 'height': 900}, device_scale_factor=2)` and `screenshot(full_page=True)`. The output is equivalent, so no note is needed in the PR.
- The script imports the Python `playwright` package, which a fresh snapshot may not have. On `ModuleNotFoundError: No module named 'playwright'`, run `pip install playwright` (no `playwright install`, it attaches to the running Chrome). Subsetting an embedded font needs `pip install fonttools brotli` for the same reason.
- A full-page PNG of a long diagram is unreadable as one GitHub image. Split it at section boundaries (Pillow `Image.crop`) and embed each slice under `## Visualization` with `![alt](/abs/path.png)`.
- Always `Read` the resulting PNG back and eyeball it before posting — check that forks connect, nothing overflows, and no text is clipped. Fix the HTML and re-render if it looks off.

### 2. Post the explainer

Send via the normal user-message channel (which forwards to Slack) with **both** files attached: the PNG (renders inline) and the `.html` (opens standalone).

Write the text body to Slack-native formatting, not Markdown:
- `*bold*`, `_italic_`, `` `inline code` ``, ```` ``` ```` code blocks. No `#` headers, no `![]()` images, no tables.
- Lead with one line naming the PR/change. Then the "what + why" in 3–6 bullets a reviewer can skim.
- Call out the one gap or risk a reviewer should weigh.
- End by pointing at the attached image + HTML for the full picture.

Keep the text tight — the PNG carries the detail; the message is the hook.

## Style reference

See `references/style-guide.md` for the full CSS token table, the font-embedding command, and component patterns. The palette comes from the monorepo design system (`packages/frontend/components/ui/theme.css`, light theme). The short version:

- **Background** `#FCFCFE` (Cloud), **text** `#03080A` (Ink)
- **Accent** `#7624F4` (Grape) for the `<h1>` word, ticket numbers, the highlighted flow path, "kind" column
- **Volt** `#C8FF00` as a single energy pop — the highlight swipe under the `<h1>` accent word, and code strings. Don't use it as a fill.
- **Status** green `#00BF6F` (`--positive`) for success/terminal, red `#FF2D55` (`--negative`) for errors, Royal `#035ADE` for info, Coral `#FF6849` for warning callouts
- **Headings** Plus Jakarta Sans (embedded inline), weight 700, tight `-0.02em`/`-0.03em` tracking — no serif
- **Labels** mono (system `ui-monospace` stack), 10–12px, uppercase, letter-spaced
- **Body** Plus Jakarta Sans, 13–16px depending on context
- **Cards** white bg, 1.5px `rgba(3,8,10,.12)` border, 12px radius, status as a 4px top border
- **Code panels** Ink (`#03080A`) bg, light text, syntax in grape (kw), volt (str), royal (fn), coral (lit)
- **Chrome** four-color Bauhaus rule (grape/royal/volt/coral) at the top, OR glyph in header + footer, 2px Ink section/footer rules

The four-color chrome rule and syntax colors are diagram chrome only. Coral is not a product-surface secondary accent or a chart color. For chart-like content, use the `viz` skill's token-driven series and neutral chrome rules instead of this illustrative palette.

## Heuristics

- **Show, don't list.** A 3-column comparison table beats three paragraphs.
- **Cite line numbers in side notes.** Inside a card or callout, a mono `services/.../foo.ts` path with its line number is gold.
- **Pre-wire forward-compat fields.** If the diff includes patterns/fields not yet active, mark them in code comments — the reader needs to know what's real today vs scaffolded.
- **The spine ends at the wire.** If the request hits a provider, the diagram ends at the provider — don't try to also explain the provider's response shape.
- **One swim-lane diagram per page.** If you need a second, you're trying to fit two changes into one diagram. Split.

## Examples

- `docs/batch-image-urls.html` (in this repo) — PR #29133 batch native image URLs: a two-guard flow spine (URL classification → capability gate) with per-provider outcome cards. Rendered and posted to Slack via the workflow above.

## Inspiration

Single-file ethos and the "one diagram, no slop" bar are from Thariq's https://thariqs.github.io/html-effectiveness/ demos. The visual language is OpenRouter's own — the Bauhaus rebrand (Julian Thayn) and the design-system tokens in `packages/frontend/components/ui/theme.css`.
