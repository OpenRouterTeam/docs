---
name: clerk-dev-signin-token
description: Headless login to the local development app with a Clerk sign-in ticket. Supports the seeded account or an optional isolated user for auth testing.
---

# Clerk development sign-in tokens

Start the app with [local-dev-env](../local-dev-env/SKILL.md). This is the default way to sign in locally. Submitting an email in the `/sign-in` form sends a magic link to that mailbox, and the seeded account's mailbox is shared, so the form is not a fallback for `dev+clerk_test@openrouter.ai`.

## Mint a ticket

From the repository root, with an authenticated Infisical session (see [Secret Management](../../../AGENTS.md#secret-management)):

```bash
export TICKET_FILE=$(mktemp -t clerk-ticket.XXXXXX)
trap 'rm -f "$TICKET_FILE"' EXIT
infisical run --projectId=771b7bc0-6578-41b0-886e-9fcdb66e9173 \
  --env=dev --path=/projects/web -- \
  bun run scripts/clerk-dev-signin-token.ts \
    --email dev+clerk_test@openrouter.ai > "$TICKET_FILE"
```

The JSON contains `user_id`, `email`, and `ticket`. Tickets are single-use and expire after 10 minutes. The script requires a development `sk_test_` Clerk key.

| Script option | User selected |
| --- | --- |
| `--email <email>` | Reuses that account, creating it if absent. The example selects the seeded account. |
| No user option | Reuses one generated account per machine, using `/etc/machine-id` or the hostname as a fallback. |
| `--fresh` | Creates a new account. Use for [isolated auth tests](../local-dev-env/references/isolated_users.md). |
| `--cleanup` | Deletes generated accounts inactive for over a day instead of minting a ticket. |

Each mint also attempts cleanup of stale generated accounts. Activity includes the last ticket mint, sign-in, or creation; the just-minted user is excluded.

## Sign in

Get the actual app origin from Tilt:

```bash
tilt get uiresources -o json \
  | jq -r '.items[] | select(.metadata.name=="web") | .status.endpointLinks[]?.url'
```

Open `<web-origin>/sign-in`, wait for `window.Clerk.loaded`, and call the same ticket flow used in `tests/web-e2e/global-setup.ts`:

```javascript
const result = await window.Clerk.client.signIn.create({
  strategy: 'ticket',
  ticket: '<ticket>',
});
if (result.status === 'complete') {
  await window.Clerk.setActive({ session: result.createdSessionId });
}
```

If the automation cannot run page JavaScript, use `--fresh` and sign the generated user in through the form with **Use another method** → **Email code** → `424242`. The form's magic link is addressed to the generated user, so the shared dev inbox receives nothing.

For Mission Control, enable `internal` and `mission-control` using local-dev-env, use its Tilt origin, and run the scripted flow after Clerk loads. The same development Clerk tenant is used; the local user also needs `users.is_admin = true`.

Confirm the active user and workspace match the test. Select **Personal** for personal-account tests; retain the intended organization for organization tests. Remove the ticket file after use.

## Troubleshooting

- OAuth consent at `/auth` can show “Select a credit amount” for an unfunded account even after sign-in. Click “Maybe later! I'll start with free models.” to reach consent without adding credits; repeat after fresh navigation or account changes if the prompt returns. Wait for the consent account-picker button to hydrate before switching accounts (PR #42191).
- A ticket can still leave an MFA-enabled seeded account at `needs_second_factor`. Do not disable its MFA. If the test does not require that account's data or organization, use `--fresh` and complete local onboarding; otherwise obtain the account's authorized second factor before proceeding.
- If already signed in as another user, sign out before consuming a new ticket. If `session_exists` appears while `window.Clerk.user` is empty, inspect `window.Clerk.client.sessions` and activate the existing session before retrying.
- A browser automation evaluation can time out after sign-in succeeds. Check the active session before consuming another single-use ticket.
- A newly created Clerk user is not automatically a fully provisioned local app user. See [isolated users](../local-dev-env/references/isolated_users.md) for webhook sync, onboarding, credits, and permission fixtures.
- Reverification tests: a ticket-created session is fresh, so a Clerk `lax` gate may pass without a prompt, and `strict_mfa` is satisfied even with no second factor enrolled (Clerk falls back to a recent first factor when the second-factor age is `-1`). For a real 403, let the session age past 10 minutes without signing in again. Do not edit a signed JWT's `fva` claim to simulate aging. If explicitly authorized, force the server gate stale with a temporary local-only edit, label that evidence, and restore the real gate while the Clerk modal is open before testing its automatic retry. Check `session.checkAuthorization({ reverification: 'strict_mfa' })` and the `fva` claim only; never log the full token.
- The generated `+clerk_test_*` user's email-code reverification accepts the development code `424242`; use the real modal, not a mocked Clerk callback. Completing it refreshes the first factor and exercises the retry, but does not prove second-factor enforcement. Verify cancellation separately.
- Headless cookie auth against a local worker (a `__session` JWT from `sessions.getToken` sent as a cookie, no browser) returns `signed-out` with reason `dev-browser-missing` on the development tenant. Add `__clerk_db_jwt=<token>` from `POST https://<dev fapi host>/v1/dev_browser` to the cookie header. Production instances do not need it (PR #43328).
- This helper is for the development Clerk tenant. The `/tests/e2e` password credentials are for deployed-site tests.

## Devin Secrets Needed

- `CLERK_SECRET_KEY` for the development tenant, supplied by the documented Infisical `/projects/web` environment; never use a production key for this helper.
- `INFISICAL_CLIENT` and `INFISICAL_SECRET` for the Infisical machine-identity login when no authenticated Infisical session exists. Do not copy the Clerk secret or sign-in tickets into shared artifacts.
