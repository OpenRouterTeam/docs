# Comparing Reasoning-Effort Levels on an Endpoint

Method for empirically checking that a higher reasoning-effort level makes an endpoint emit **more completion tokens** than a lower one — i.e. that the endpoint actually honors an effort bump instead of silently ignoring it. Useful after staging or editing a reasoning endpoint, or when someone asks "does xhigh really use more tokens than high on endpoint X?".

## Procedure

1. Resolve the endpoint UUID ([`find-endpoint.md`](find-endpoint.md)).
2. Call the read-only `POST /api/v1/internal/buddy/test-endpoint` route once per run with a `reasoning-effort-*` template — it never mutates the endpoint. Read `usage.completion_tokens` from each response. A reasonable default is `reasoning-effort-high` vs `reasoning-effort-xhigh`, 10 runs each. Valid suffixes are the `reasoning-effort-*` members of the `TestTemplate` enum (`none`, `minimal`, `low`, `medium`, `high`, `xhigh`); check the enum in `packages/enums/test-template.ts` before assuming one exists.
3. Fire runs concurrently with a small fixed pool (≈4 in flight) to cut wall-clock without hammering the gateway, and keep samples indexed by launch order.
4. Retry each run on transient gateway errors (408/429/5xx) a few times with linear backoff — reasoning calls are slow and blips are common. Only treat a run as failed once retries are exhausted.
5. Compare the two samples with a variance-aware test and report the endpoint's provider and permaslug alongside the verdict, so the result is self-documenting.

## Compare on `completion_tokens`, and be variance-aware

Some providers report the extra effort as raw `completion_tokens` with `completion_tokens_details.reasoning_tokens: 0`. Comparing `completion_tokens` captures both cases; report mean reasoning tokens separately for visibility.

Reasoning-token counts are noisy, so a naive `mean > mean` is a coin flip. Use a Welch two-sample t-statistic and compare its magnitude against a **degrees-of-freedom-aware** 95% two-sided critical value (Student-t table keyed on Welch–Satterthwaite `dof`, falling back to `1.96` above df=30):

- **higher** — high-effort mean significantly above low-effort. The only passing verdict.
- **lower** — significantly below.
- **inconclusive** — gap inside the noise floor, or `t` uncomputable (fewer than 2 runs per side, or zero variance).

A fixed `2.0` cutoff under-rejects at small n: at df=2 the true 95% critical value is `4.303`, so `t = 3` on 3 runs per side looks significant against `2.0` but is correctly inconclusive against the df-aware bar. Surface both `dof` and the critical value used.

> **Caveat.** The t-test assumes roughly normal, independent samples; real
> completion-token counts are heavy-tailed and sometimes bimodal. Treat the
> verdict as a pragmatic gate, not a formal significance claim. A rank-based test
> (Mann–Whitney U) is more robust if this ever becomes load-bearing.

## Required env

- `BUDDY_API_KEY` — bearer token for the Buddy API. Never print its value.
