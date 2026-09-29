---
name: add-router-model
description: Add a new router model to OpenRouter. Covers the RouterModel enum, plugin implementation, init-plugins wiring, seed verification, plugin settings UI, and testing checklist
user-invocable: true
---

# Add a router model

Follow this checklist when you add a new router model, such as `openrouter/pareto-code`, `openrouter/auto`, or `openrouter/fusion`. Router models are abstract placeholders that a router plugin resolves to concrete provider endpoints at request time.

## Prerequisites

- Local Postgres is running (`bun run db:start`).
- You are familiar with the plugin system in `packages/router/plugins/`.

## Arguments

- `$ROUTER_SLUG`: The full model slug, such as `openrouter/pareto-code`.
- `$ROUTER_KEY`: The PascalCase key for the `RouterModel` enum, such as `ParetoCode`.
- `$PLUGIN_DIR`: The directory name under `packages/router/plugins/`, such as `pareto-router`.
- `$PLUGIN_CLASS`: The PascalCase plugin class name, such as `ParetoRouterPlugin`.

## Steps

### Add the enum value

Add the new router to the `RouterModel` const object in `packages/models/id/router.ts`:

```ts
// packages/models/id/router.ts
export const RouterModel = {
  // ... existing entries ...
  $ROUTER_KEY: '$ROUTER_SLUG',
} as const;
```

### Create the router plugin

Create a new directory under `packages/router/plugins/$PLUGIN_DIR/` with at least the following files:

- `index.ts`: The plugin class.
- `index.test.ts`: Plugin unit tests.
- `TESTING.md`: Local and production testing instructions.

Use an existing router plugin as a reference:

- **Simple selection**: See `free-router/`, which selects at random from a model list.
- **Tier-based selection**: See `pareto-router/`, which uses tier thresholds with fallback.
- **AI-powered routing**: See `auto-router/`, which uses meta-model analysis.
- **Multi-model orchestration**: See `fusion/`, which runs models in parallel and merges the results.

Every router plugin must follow these patterns:

1. **Guard clause**: Return early (no-op) if the request model doesn't match your router slug. Use `RouterModel.$ROUTER_KEY` for the check, and read `routerRequest.requestedModelSlugs`, not `rawModelSlugs`. `rawModelSlugs` is empty when the router slug comes from the account or workspace default model, so a guard on it never fires and the placeholder is dropped with a `404`.
2. **Placeholder endpoint**: Call `createRouterModelPlaceholderEndpoint()` from `@openrouter-monorepo/routing/endpoints/router-placeholder` during init to pass through the router's startup phase.
3. **Resolve in `resolveEndpoints`**: Replace the placeholder with the real endpoints that your routing logic selects. `applyPluginResolveEndpoints` drops any placeholder that is still present after this phase. A plugin that resolves later, in the completion hook like `bodybuilder`, must be listed in `COMPLETION_RESOLVED_ROUTER_MODELS` in `packages/router/plugins/base/resolve-endpoints.ts`.
4. **Thread `routerRequest`**: Set `routerRequest.model` and `routerRequest.permaslug` to the resolved concrete model so that downstream plugins and the adapter see the real model, not the router slug.
5. **Log metadata**: Attach routing metadata (requested tier, actual tier, resolved model, and fallbacks) to the router metadata plugin through `routerRequest.routerMetadata`.

### Register the plugin

In `packages/router/plugins/base/init-plugins.ts`, import your plugin and add it to the `initPlugins` array. Router plugins run early, so place yours alongside the other router plugins (`auto-router`, `free-router`, `pareto-router`, and `latest-router`):

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

### Add the model row in production

Router models are created in production Mission Control, not through a migration.

1. In production Mission Control, add the model row with the following values:
   - `group` = `Router`
   - `slug` and `permaslug` = `$ROUTER_SLUG`
   - `hidden` = `true` (until launch)
   - `input_modalities` = `{text}` and `output_modalities` = `{text}`
   - `context_length` = the maximum context length of the models in your routing pool
2. Don't add endpoint rows. Router models don't need them, because the plugin creates placeholder endpoints at request time through `createRouterModelPlaceholderEndpoint`.

### Verify that the model appears in the seed CSV

The `Refresh Models and Endpoints` workflow syncs production rows into `postgres/seeds/models_rows.csv`. After the model exists in production, trigger the refresh, or wait for the daily 13:00 UTC cron:

```bash
gh workflow run "Refresh Models and Endpoints" \
  --repo OpenRouterTeam/openrouter-web
```

After the automated PR merges, verify that the row is present:

```bash
grep '$ROUTER_SLUG' postgres/seeds/models_rows.csv
```

If the model is not yet in the seed CSV, for example because it was just created in production, you can verify locally by inserting it into the local database:

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

Then run `bun run db:reset` to confirm that the seed CSV works for a clean reset.

Router models don't need endpoint seeds. They resolve to the endpoints of other models at request time. Don't add endpoint rows for router models.

### Add the plugin settings UI

This step is optional. If the router has user-configurable defaults, like the `min_coding_score` setting of `pareto-router`, add it to the plugin settings UI:

1. **Add a plugin schema** in `packages/llm-interfaces/plugins/<plugin>/schemas.ts` if one doesn't exist. Define a Zod schema for the plugin's config, such as `ParetoRouterPreferencesSchema`.

2. **Add the plugin to the `PluginId` enum** in `packages/enums/plugins.ts` if it isn't already there.

3. **Add a row to `CONFIGURABLE_PLUGINS`** in `projects/web/app/[locale]/(user)/(dashboard)/workspaces/[workspaceId]/plugins/PluginsSection.tsx`:

   ```ts
   {
     id: PluginId.YourRouter,
     name: 'Your Router',
     description: 'Description of what this router does',
     docsUrl: 'https://openrouter.ai/docs/...',
     hasConfig: true,
   },
   ```

4. **Add a config form** in `PluginConfigureModal.tsx` with a branch for your plugin ID. Follow the pattern that `pareto-router` uses: tier presets plus an optional advanced or custom input.

5. **Add PostHog events** for the new plugin interactions.

6. **Update the docs**:
   - Add the router to the Available Plugins table in `projects/docs/guides/features/plugins.mdx`.
   - Create or update the router's docs page under `projects/docs/guides/routing/routers/`.

### Forward the config on server-tool inner turns

After you add the schema to `PluginPreferenceSchema` (`packages/llm-interfaces/plugins/schemas.ts`), `bun run typecheck` fails in `toSdkRouterPlugins` (`packages/router/plugins/server-tools/build-callmodel-input.ts`) until you add a case for the new plugin ID. The case maps the snake_case request fields to the SDK's camelCase plugin type in `@openrouter/sdk/models/<plugin>.js`. If the SDK type doesn't exist yet, bump the SDK first. Add a colocated test for the mapping. Without the case, the inner `callModel` turns of a server-tool request run the router without the caller's restrictions.

### Write tests

- **Unit tests** (`$PLUGIN_DIR/index.test.ts`): Test config parsing, model resolution at each configuration, error paths, and log metadata.
- **Pipeline tests** (`$PLUGIN_DIR/pipeline.test.ts`): Test the plugin in context with sibling plugins through `applyPluginResolveEndpoints`.

Run the tests:

```bash
bun run --filter @openrouter-monorepo/router test \
  packages/router/plugins/$PLUGIN_DIR
```

### Verify locally end to end

Start the local stack and enable request logging:

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

In `services/dev-fs-logs/.logs/`, open the generation folder and verify the routing metadata in `router/transaction-attempt.log`.

## Existing router models

The following table lists the router models that exist today and the plugin that resolves each one.

| Slug | Plugin | Description |
|------|--------|-------------|
| `openrouter/auto` | `auto-router` | AI-powered routing through meta-model analysis |
| `openrouter/free` | `free-router` | Random selection from free models |
| `openrouter/pareto-code` | `pareto-router` | Tier-based coding model selection |
| `openrouter/fusion` | `fusion` | Multi-model parallel execution and merge |
| `openrouter/bodybuilder` | `bodybuilder` | Model selection for specific tasks |

## Reference files

- `packages/models/id/router.ts`: The `RouterModel` enum.
- `packages/routing/endpoints/router-placeholder.ts`: The placeholder endpoint factory.
- `packages/router/plugins/base/init-plugins.ts`: The plugin registration order.
- `packages/router/plugins/router-metadata/`: Routing metadata collection.
- `postgres/seeds/models_rows.csv`: Model seed data, synced automatically from production.
- `projects/web/.../plugins/PluginsSection.tsx`: The plugin settings UI.
