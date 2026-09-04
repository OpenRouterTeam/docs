# Mission Control review additions

- Keep model-management surfaces on the consolidated models table and preserve
  shared modality filtering semantics across input and output selectors.
- Provider detail pages must resolve private-only providers through the admin
  slug query, since the public `/api/frontend/v1/all-providers` cache excludes
  them; do not silently fall back to a public-only dataset. Route that read
  per the root database-access rule (`cfw-internal`, not a direct database
  import in the RSC).

## Shared data layer (TanStack Query)

Code touching TanStack Query reads or mutations, `useAPIMutation`,
`createQueryKeys`, `queryOptions`, or `infiniteQueryOptions` must follow the
canonical implementation and review guidance in
[`../../packages/frontend/data-layer/AGENTS.md`](../../packages/frontend/data-layer/AGENTS.md)
and
[`../../packages/frontend/data-layer/REVIEW.md`](../../packages/frontend/data-layer/REVIEW.md).

# Mission Control Review Guidelines

## Paginate server-action scans until an empty page

Long-running admin scans (e.g. delete-r2-logs preview and deletion) call the
cfw-internal generations route, which has a 30-second upstream request timeout,
within a 300-second Mission Control Cloud Run request budget. Break the work
into small batch pages and only terminate the loop when a page comes back empty
— stopping on a short page undercounts when the backend caps page sizes.

*Source: [PR #27107](https://github.com/OpenRouterTeam/openrouter-web/pull/27107)*

## Clear busy flags in `finally`

When a client component sets a scanning/loading flag around an awaited server
action, clear the flag in `finally` so a rejected call doesn't lock the panel,
and surface transport-level failures as user-visible errors.

*Source: [PR #27107](https://github.com/OpenRouterTeam/openrouter-web/pull/27107)
— a rejected scan call left the delete-logs panel stuck in the scanning state.*

## Transactional email previews

Email preview utilities must render through the package email renderers,
including the v2 branded registry, rather than duplicating template markup
inside Mission Control. Keep preview and test-send actions separated so a
preview cannot accidentally deliver mail.
