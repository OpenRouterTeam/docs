---
name: add-router-model
description: Add a new router model to OpenRouter — covers RouterModel enum, plugin implementation, init-plugins wiring, seed verification, plugin settings UI, and testing checklist
user-invocable: true
---

# Add Router Model

Follow this checklist when adding a new router model
(e.g. `openrouter/pareto-code`, `openrouter/auto`,
`openrouter/fusion`). Router models are abstract placeholders
that resolve to concrete provider endpoints at request time
via a router plugin.

## Prerequisites

- Local Postgres running (`bun run db:start`)
- Familiarity with the plugin system in
  `packages/router/plugins/`

## Arguments

- `$ROUTER_SLUG`: Full model slug
  (e.g. `openrouter/pareto-code`)
- `$ROUTER_KEY`: PascalCase key for the `RouterModel` enum
  (e.g. `ParetoCode`)
- `$PLUGIN_DIR`: Directory name under
  `packages/router/plugins/` (e.g. `pareto-router`)
- `$PLUGIN_CLASS`: PascalCase plugin class name
  (e.g. `ParetoRouterPlugin`)

## Steps

### 1. Add enum value to `packages/models/id/router.ts`

Add the new router to the `RouterModel` const object:

```ts
// packages/models/id/router.ts
export const RouterModel = {
  // ... existing entries ...
  $ROUTER_KEY: '$ROUTER_SLUG',
} as const;
```

### 2. Create the router plugin

Create a new directory under `packages/router/plugins/$PLUGIN_DIR/`
with at minimum:

- `index.ts` — the plugin class
- `index.test.ts` — plugin unit tests
- `TESTING.md` — local and prod testing instructions

Use an existing router plugin as reference:

- **Simple selection**: See `free-router/` (random selection
  from a model list)
- **Tier-based selection**: See `pareto-router/` (tier
  thresholds with fallback)
- **AI-powered routing**: See `auto-router/` (meta-model
  analysis)
- **Multi-model orchestration**: See `fusion/` (parallel
  execution and merge)

Key patterns every router plugin must follow:

1. **Guard clause**: Return early (no-op) if the request
   model doesn't match your router slug. Use
   `RouterModel.$ROUTER_KEY` for the check.
2. **Placeholder endpoint**: Call
   `createRouterModelPlaceholderEndpoint()` from
   `@openrouter-monorepo/routing/endpoints/router-placeholder`
   during init to pass through the router's startup phase.
3. **Resolve in `resolveEndpoints`**: Replace the placeholder
   with real endpoint(s) selected by your routing logic.
4. **Thread `routerRequest`**: Set
   `routerRequest.model` / `routerRequest.permaslug` to the
   resolved concrete model so downstream plugins and the
   adapter see the real model, not the router slug.
5. **Log metadata**: Attach routing metadata (requested tier,
   actual tier, resolved model, fallbacks) to the router
   metadata plugin via `routerRequest.routerMetadata`.

### 3. Register in `packages/router/plugins/base/init-plugins.ts`

Import your plugin and add it to the `initPlugins` array.
Router plugins run early — place yours alongside the other
router plugins (auto-router, free-router, pareto-router,
latest-router):

```ts
import { $PLUGIN_CLASS } from '../$PLUGIN_DIR';

// In the plugins array, near other router plugins:
new $PLUGIN_CLASS({
  ...commonPluginOpts,
  modelsCache,
  endpointsCache,
  ...(overrides?.getCachedEndpoints && {
    getCachedEndpoints: overrides.getCachedEndpoints,
  }),
}),
```

### 4. Add the model row in production

Router models are created in prod Mission Control, not via
migration:

1. Open prod Mission Control and add the model row:
   - `group` = `Router`
   - `slug` / `permaslug` = `$ROUTER_SLUG`
   - `hidden` = `true` (until launch)
   - `input_modalities` = `{text}`,
     `output_modalities` = `{text}`
   - Set `context_length` to the max of models in
     your routing pool
2. Router models do **not** need endpoint rows — the plugin
   creates placeholder endpoints at request time via
   `createRouterModelPlaceholderEndpoint`.

### 5. Verify model appears in seed CSV

The `Refresh Models and Endpoints` workflow syncs prod rows
into `postgres/seeds/models_rows.csv`. After the model exists
in prod:

```bash
# Trigger refresh (or wait for daily 13:00 UTC cron)
gh workflow run "Refresh Models and Endpoints" \
  --repo OpenRouterTeam/openrouter-web

# After the auto-PR merges, verify:
grep '$ROUTER_SLUG' postgres/seeds/models_rows.csv
```

If the model is not yet in the seed CSV (e.g. it was just
created in prod), you can verify locally by inserting
directly into the local DB:

```sql
INSERT INTO models (
  slug, name, description, "group", hidden,
  context_length, permaslug, deleted, author_id,
  input_modalities, output_modalities
) VALUES (
  '$ROUTER_SLUG',
  '<Display Name>',
  '<Description>',
  'Router',
  false,
  <context_length>,
  '$ROUTER_SLUG',
  false,
  (SELECT id FROM model_authors WHERE slug = 'openrouter'),
  '{text}',
  '{text}'
) ON CONFLICT (permaslug) DO NOTHING;
```

Then run `bun run db:reset` to confirm the seed CSV works for
a clean reset.

**Important**: Router models do NOT need endpoint seeds. They
resolve to other models' endpoints at request time. Do not
add endpoint rows for router models.

### 6. Add plugin settings UI (if user-configurable)

If the router has user-configurable defaults (like
pareto-router's `min_coding_score`), add it to the plugin
settings UI:

1. **Add plugin schema** in
   `packages/llm-interfaces/plugins/<plugin>/schemas.ts` if one
   doesn't exist. Define a Zod schema for the plugin's
   config (e.g. `ParetoRouterPreferencesSchema`).

2. **Add to `PluginId` enum** in `packages/enums/plugins.ts`
   if not already there.

3. **Add row to `CONFIGURABLE_PLUGINS`** in
   `projects/web/app/[locale]/(user)/(dashboard)/workspaces/[workspaceId]/plugins/PluginsSection.tsx`:

   ```ts
   {
     id: PluginId.YourRouter,
     name: 'Your Router',
     description: 'Description of what this router does',
     docsUrl: 'https://openrouter.ai/docs/...',
     hasConfig: true,
   },
   ```

4. **Add config form** in `PluginConfigureModal.tsx` with a
   branch for your plugin ID. Follow the pattern used by
   pareto-router (tier presets + optional advanced/custom
   input).

5. **Add PostHog events** for the new plugin interactions.

6. **Update docs**:
   - Add to the Available Plugins table in
     `projects/docs/guides/features/plugins.mdx`
   - Create or update the router's docs page under
     `projects/docs/guides/routing/routers/`

### 7. Write tests

- **Unit tests**: `$PLUGIN_DIR/index.test.ts` — test config
  parsing, model resolution at each configuration, error
  paths, and log metadata.
- **Pipeline tests**: `$PLUGIN_DIR/pipeline.test.ts` — test
  the plugin in context with sibling plugins via
  `applyPluginResolveEndpoints`.
- **Run tests**:

  ```bash
  bun run --filter @openrouter-monorepo/router test \
    packages/router/plugins/$PLUGIN_DIR
  ```

### 8. Local e2e verification

```bash
bun run dev:up
tilt wait --for=condition=Ready uiresource/api uiresource/api-kv-cron --timeout=300s
tilt enable dev-fs-logs
tilt trigger dev-fs-logs
```

Send a request:

```bash
curl -sS -X POST http://localhost:8787/api/v1/chat/completions \
  -H "Authorization: Bearer sk-or-v1-unlimitedkey" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "$ROUTER_SLUG",
    "messages": [{"role": "user", "content": "hello"}],
    "stream": false
  }' | jq '.model, .provider'
```

Check `services/dev-fs-logs/.logs/` for the generation folder
and verify routing metadata in `router/transaction-attempt.log`.

## Existing Router Models

| Slug | Plugin | Description |
|------|--------|-------------|
| `openrouter/auto` | `auto-router` | AI-powered routing via meta-model analysis |
| `openrouter/free` | `free-router` | Random selection from free models |
| `openrouter/pareto-code` | `pareto-router` | Tier-based coding model selection |
| `openrouter/fusion` | `fusion` | Multi-model parallel execution and merge |
| `openrouter/bodybuilder` | `bodybuilder` | Model selection for specific tasks |

## Reference Files

- `packages/models/id/router.ts` — `RouterModel` enum
- `packages/routing/endpoints/router-placeholder.ts` —
  placeholder endpoint factory
- `packages/router/plugins/base/init-plugins.ts` — plugin
  registration order
- `packages/router/plugins/router-metadata/` — routing
  metadata collection
- `postgres/seeds/models_rows.csv` — model seed data
  (auto-synced from prod)
- `projects/web/.../plugins/PluginsSection.tsx` — plugin
  settings UI
