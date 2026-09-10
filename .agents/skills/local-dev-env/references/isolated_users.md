# Isolated users for auth testing

Use the seeded `dev+clerk_test@openrouter.ai` account for ordinary local testing. Create a separate user when the test depends on onboarding, account ownership, roles, or access denial.

## Create and sign in

1. Start the stack with [local-dev-env](../SKILL.md). Confirm `webhooks` and `clerk-webhook` are running so new Clerk users sync into local Postgres.
1. Follow [Clerk sign-in tokens](../../clerk-dev-signin-token/SKILL.md), replacing `--email dev+clerk_test@openrouter.ai` with `--fresh`. Save the returned `user_id` for the commands below. With no user option, the script reuses a machine account; it does not create an isolated user per test.
1. Open the web app's `/sign-in`, enter the returned email, choose **Use another method** → **Email code**, and enter `424242`. Browser automation can instead consume the returned ticket using the linked guide.
1. For a personal account, complete **Individual** onboarding. Copy its newly created API key, skip adding a payment method, and finish onboarding. This creates the user's own workspace and key. For onboarding tests, assert the initial state before completing these steps.

A fresh account starts with no credits and no admin grant. Use its own key for auth tests; the shared unlimited seed key bypasses the state being tested.

## Credits and workspace IDs

Inspect the local account, then add a one-time test credit grant:

```bash
bun run db:test-user --user-id <user_id>
bun run db:test-user --user-id <user_id> --credits 100
```

The command always targets local Postgres and reports the actual active workspace IDs, credit total, and admin flag. It requires an existing synced user; it does not create workspaces, move shared keys, or grant admin implicitly. Repeating the same credit amount adds nothing; a different amount is rejected.

Refresh the Credits page and check for one $100 transaction. A paid inference request with the user's key should fail with 402 before funding and succeed after funding. Auth reads can briefly retain the old balance; retry after propagation, or restart `api` and confirm its new run before retrying. A database credit row alone does not prove the request sees it.

## Admin permission checks

For Mission Control tests only:

```bash
bun run db:test-user --user-id <user_id> --admin true
# Test the permitted action, then restore the denial case:
bun run db:test-user --user-id <user_id> --admin false
```

Reload Mission Control after each change. On `/user/<user_id>`, the admin grant exposes the user-management controls; without it, the user details return `Error: Not Found`. The navigation shell can remain visible, so its presence is not an access assertion.

Use the reported workspace ID for scoped fixtures. Organization membership and feature-specific grants require that feature's fixtures; this personal-account setup does not supply them. Use separate browser contexts for multiple users and confirm the active Clerk user and organization before asserting access.

A database reset removes local fixtures without deleting the Clerk identity. The token helper cleans up generated users after over a day without activity, so these identities are temporary.
