---
name: testing-provider-dashboard
description: How to test provider-dashboard endpoint editor features (e.g. rate-limit/feature toggles) end-to-end on local Tilt, including seeding a provider owner and avoiding the "Failed to load endpoint" 404 trap.
---

# Testing the provider dashboard endpoint editor locally

## Stack
- `env TILT_PROFILE=lean tilt up`; wait on explicit resources: `postgres`, `postgres-migrate`, `postgres-seed`, `api`, `api-kv-cron`, `frontend-api`, `web` (do not wait `--all`; manual resources never become ready).
- Web: http://localhost:3000, frontend-api: :8795, cfw-api: :8787, Postgres: docker container `openrouter-web_db` port 54322.
- If Tilt stalls pulling `hiett/serverless-redis-http:0.0.10`, `docker pull` it manually and restart Tilt.

## Auth
- Use the `clerk-dev-signin-token` skill to mint a single-use sign-in ticket for a local Clerk dev user and consume it via the Clerk client in the browser.

## Seeding a provider owner with usable endpoints
- Pick a provider having both free and standard endpoints:
  `select provider_name, sum((variant='free')::int), sum((variant='standard')::int) from endpoints group by 1;`
- Make the dev user an owner: `update providers set owners='{<clerk_user_id>}' where provider_name='<Name>';`
- **Trap:** the endpoint edit page shows "Failed to load endpoint" (GET `/provider-dashboard/providers/:slug/:id/get` → 404) when the endpoint row has `deleted=true` or is missing from the web-endpoints KV cache. Local seed data often has `deleted=t` / `hidden=t`. Fix with:
  `update endpoints set deleted=false, hidden=false where id='<id>';`
  then `tilt trigger api-kv-cron` and wait ~30s.
- Edit URLs: `/provider/<slug>/dashboard/endpoint/edit/<endpoint-id>` (Rate Limits section is in the Configuration panel).

## Verifying persistence
- Feature flags saved via the limits route land in `endpoints.features` jsonb:
  `select features from endpoints where id='<id>';`
- The 404s from this route log nothing (`verifyEndpointOwnershipFromDb` returns notFound without eLog) — check `deleted`/`hidden` in the DB first before chasing logs.

## Cleanup
- Revert owners, `hidden`, `deleted`, and remove test feature keys (`features - '<key>'`) after testing; do not commit DB tweaks.

## Workload-scoped performance and catalog sorting
- For V5 reader checks, seed distinct text/image rows in local `endpoint_perf_minute_v5` and verify the response changes when selecting `Image generation`. A rendered empty chart or a built-in local mock only proves the component/response shell.
- Catalog chooses a representative endpoint that can belong to a different provider than the dashboard endpoint. Inspect the browser `models/find` response's `models[].endpoint.id` before seeding; metrics for a non-selected endpoint do not prove catalog sorting.
- Catalog performance comes from the workload map in warmed endpoint KV. Keep fixtures within the 30-minute window and trigger the normal local `http://localhost:8787/__scheduled?cron=*/5+*+*+*+*` warmer. Inspect `endpoint_perf` in the captured `models/find` response, not `models[].endpoint.perf_last_30m_by_workload`, which is stripped from the public response.
- Existing catalog URLs may retain old response-cache data after KV warming. Compare a fresh UI filter query and let the existing cache expire before claiming an unfiltered retest. In table view, verify both monotone numeric values and unknowns-last across the complete captured response.
- Workload selection may reset during endpoint section-anchor navigation. Check the selector and URL after navigating rather than assuming a captured chart still represents the previously selected workload.

## Devin Secrets Needed
- `INFISICAL_CLIENT`, `INFISICAL_SECRET` for the local dev stack and Clerk ticket flow; see `clerk-dev-signin-token`.
