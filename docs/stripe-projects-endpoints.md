# Stripe Projects Integration — Endpoints

All endpoints are mounted under `services/cfw-public-api/src/routes/provisioning/`. Orchestrator-facing endpoints require HMAC-SHA256 (`Stripe-Signature` header) + `API-Version: 0.1d` header. User-facing endpoints (`/oauth/token`, `/provisioning/confirm-link`) are excluded from API-Version validation.

| # | Method | Path | Issue | Status | Purpose |
|---|--------|------|-------|--------|---------|
| 1 | `GET` | `/provisioning/health` | [ENT-891](https://linear.app/openrouter/issue/ENT-891) | In Review | Availability check, returns supported versions |
| 2 | `POST` | `/provisioning/account_requests` | [ENT-851](https://linear.app/openrouter/issue/ENT-851) | In Review | Create account from KYC email, return credentials or auth redirect |
| 3 | `GET` | `/provisioning/services` | [ENT-884](https://linear.app/openrouter/issue/ENT-884) | In Progress | Service catalog discovery (e.g. `pay_as_you_go`) |
| 4 | `POST` | `/provisioning/resources` | [ENT-885](https://linear.app/openrouter/issue/ENT-885) | In Progress | Provision a resource (mint API key) |
| 5 | `GET` | `/provisioning/resources/:id` | [ENT-885](https://linear.app/openrouter/issue/ENT-885) | In Progress | Check resource provisioning status |
| 6 | `POST` | `/provisioning/resources/:id/update_service` | [ENT-885](https://linear.app/openrouter/issue/ENT-885) | In Progress | Non-destructively update a resource service |
| 7 | `POST` | `/provisioning/resources/:id/remove` | [ENT-885](https://linear.app/openrouter/issue/ENT-885) | In Progress | Revoke API key / remove resource |
| 8 | `POST` | `/provisioning/resources/:id/rotate_credentials` | [ENT-885](https://linear.app/openrouter/issue/ENT-885) | In Progress | Rotate API key |
| 9 | `POST` | `/provisioning/deep_links` | [ENT-885](https://linear.app/openrouter/issue/ENT-885) | In Progress | Generate short-lived dashboard URL |
| 10 | `POST` | `/oauth/token` | [ENT-893](https://linear.app/openrouter/issue/ENT-893) | In Review | OAuth code exchange and token refresh |
| 11 | `POST` | `/provisioning/confirm-link` | [ENT-895](https://linear.app/openrouter/issue/ENT-895) | In Review | Internal — frontend calls after user login, triggers outbound confirmation to Stripe |
