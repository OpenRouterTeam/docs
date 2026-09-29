# OpenRouter Docs Proxy

This Cloudflare Worker proxies requests to the OpenRouter API documentation hosted on Mintlify.

## Getting Started

1. Install dependencies from the root of the monorepo:

```bash
bun install
```

2. Start the development server:

```bash
bun run dev cfw-docs-proxy
```

The proxy will be available at `http://localhost:8787` by default.

## Development

The service proxies `/docs/*` and `/mintlify-assets/*` requests to the Mintlify-hosted documentation site by swapping the hostname to the Mintlify subdomain and setting `Host` / `X-Forwarded-Host` / `X-Forwarded-Proto` headers. Depending on the Mintlify dashboard subpath config, static assets (CSS, JS, fonts, its own Next bundle) may be served under `/mintlify-assets`, so both prefixes are proxied.

The worker's routes are declared in `wrangler.toml` and applied on deploy. They cover `openrouter.ai/docs`, `openrouter.ai/docs/*`, and `openrouter.ai/mintlify-assets/*`.

## Bundle Analysis

To analyze the bundle size and understand what's included in your Worker bundle:

1. **Generate the bundle and metafile:**

   ```bash
   bun run cf:bundle
   ```

   Or with minification:

   ```bash
   bun run cf:bundle:min
   ```

   This will:
   - Build the bundle using the same process as `wrangler deploy` (via `--dry-run`)
   - Output the bundle to `./dist/`
   - Generate an esbuild metafile at `./bundle-meta.json`

2. **Analyze the bundle:**

   ```bash
   bun run cf:bundle:analyze
   ```

   This will open an interactive visualization of your bundle using `esbuild-visualizer` locally.

## Deployment

The service is automatically deployed to Cloudflare Workers when changes are pushed to the main branch.

To manually deploy:

```bash
bun run submit cfw-docs-proxy
```

