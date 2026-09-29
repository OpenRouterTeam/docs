# Remotion authoring conventions

`projects/remotion` is the interactive authoring workspace for the
registry-driven compositions rendered by `services/remotion-render`. The root
[`DESIGN.md`](../../DESIGN.md) and
[`remotion-video-templates`](../../.agents/skills/remotion-video-templates/SKILL.md)
skill define the visual and layout rules.

## Dependencies

Remotion dependencies must satisfy the security floor enforced by `bun run check:remotion-pin` (version floor and resolved-version pin; see `services/remotion-render/README.md`).

## Adding a template

Define the template's Zod props schema, realistic defaults, duration, fps, and
one keyed metadata entry in `src/template-metadata.ts`. Add its React
component to the keyed map in `src/template-registry.tsx`. The registry derives
composition IDs, Root's wide and square compositions, and the service's
request schema. Add a typed draft in `src/videos/index.ts` when iterating on a
specific video.

Do not hand-edit `COMPOSITION_IDS` or add template-specific service validation.
`COMPOSITION_IDS` is intentionally the deployed-service-compatible allow-list;
use `ALL_COMPOSITION_IDS` for the full registry-derived Studio and authoring
composition list, and do not widen the bounded list until the service validates
props per composition.
The metadata module must remain React-free so the render service can import
the derived request contract without pulling React into its graph.
The public `./schema` package subpath intentionally points to the metadata
module for compatibility. Do not add a `schema.ts` re-export shim.

Use Tailwind classes for additive brand-color and typography tokens. Keep
structural and geometric declarations in the two production templates inline,
including position, sizing, spacing, layout, and overflow. Keep inline styles
for values computed per frame or measured from content, such as animation
output and auto-fit sizes. Any structural CSS in a class must be proven through
a service render before it lands.

## Draft workflow

Each draft in `src/videos/index.ts` has a unique slug, a template ID, an aspect,
and props inferred from that template's registry entry. Draft composition IDs
are local Studio artifacts and must not be added to `COMPOSITION_IDS`, which is
the service allow-list. The CLI submits a draft using the real template
composition ID for its aspect and the draft's props.

Studio prop edits update the live preview, but saving draft default props back
to `src/videos/index.ts` may fail because draft props are not inline literals.
After iterating in Studio, copy the values you want to keep into the draft file
by hand.

Register drafts through `VIDEO_DRAFTS` so they appear in Studio's
**Video-drafts** folder. Keep draft content realistic and validate it through
the template's schema-derived type.
