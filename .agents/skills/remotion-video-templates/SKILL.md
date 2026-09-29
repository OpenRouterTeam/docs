---
name: remotion-video-templates
description: Add new Remotion video templates or edit existing ones in projects/remotion — covers composition registration, the zod prop contract, and the OpenRouter brand/layout rules (Ink/Cloud/Grape palette, Plus Jakarta Sans, OR glyph, Bauhaus rule, fixed-geometry panels) that every template must follow. Use when creating a new video template, changing an existing composition's design or props, or regenerating video previews.
allowed-tools: Read, Write, Edit, Bash, Grep, Glob
argument-hint: '[e.g. "add a PricingUpdate template" or "make the code panel darker"]'
---

# remotion-video-templates

The branded Remotion project lives in `projects/remotion`. Its compositions are rendered by `services/remotion-render` (POST /render), driven by the `CHANGELOG_SOCIAL_INGEST` cron task in `services/cfw-internal`, and previewed/edited through Mission Control's Social Posts screen. Every template change ripples through all three — follow this skill exactly.

## Commands

```bash
bun run --filter @openrouter-monorepo/remotion dev        # Remotion Studio (live preview)
cd projects/remotion
bunx remotion still <CompId> out/frame.png --frame=150    # single frame check
bunx remotion render <CompId> out/video.mp4               # full render
bun run typecheck && bun run test                         # tsgo + bun:test
bunx oxlint projects/remotion                             # lint
```

## Brand rules (non-negotiable)

Templates must read like the product. The palette and type are **lifted from the site design system** — `packages/frontend/components/ui/theme.css` (light theme). The full token table + rationale lives in `.agents/skills/code-diagram-html/references/style-guide.md`; the Remotion codification of it lives in `projects/remotion/src/brand.ts`.

1. **Colors come from `src/brand.ts` only.** Ink `#03080A`, Cloud `#FCFCFE`, Grape `#7624F4`, Volt `#C8FF00`, Coral `#FF6849`, Royal `#035ADE`, status `#00BF6F`/`#FF2D55`. Never invent a color or reintroduce the old ivory/clay/serif look. If the design genuinely needs a new token, add it to `theme.css` first, then mirror it in `brand.ts` (they must stay in sync — brand.ts says this in its header comment).
2. **Chrome:** the four-color Bauhaus rule (grape → royal → volt → coral, in that order) across the top, and the OR glyph (inlined in `src/components/OrGlyph.tsx` from `projects/web/public/brand/rebrand/openrouter.glyph.svg`, `fill="currentColor"`). If the brand SVG changes, re-inline it.
3. **Type:** headings are Plus Jakarta Sans **700** with tight tracking (`-0.02em`/`-0.03em`); labels/eyebrows/footers are mono, uppercase, letter-spaced; code is IBM Plex Mono. Fonts load via `@remotion/google-fonts` in `src/fonts.ts` — add weights there, never link a CDN or use system serif.
4. **Code panels:** Ink background, brand syntax colors — keyword → grape, string → volt, function → royal, literal → coral (see `SYNTAX` in brand.ts and the highlighter in `src/components/CodePanel.tsx`). Chrome dots are coral/volt/positive. Volt is an energy pop (underline swipe, cursor) — never a fill.
5. **Inline geometry, additive classes.** Classes may add brand colors and
   typography only when an inline equivalent remains. Keep structural,
   geometric, measured, and animated declarations inline so rendering never
   depends on compiled CSS.

## Layout invariants (learned the hard way)

- **Nothing may reflow over time.** Any container whose content animates in (typing, counters, lists) must reserve its final geometry from frame 0. Follow the `CodePanel` pattern: one fixed-height slot per line, content only changes *inside* reserved slots, truncate with an ellipsis slot (`MAX_PANEL_LINES`).
- **Landscape is two-column** (text left ~44%, panel vertically centered right ~47%); **square is stacked** with bottom-anchored panel. Never let a growing element share a vertical axis with text.
- **Auto-fit type to content.** Titles, taglines, and snippets all shrink by content length rather than overflowing — `titleFontSize` / `taglineFontSize` / `codeFontSizeForLines` in `FeatureAnnouncement.tsx`. Ingested copy is much longer than the defaults (titles past 40 chars, taglines to 180), and in the square layout the text stack and the panel share a vertical axis, so any new text element needs the same treatment. Every composition ships in both `1920×1080` and `1080×1080` variants from one responsive component (`useVideoConfig` + `isSquare`), 30fps, ~10s (300 frames).
- Keep snippets ≤9 visible lines; ingestion already caps at 10.
- **The code panel is optional.** `code`/`language` are optional as a pair (`hasCodePanel`); sources with no code fence render a text-only card, and the landscape text column takes the full width. Never substitute a stand-in snippet to fill the panel — a snippet unrelated to the feature reads as a deliberate example.

## The prop contract

`projects/remotion/src/template-metadata.ts` is the **single source of truth**:

- `featureAnnouncementSchema` — the zod schema the render service validates POST /render against, the ingestion cron fills, and Mission Control edits.
- `TEMPLATE_REGISTRY` — template metadata, schemas, defaults, timing, and aspect variants. `COMPOSITION_IDS` and the service request schema are derived from it.
- `defaultFeatureAnnouncementProps` — Studio defaults; keep them realistic (a real SDK feature, ≤9 lines of code).

**Backward compatibility:** existing posts in `social_posts` store these fields in Postgres columns. Adding a *required* prop breaks old rows and the MC edit screen — prefer optional props with defaults, and if you must change the shape, update the DB columns, the cron's `buildRenderRequest`, and the MC `regenerateSocialPostVideoSA` props in the same PR.

## Adding a new template

1. Create `src/<TemplateName>.tsx` — responsive component, brand rules + layout invariants above.
2. Define its props schema, realistic defaults, and one keyed metadata entry in `src/template-metadata.ts`.
3. Register the component in `src/template-registry.tsx`. Root derives both aspect variants and the service derives request validation from the metadata registry.
4. Draft IDs must not be added to `COMPOSITION_IDS`.
5. Add a seed draft to `src/videos/index.ts` when authoring a specific video. Studio registers drafts in the **Video-drafts** folder.
6. Use the draft CLI for local mp4s, still PNGs, and authenticated service submission.
7. Wire producers if it should be generated: `buildRenderRequest` in `services/cfw-internal/src/routes/cron/changelog-social-ingest/transform.ts`.
8. Add tests (schema accept/reject, registry alignment, and any new pure helpers, colocated `.test.ts`).
9. Verify (below) and commit fresh previews.

## Editing an existing template

- Check the prop contract section first — design-only changes are safe, prop-shape changes are not.
- If you touch `transform.ts` copy/render-request logic, regenerate the committed examples: `bun services/cfw-internal/src/routes/cron/changelog-social-ingest/examples/regen.ts` (the fixture tests will fail otherwise).
- Re-render the previews (below) whenever pixels change.

## Verification loop (required before pushing)

1. `bun run typecheck`, `bun run test`, `bunx oxlint projects/remotion` — all clean.
2. Frame checks at 30, 150, and 250 in both aspects for every template. Check overlap, layout shift, and text overflow.
3. Exercise both `/render` and `/still` through the local authenticated service.
4. Full render + watch it once (`bunx remotion render ... mp4`).
5. Regenerate the committed previews so the PR shows the current design:

```bash
cd projects/remotion
bunx remotion render <CompId> previews/<name>.gif --codec=gif --scale=0.25 --every-nth-frame=3
bunx remotion still <CompId> previews/<name>.png --frame=250
```

5. Embed the GIFs in the PR description via `https://github.com/OpenRouterTeam/openrouter-web/blob/<branch>/projects/remotion/previews/<name>.gif?raw=true`.
