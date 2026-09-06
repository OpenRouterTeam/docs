---
name: testing-alert-delivery-e2e
description: End-to-end test a real webhook/Slack notification delivery (and its failure/redaction behaviour) through the local product UI — bring up the stack, unlock the notification settings UI, point an endpoint at a local sink, trigger a test delivery, and read back the ledger row and worker log.
---

# Testing alert-delivery end-to-end through the product

Use this when you need a **real** `alert_event_delivery` row produced by the
`alert-delivery` worker (delivery success, failure text, redaction, retries)
rather than a unit test.

## 1. Bring the stack up

Follow `local-dev-env` / `tilt-testing`. Minimum set of resources:

```
tilt wait --for=condition=Ready uiresource/postgres postgres-migrate postgres-seed pubsub api web frontend-api
tilt trigger alert-delivery      # Bun/tsup single container, subscribes to alert-delivery-alert-events
tilt logs alert-delivery         # strip ANSI with: sed 's/\x1b\[[0-9;]*m//g'
```

If Tilt was down and its migration step dies with
`No valid login session found, triggering login flow`, Tilt's own process has no
Infisical session. Log in non-interactively and export the token into the
process that starts Tilt:

```
export INFISICAL_TOKEN=$(infisical login --method=universal-auth \
  --client-id=$INFISICAL_CLIENT --client-secret=$INFISICAL_SECRET \
  --plain --silent)   # then start tilt in that shell; never write it to a file
```

Worker startup logs GCE `MetadataLookupWarning: received unexpected error` lines
locally — harmless; readiness is `alert-delivery.consumer-enabled` +
`alert-delivery.started`.

Local Postgres is the `openrouter-web_db` Docker container:

```
docker exec openrouter-web_db psql -U postgres -d postgres -c \
  "select dedup_key, channel, status, failure_reason, response_status, octet_length(last_error) from alert_event_delivery order by created_at desc limit 5;"
```

## 2. Get an authenticated session and unlock the UI

- Use `clerk-dev-signin-token` (mint + consume a Clerk development ticket).
  Avoid the shared password account.
- `/settings/notifications` may hide the Slack / Custom Webhook destination
  cards behind a flag/entitlement. The in-app **dev panel** (bottom-right
  OpenRouter button) exposes both Statsig flags and entitlements; turning on
  `notifications_v2_enabled` locally is what reveals the destination editor.
  If the section is still enterprise-gated, force the `notifications`
  entitlement in the same panel.

## 3. Point the endpoint at a local sink

- Custom Webhook accepts plain `http://localhost:<port>/...` in dev
  (`isAllowedWebhookUrlScheme(url, isDev())`), so a local Node sink works.
  Slack endpoints must be on `hooks.slack.com` — a URL with a fake token
  (`/services/T00000000/B00000000/FAKETOKEN…`) reaches real Slack and returns
  `404 no_team`, which is a good non-2xx credential-in-path case.
- Run the sink from a **persistent shell session** (`exec` with a `shell_id`).
  Background `nohup`/`setsid` processes started in one-shot `exec` calls get
  killed when that shell exits, and the sink silently disappears.
- Save the URL (Save button), then click **Test**. The Test button is disabled
  until the URL is saved.
- **Save the endpoint from a Personal account, not an organization.** If the
  browser has an active Clerk org that has no matching row in local Postgres,
  Save returns 500 and `frontend-api` logs
  `alert_policy_settings_entity_id_fkey` violation. Switch to **Personal** in
  the account menu (top-right) and retry; the ledger `entity_id` then matches
  the `user_…` id.

- The Payload URL field validates client-side: plain `http://` is only accepted for
  `localhost`; any other `http://` host shows an **Invalid URL** badge and disables Save.
  Use `https://…` for an unresolvable-host case and `http://localhost:<closed port>/…`
  for a connection-refused (`fetch_error`) case.
- Toast timing: the failure toast lands ~10-16 s after clicking **Test** (worker retries),
  the success toast ~4-6 s and then auto-dismisses, so screenshot success within ~5 s.

## 4. Read the result

- Since PR #39130 the failing toast is **humanized copy derived from `failure_reason`**
  (`projects/web/app/[locale]/(user)/(dashboard)/settings/notifications/webhook-test-failure-copy.ts`)
  with `(HTTP <status>)` appended, falling back to `last_error` only for an unmapped reason.
  Before that it was literally `alert_event_delivery.last_error`. It is polled by
  `GET /api/frontend/notification-settings/test-webhook/deliveries?dedupKey=…`
  (`listAlertEventDeliveriesByDedupKey`). Always cross-check the toast against the
  ledger row's `failure_reason`, not just against `last_error`.
- Branch-to-reason gotcha: a **non-resolving hostname is classified
  `dns_resolution_failed`** (since #39316), not `fetch_error` and no longer
  `ssrf_blocked`; `ssrf_blocked` now means a destination that resolves to a private
  address, is unparseable, or fails resolution on a redirect hop, and `fetch_error`
  needs a host that resolves but refuses the connection. `dns_resolution_failed` is
  terminal and not retried, so its toast lands on the first attempt.
- The worker emits `alert-delivery:failed` with an `error` field built by the
  same `recordFailure()` call, so ledger and log should be byte-identical.
- Useful branch triggers:
  - non-2xx → `retriable_5xx` / `terminal_4xx`
  - 3xx from the destination → `endpoint_redirected`, generic `non-2xx response`
    (redirects are not followed)
  - unresolvable hostname → `dns_resolution_failed`
  - `https://` host resolving to a private address → `ssrf_blocked`,
    `alertDelivery.deliver:ssrf`
  - 2xx → `delivered`, `last_error` NULL, UI shows a green **Connected** badge
  - **worker stopped** (`tilt disable alert-delivery`, re-enable + `tilt trigger`
    afterwards) → the UI's no-details branch: after ~40 s the toast reads
    "The alert worker did not report a result before the timeout. Try again shortly."
    This is the only way to drive the detail-free fallback from the real UI.
- A genuinely **unmapped `failure_reason` is not emitted by the worker**: since
  PLA-1646 (#39220) the copy map is `satisfies Record<WebhookDeliveryFailureReason,
  string>` over `packages/enums/alert-delivery-failure-reason.ts`, so every reason the
  worker can emit has copy. You can still drive both frontend fallback branches through
  the **real UI + real poll route** by injecting the ledger row yourself:
  `tilt disable alert-delivery`, click **Test**,
  then within the 30 × 1 s poll window pull the queued CloudEvent from the emulator
  (`POST http://localhost:8086/v1/projects/openrouter-dev/subscriptions/alert-delivery-alert-events:pull`),
  read its `id` (= the `dedupKey`), and INSERT one `alert_event_delivery` row with that
  `dedup_key`, the **currently active** `alert_delivery_endpoint.id` (each Save creates a
  new endpoint row — always re-read `where deleted_at is null order by created_at desc
  limit 1`), `channel='webhook'`, `status='failed'` and a bogus `failure_reason`.
  With `last_error` set the toast shows the status-only `last_error`; with `last_error
  NULL` it shows `The endpoint returned an error. Check the URL and try again.`
  Re-enable + `tilt trigger alert-delivery` afterwards.
  Note the map lookup is a `ReadonlyMap`; if it ever breaks, the symptom is the toast
  showing the raw `last_error` (e.g. `non-2xx response (status 401, code unauthorized)`)
  or `(HTTP undefined)`, so screenshot the exact toast text rather than trusting a pass.
  `fan_out_capped` copy exists but is unreachable from the single-endpoint test path.

## 5. Known / possible weak spots to check

- Non-2xx `last_error` is now a fixed diagnostic built by
  `services/alert-delivery/src/response-body-diagnostic.ts`:
  `non-2xx response (status <s>)`, or `… , code <c>)` only when the body is a
  bare code matching `^[a-z][a-z0-9_]{2,39}$` (≤64 bytes) or JSON whose
  top-level `error` field is such a code. Verify with both a code-shaped body
  and a hostile blob/HTML body plus a canary string — the allowlist is the
  thing most likely to regress into echoing bodies again.
- Old rows from earlier runs can still contain raw destination bodies, so when
  grepping the DB for canaries always filter by `created_at` or dedup key of
  the delivery you just triggered, or you will report a stale leak.
- Worker-log greps for `/services/` also hit our own stack-trace file paths
  (for example, `services/alert-delivery/src/delivery.ts`); match on the
  destination token/canary, not on `/services/` alone.
- Transport-failure `last_error` is also a fixed phrase per classified guard
  failure since #39300 (e.g. `destination address is not allowed`), so the
  destination host no longer appears on the `fetch_error` / DNS branches either.
  Grep the ledger row for the destination host on every transport branch, not just
  on the non-2xx one.
- The SSRF / DNS-failure branch once serialized a whole internal `ErrorT`
  including a stack trace with absolute server file paths into `last_error`,
  and therefore into the customer toast. Fixed in PLA-1455 (#37952) by reducing
  the error to its `message` before redaction; still worth a regression check on
  every branch that passes a structured error rather than a string.
- The `/services/…` collapse rule also rewrites internal source paths
  (`services/alert-delivery/src/delivery.ts` → a redacted path), so redacted
  output can look mangled rather than leaked.

## Devin Secrets Needed

- `INFISICAL_CLIENT` / `INFISICAL_SECRET` (org-wide) for `infisical login --method=universal-auth`.
- Clerk development instance access for the sign-in-ticket flow
  (see `clerk-dev-signin-token`).
