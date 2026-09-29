# Repository README Banners

Generator for the branded hero banners at the top of the README in
OpenRouter's public repositories (SDKs, agent toolkit, Terraform
provider). Banners are rendered from a single React template with the
design-system tokens from the root [`DESIGN.md`](../../DESIGN.md), so
every repo stays on-brand and new banners take one config entry.

## How it works

| File | Role |
| --- | --- |
| `banner-configs.ts` | Registry of per-repo copy: title, tagline, install command, theme. |
| `banner-template.tsx` | Satori JSX template. All visual decisions (tokens, layout, type) live here. |
| `banner-font-size.ts` | Fixed-step font-size buckets so long titles/commands never wrap. |
| `generate-repo-banners.ts` | Renders each config → SVG (satori) → 2x PNG (resvg). |

The template consumes the **canonical brand lockup SVGs** from
`projects/web/public/brand/v2/` (embedded as data URIs) and the OG
fonts from `projects/web/utils/fonts/` (Gordita Bold for the title,
Plus Jakarta Sans for the tagline, Fira Code for the command chip).
Do not fork or restyle those assets here — if the brand kit changes,
regenerating picks the change up automatically.

Output goes to `projects/web/public/brand/repo-banners/<repo>.png`
(1280×640 layout rendered at 2x → 2560×1280), committed like any
other brand asset and served at:

```
https://openrouter.ai/brand/repo-banners/<repo>.png
```

## Creating or updating a banner

1. Add or edit the repo's entry in `banner-configs.ts`. Keep the
   tagline to one line (~60 chars) and use the repo's real install
   one-liner as `command`. `prompt` is `'$'` for shell commands and
   `null` for non-shell snippets (e.g. the Terraform `source` line).
2. Run `bun run generate:repo-banners` from the monorepo root.
3. Eyeball the regenerated PNGs under
   `projects/web/public/brand/repo-banners/` (title and command must
   not collide with the glyph watermark; long strings should have
   stepped down in size, not wrapped).
4. Commit the PNGs together with the config change.
5. In the target repo, copy the PNG to `assets/banner.png` (the
   Speakeasy-generated repos keep the banner vendored so the README
   renders offline and in registries) and make sure the README starts
   with:

   ```markdown
   ![hero illustration](./assets/banner.png)
   ```

   Once the asset is deployed on openrouter.ai, repos may instead
   hotlink `https://openrouter.ai/brand/repo-banners/<repo>.png` —
   prefer vendoring for registry-rendered READMEs (npm, PyPI,
   Terraform Registry), which may not fetch remote images.

## Design constraints (from `DESIGN.md`)

- Dark theme = Cloud text on Ink with the **Volt** accent; light theme
  = Ink on Cloud with **Grape**. Never mix accents across themes.
- All tints derive from the six brand colors via the hex-alpha opacity
  scale (`14` borders, `05` card fills, `a0`/`b0` muted text) — no new
  hex values.
- Gordita is reserved for the title (brand voice); everything else is
  Plus Jakarta Sans. Sizes stay on even pixel values.
