---
name: clerk-dev-signin-token
description: Headless login to the local development app with a Clerk sign-in ticket. Supports the seeded account or an optional isolated user for auth testing.
---

# Clerk development sign-in tokens

Start the app with [local-dev-env](../local-dev-env/SKILL.md). Use this helper when browser automation needs a sign-in ticket; the seeded account's email-code login remains the default manual path.

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

Open `<web-origin>/sign-in`. For manual login, enter the returned email, choose **Use another method** → **Email code**, and enter `424242`.

For browser automation that supports page JavaScript, wait for `window.Clerk.loaded` and call the same ticket flow used in `tests/web-e2e/global-setup.ts`:

```javascript
const result = await window.Clerk.client.signIn.create({
  strategy: 'ticket',
  ticket: '<ticket>',
});
if (result.status === 'complete') {
  await window.Clerk.setActive({ session: result.createdSessionId });
}
```

For Mission Control, enable `internal` and `mission-control` using local-dev-env, use its Tilt origin, and run the scripted flow after Clerk loads. The same development Clerk tenant is used; the local user also needs `users.is_admin = true`.

Confirm the active user and workspace match the test. Select **Personal** for personal-account tests; retain the intended organization for organization tests. Remove the ticket file after use.

## Troubleshooting

- If already signed in as another user, sign out before consuming a new ticket. If `session_exists` appears while `window.Clerk.user` is empty, inspect `window.Clerk.client.sessions` and activate the existing session before retrying.
- A browser automation evaluation can time out after sign-in succeeds. Check the active session before consuming another single-use ticket.
- A newly created Clerk user is not automatically a fully provisioned local app user. See [isolated users](../local-dev-env/references/isolated_users.md) for webhook sync, onboarding, credits, and permission fixtures.
- This helper is for the development Clerk tenant. The `/tests/e2e` password credentials are for deployed-site tests.
