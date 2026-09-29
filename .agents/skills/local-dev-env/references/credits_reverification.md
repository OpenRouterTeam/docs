# Credits and reverification checks

`/settings/credits` needs `usage-record` (port 8801) during SSR in addition to `web` and `frontend-api`. Without Tilt, a minimal slice is `WRANGLER_INSPECTOR_PORT=0 bun run dev web cfw-frontend-api usage-record` under the documented Infisical bootstrap; wait for its Spanner and Pub/Sub readiness too.

- Use inspector port `0` when several Wrangler services share a host. The standalone default inspector port collides even when HTTP ports differ.
- If `usage-record` reports missing `VERCEL_OIDC_OWNER` or `VERCEL_OIDC_ALLOWED_PROJECTS`, check the complete root and service Infisical environment first. Local-only placeholders may unblock development when explicitly authorized; never propagate them to a deployed environment.
- Auto top-up posts to `/api/frontend/v1/private/triggers`. From Credits, click **Enable** or **Manage** to reach **Enable auto top up**.
- A combined threshold + card save also posts (not PATCHes) `/api/frontend/v1/private/users/current` after the trigger write and its GET refetch. A card-only edit must skip the trigger POST. Check the dialog lock (disabled fields, hidden close control, Escape) after that refetch, not only during the first write: a form reset during refetch can clear library-owned submitting state.
- Real responses are usually too fast to inspect the lock. Hold delivery of the already-successful second response via CDP without changing request, auth, or response contents, release within the mutation deadline, and detach afterward.
- A fresh sign-in does not trigger Clerk reverification. Inspect only the JWT `fva` tuple (never log the token). The `strict_mfa` freshness window is 10 minutes, and Clerk falls back to first-factor freshness when no second factor is enrolled (`fva[1] === -1`). Let the real session age past the window instead of forging tokens or mocking responses, and recheck when the Clerk version changes.
- An unenrolled user sees Clerk's **Verification required** email-code modal, not an enrollment error. Capture the real 403 metadata and UI before dismissing, then check both the immediate toasts and the persisted setting after reload.
