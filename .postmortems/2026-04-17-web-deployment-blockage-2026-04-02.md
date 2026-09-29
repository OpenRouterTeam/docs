*Web Deployment Blockage — 2026-04-02*

*TL;DR* — All web deploys were broken on `main` for *~5 hours* after the PR to [remove SDK source from monorepo, restructure sync workflows](https://github.com/OpenRouterTeam/openrouter-web/pull/16989%7C#16989) merged at 12:12 PM EDT. Production was unaffected — we kept serving from the last-good deploy — but `main` could not ship between ~2:06 PM and ~7:52 PM EDT.

*Root cause:* Vercel's nested-workspace resolution did not behave the same as local dev or CI, so pnpm resolution broke on `git+https` SDK deps.
*Compounding issue*: the NPM API tokens in CI were under Robert Yeakel's personal account, blocking `@openrouter/agent` from being published to npm.

:chart_with_downwards_trend: *IMPACT*
• No customer-facing API impact. Production served from the prior release.
•  ~5 hours of blocked `main` shipping; 5+ consecutive release trains marked :bad-train: (runs `23914759596`, `23919711596`, `23921529061`, `23924517713`, `23924752170`, `23927016522`).
• Eng thrash: 8+ engineers in an ad-hoc huddle from ~6:06 PM until ~8 PM EDT.
• By the time the train was unblocked, it carried 30+ commits — magnified rollback surface area.

  :clock3: *TIMELINE (all EDT, 2026-04-02)*
•  *12:12 PM* — <https://github.com/OpenRouterTeam/openrouter-web/pull/16989%7C#16989> merges to `main`
•  *2:06 PM*  — First release train (`5488bdf`) fails: `vercel-web` `SIGKILL` / OOM on `bun install`
•  *4:09 PM*  — Train `4ee2c67` fails on `vercel-web` + `mission-control` + `docs` + `auth`
•  4:20 PM  — Devin diagnoses 3 issues:
    a. `packages/router/package.json` uses `git+https` refs for `@openrouter/sdk` and `@openrouter/agent`; nested `bun install` can't find `@openrouter-monorepo/fixtures` (excluded by `.vercelignore`)
    b. `docs.yml` references 557 non-existent Python SDK `.mdx` pages from sdk-bot auto-commit
•  4:55 PM  — Train `b1d5aa0` fails: `ERR_PNPM_WORKSPACE_PKG_NOT_FOUND: @openrouter-monorepo/fixtures@workspace:*`
•  6:06 PM  — Huddle starts (Matt A, Matt Y, Sam, Shashank, Abhinav, Louis, David Bai, Robert)
•  6:25 PM  — Decision: move SDK deps from `git+https` to npm `*`; discovery that `@openrouter/agent` wasn't published to
  npm yet via CI
•  7:14 PM  — SDK on npm working; vercel still failing on `@openrouter/agent` git ref
•  7:20 PM  — Discovery: Sam and Shashank lack admin on `@openrouter` npm org; only Alex has owner rights to add them
•  7:23 PM  — Robert opens https://github.com/OpenRouterTeam/typescript-agent/pull/3%7Ctypescript-agent#3 to enable npm publishing
•  7:39 PM  — Train `c3dc0e2` departs with all fix-forward PRs
•  7:44 PM  — Robert publishes `@openrouter/agent@0.1.1` to npm
•  7:52 PM  — Train `7b6a616` departs clean
•  8:39 PM  — Alex adds Sam and Shashank as npm org admins

  :mag: *ROOT CAUSES*
• *Vercel nested-workspace resolution gap vs CI and local dev.* `packages/router/package.json` pointed SDK deps at `git+https://...`. Vercel's `bun install` cloned those repos, ran their `prepare` scripts, and the nested `bun install` walked up to the parent monorepo — but `@openrouter-monorepo/fixtures` is excluded by `.vercelignore`, so the install crashed with `ERR_PNPM_WORKSPACE_PKG_NOT_FOUND` (or OOMed hitting Vercel's 8 GB limit). PR CI didn't catch it because PR  preview Vercel builds use a different checkout context.
• *`@openrouter/agent` wasn't on npm yet*. `git+https` is a valid pnpm dependency method that worked locally and in CI and was used in case something did go wrong in the release train — but it was not known that in Vercel's install environment it would be an issue. It was not caught in CI that the vercel was broken because the dependency change did not trigger a preview deploy
• *NPM org admin bus factor of one.* Not all engineers could manually publish or set up new CI tokens. Only Alex (owner)
  could add admins. Added coordination overhead during an active incident.

  :white_check_mark: *FOLLOW-UPS*
1. *Disallow `git+https` deps in web.* Add linting to prevent `git+https` deps — they behave differently on Vercel than on local, CI, and CF Workers.
2. *Expand npm org admins.* Already partially done (Sam and Shashank added same night). Formalize at least 4 admins + document in the ops runbook.
3. *Document the SDK sync architecture.* Need a written page on: OpenAPI spec → Speakeasy → SDK OSS repo → npm → monorepo consumer; what sdk-bot does and when; how to roll back each stage.
4. *Escalate release-train failures faster*. 5 consecutive :bad-train: posts in 3 hours is a pageable signal, not just a channel ping. Consider a threshold-based alert (N consecutive failed trains in T minutes → PagerDuty).
5. *Ensure dep changes in any vercel deployed repo still trigger a preview deploy*
