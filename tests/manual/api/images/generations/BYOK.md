# BYOK e2e for `/api/v1/images` (ECO-943)

Manual, paid, local verification that Bring-Your-Own-Key works on the
dedicated image API with parity to the chat-completions path. Not a CI test —
it forwards a user-supplied provider key to a real upstream and (on the happy
path) spends real money on that provider account.

The route is mounted at `POST /api/v1/images`.

## What this proves

The four ECO-943 acceptance criteria:

1. **Forwarding** — a user's provider key is decrypted and sent upstream by
   the image adapter.
2. **Clean error surfacing** — an invalid user key surfaces the upstream auth
   failure (not a generic 500, and never swallowed).
3. **Billing exclusion** — a BYOK generation opens no OpenRouter inference
   charge: `usage_upstream` is zeroed and the cost lands on
   `byok_usage_inference` instead.
4. **No tx on failure** — a failed BYOK generation records no billing-result
   (no transaction opened).

## Mechanism (how BYOK reaches the image API)

- `BaseImageGenerationAdapter` carries an optional `AdapterBYOKContext`
  (`userProviderAPIKeys` + `user`). For an `is_byok` endpoint, `getAPIKey()`
  resolves the user key via `getUserProvidedKey` and `decrypt()`s it; otherwise
  it falls back to the managed key. (Mirrors `BaseVideoGenerationAdapter`.)
- `packages/image-generation/routing/steps.ts` runs the shared routing steps
  ending in `addBYOKEndpoints`, which synthesizes a per-key `is_byok: true`
  endpoint copy. The worker resolves the model, runs these steps, and selects
  the top endpoint — so a BYOK endpoint can win.
- The worker threads `userProviderAPIKeys` + `user` into the adapter ctor, and
  records `adapter.providerApiKeyId` on the transaction.
- Billing (`image-generation-billing.ts`) already zeroes `usage_upstream` and
  routes cost to `byok_usage_inference` when `endpoint.is_byok`.

## Prerequisites

- Local Postgres up; KV (`all` key) warmed with the image endpoints.
- `services/cfw-image-api/.dev.vars` exported from Infisical
  `/services/cfw-api`. `PROVIDER_ENCRYPTION_KEY` must be present — it is the
  key cfw-image-api decrypts BYOK rows with.
- A staged image endpoint whose `provider_overrides.adapterName` matches a
  current `ImageGenerationAdapterName` enum value. **Gotcha:** older
  locally-staged rows predate an enum rename (e.g. `XAIImageAdapter` →
  `XaiImageAdapter`, `SeedreamAdapter` → `SeedreamImageAdapter`); realign both
  the DB row and the KV `all` blob, then restart the worker so the
  FetchDeduper in-memory cache reloads.
- The image worker:

  ```bash
  cd services/cfw-image-api
  bunx wrangler dev --port 8797 \
    --persist-to /Users/<you>/openrouter-web/.wrangler/shared-state
  ```

## Seed a BYOK key for the local `user1`

`provider_api_keys` is empty on a fresh DB. Insert one row for `user1`,
encrypting the plaintext with `encryptSecretKey`
(`@openrouter-monorepo/db/provider-api-keys/encrypt-secret-key`) — it wraps the
same `encrypt()`/`PROVIDER_ENCRYPTION_KEY` the worker decrypts with, so the
round-trip matches. Minimum columns: `clerk_user_id='user1'`, `provider`
(e.g. `'xAI'`), `cipher`, `nonce`, `label`, `name`, `is_fallback=false`,
`is_required=false`, `deleted=false`, `disabled=false`, `sort_order=0`.

Two gotchas:

- `bun run x` does NOT inject provider keys. Read the plaintext from
  `.dev.vars` and strip the surrounding quotes — the dotenv value is
  single-quoted and an unstripped key fails upstream auth:

  ```bash
  XKEY=$(rg -o "^X_AI_API_KEY=.*" services/cfw-image-api/.dev.vars \
    | sed 's/^X_AI_API_KEY=//' | sed "s/^['\"]//;s/['\"]\$//")
  ```

- Restart the worker after seeding — the per-worker in-memory user cache holds
  `userProviderAPIKeys` for the worker's lifetime, so a freshly-seeded key is
  only picked up on a cold read.

## Run

Happy path (one paid image, ~5¢ on OpenRouter's xAI account):

```bash
curl -sS -X POST http://localhost:8797/api/v1/images \
  -H 'Authorization: Bearer sk-or-v1-unlimitedkey' \
  -H 'Content-Type: application/json' \
  -d '{"model":"x-ai/grok-imagine-image-quality",
       "prompt":"a small red panda","size":"16:9"}'
```

Negative path (no spend): seed a deliberately invalid key, restart the worker,
then send the same curl — the upstream rejects the key.

## Verified results (2026-06-12)

Branch `robinkim/eco-943-byok-compatibility-testing-for-image-gen`.

**Happy path** — HTTP 200, real JPEG returned. `billing-result.log`:

```json
{
  "tx_usage": 0,
  "tx_usage_upstream": 0,
  "tx_byok_usage_inference": 0.05,
  "tx_num_media_completion": 1,
  "sku_items": "{... \"platform:byok_fee\":{...}}"
}
```

`endpoint-resolved.log` showed `is_byok: true`,
`adapter_name: XaiImageAdapter`; response `usage_cost: 0`. → criteria 1
(forwarding) + 3 (billing exclusion: OR-billed usage 0, cost on
`byok_usage_inference`).

**Negative path** — invalid key → `HTTP 502` with body containing the
provider's error message (e.g. `{"error":{"message":"...","code":502,
"metadata":{"provider_name":"xAI"}}}`). Worker log showed `is_byok: true` and
the error raised from `XaiImageGenerationAdapter.generate`. **Zero**
`billing-result` lines emitted. → criteria 2 (clean error surfacing) + 4
(no tx on failure).

## Local-only caveats

- `clickhouse_enqueued: false` and the ClickHouse publish 403 are expected
  locally (no Pub/Sub emulator under standalone wrangler);
  `usage_record_submitted: true` means the binding call did not throw, not that
  anything reached Spanner. Billing-split correctness is read from the
  `billing-result` fs-log, not from a persisted transaction.
