---
name: deploy-stripe-app
description: Deploy the Stripe provisioning app (com.openrouter.provisioning) to Stripe live. Use when asked to "deploy stripe app", "upload stripe app", or "publish stripe app", or to push a new version of the Stripe Projects integration.
user-invocable: true
---

# Deploy Stripe App

Upload `projects/stripe-app/` to Stripe using the Stripe CLI.

## Prerequisites

- Stripe CLI installed (`brew install stripe/stripe-cli/stripe`)
- Stripe Apps plugin (`echo "y" | stripe plugin install apps`)
- Infisical CLI authenticated (for retrieving `STRIPE_SECRET_KEY`)

## Critical: Live Mode Session Auth

The upload **must** use session auth from `stripe login`. Using `--api-key` directly
causes a test/live mode mismatch that makes Stripe's post-upload processing fail
(CLI reports success but dashboard shows "Error").

This was root-caused by Erin from Stripe: the CLI defaults to test mode when
using `--api-key`, even with a live key. Session auth from `stripe login` correctly
targets the live account.

## Steps

### 1. Switch to `main` and pull latest

```bash
git checkout main && git pull origin main
```

### 2. Install the Stripe Apps plugin

The app has no UI extension (`"extensions": null` in `stripe-app.json`) and no
npm dependencies, so there is nothing to install in `projects/stripe-app/`.

```bash
echo "y" | stripe plugin install apps
```

### 3. Authenticate with Stripe (interactive)

This requires browser interaction. The user must approve in-browser and
**ensure they are on their live mode account (not sandbox)**.

```bash
stripe logout
stripe login
```

After `stripe login` prints a URL + verification code, tell the user to open
the URL, confirm the code, and verify they are on **live mode**. Then complete:

```bash
stripe login --complete '<URL from previous output>'
```

Verify the config shows `OpenRouter, Inc` and `live_mode_api_key`:

```bash
cat ~/.config/stripe/config.toml
```

### 4. Bump the version

Use a unix timestamp as the patch version to guarantee uniqueness:

```bash
cd projects/stripe-app
RUN_NUM=$(date +%s)
node -e "
const fs = require('fs');
const m = JSON.parse(fs.readFileSync('stripe-app.json','utf8'));
m.version = '1.0.$RUN_NUM';
fs.writeFileSync('stripe-app.json', JSON.stringify(m, null, 2) + '\n');
console.log('Version:', m.version);
"
```

### 5. Upload

Upload **without `--api-key`**, relying on session auth:

```bash
echo "y" | stripe apps upload --app-version "1.0.$RUN_NUM"
```

Expected output includes "Uploaded OpenRouter Provider Integration" and
"upload your app to **OpenRouter, Inc**" (confirms live mode).

### 6. Clean up

Reset the version bump (don't commit it):

```bash
cd /path/to/repo
git checkout -- projects/stripe-app/stripe-app.json
```

### 7. Verify

Ask the user to check the Stripe dashboard for the new version. It should
show as processing and then ready (not "Error").

## What NOT to Do

- **Do NOT pass `--api-key`** on the upload command — causes test/live mismatch
- **Do NOT use `--live` flag** — causes a "No directory provided for file keyring"
  error on macOS; session auth already targets live mode
- **Do NOT write `live_mode_api_key` into config.toml manually** — the CLI
  redacts it and falls back to test mode
- **Do NOT skip `stripe logout` before `stripe login`** — stale sessions cause
  mismatched account context

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| CLI says "Uploaded" but dashboard shows "Error" | Test/live mode mismatch | `stripe logout` + `stripe login` (live), upload without `--api-key` |
| "No directory provided for file keyring" | `--live` flag on macOS | Remove `--live`, rely on session auth |
| "Livemode values from config will be redacted" | Manual config.toml with live key | Use `stripe login` instead |
| Plugin prompt eats the "y" input | Apps plugin not installed | Run `echo "y" \| stripe plugin install apps` first |
| "The apps plugin is required" | Plugin lost after logout/login | Reinstall: `echo "y" \| stripe plugin install apps` |

## Key Files

- `projects/stripe-app/stripe-app.json` — app manifest
- `projects/stripe-app/package.json` — app metadata only, no dependencies
- `projects/stripe-app/scripts/prepare-upload.ts` — CI prep script (not used for local deploy)
