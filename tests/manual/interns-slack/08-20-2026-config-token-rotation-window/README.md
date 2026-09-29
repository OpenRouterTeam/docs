# Slack `tooling.tokens.rotate` — how long a rotated refresh token stays alive

Measured 2026-08-20 against the live Slack endpoint, under ORI-1296
([#35609](https://github.com/OpenRouterTeam/openrouter-web/pull/35609)).

Recorded here because the conclusion had, until now, only ever existed as prose
in a code comment. Two production constants are sized against these numbers, and
a reader who greps the repo for the evidence behind them found nothing —
which in ORI-1306 led to the measurement being written off as folklore and
nearly re-run.

Slack's docs say you receive "a _new_ refresh token" but never state that the
old one dies, so this had to be measured rather than read.

## Result

**A rotated refresh token keeps working for roughly 3-6 minutes, then dies
permanently.** Not zero, not forever.

| t (approx) | Call | Result |
| --- | --- | --- |
| 0 – ~180s | `rotate(R0)` × 6 | all `ok`, each minting a **distinct** access token |
| 362s | `rotate(R0)` | `invalid_refresh_token` |
| 362s | `rotate(R1)` — minted from `R0` at t+0, six minutes old | `invalid_refresh_token` |
| 662s | `rotate(R0)` | still `invalid_refresh_token` — permanent, not a blip |

`exp - iat` on every successful rotation was `43200` seconds, confirming the
documented 12-hour **access**-token lifetime. That is a separate clock from the
refresh-token window above, and conflating the two is easy: a token can be
inside its 12h access life and still have a refresh token that died minutes ago.

## Slack's rejection is not diagnostic

A bogus token, an empty token, and a well-formed unknown token **all** return an
identical `HTTP 200 {"ok":false,"error":"invalid_refresh_token"}`.

You can never learn from Slack whether a token was malformed, revoked, or
already spent — only your own record of having rotated it tells you. Any
user-facing message that claims a specific cause is guessing. This is why
`ROTATE_ERROR_MAP` maps `invalid_refresh_token` to `ConfigTokenRejected`, which
names the fix rather than the cause.

## What depends on these numbers

- `MAX_PERSIST_ATTEMPTS` in
  `services/cfw-frontend-api/src/routes/interns-slack-setup/persist-pasted-config-token.ts`
  — the window is long enough to retry a failed DB write into, so a persistence
  failure retries immediately.
- The refusal to report a persistence failure to the user as "try again with
  that token": the window will have closed by the time they read it, so the
  setup route returns `ConfigTokenLost` instead.
- `TERMINAL_ROTATE_ERRORS` in
  `services/cfw-intern-provisioner/src/clients/slack-config-token.ts` — because
  the death is permanent, a teardown that sees `invalid_refresh_token` stops
  rather than retrying to the sweep cap (ORI-1306).

## Re-measuring

Not needed, and deliberately not automated — it burns a real config token and
takes ~11 minutes of wall clock, so it is a poor fit for CI. If a future change
depends on a tighter bound than "3-6 minutes", one throwaway token from
api.slack.com/apps → "Your App Configuration Tokens" is all it takes: rotate it,
then re-rotate the **old** refresh token on a timer and record the first
failure.
