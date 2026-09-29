# interns

The interns hub. `InternsPageClient.tsx`, `InternsTable.tsx`, `InternDetailSheet.tsx` and `queries.ts` are the spine everything here imports.

## Two surfaces behind one flag

`oriVaultRedesign` (Statsig `ori-vault-redesign`) decides which detail surface a row opens, and the two are separate files:

| gate | layout | row click opens | file |
| --- | --- | --- | --- |
| off | classic table | a sheet over the hub | `InternDetailSheet.tsx` |
| on | card table | the intern's own page | `[internId]/InternPageSheetBody.tsx` |

With the gate on, `InternDetailSheet` never mounts. The two bodies are near-identical twins over the same reads in `queries.ts`, but they get there differently: the sheet calls `useQuery(internDetailOptions(...))` itself, while the page goes through `use-intern-detail.ts`. A change to one body almost always belongs in the other, so check both before calling a detail-surface change done.

## Testing it locally

The page redirects to `/` with no error unless both dev-panel gates are set. It looks exactly like a routing bug and costs more time than anything else here. The sequence, the per-branch web port, and a talkable intern are all in `.agents/skills/local-intern-chat/SKILL.md`; log in with `.agents/skills/clerk-dev-signin-token/SKILL.md`.

Once signed in, in the browser console:

```js
localStorage.setItem('devpanel.flagMode', 'internal');
localStorage.setItem('devpanel.statsig-gate-overrides', JSON.stringify({
  'ori-code': true,
  'ori-vault-redesign': false,
}));
location.reload();
```

States worth walking, none of which need a real VM, Slack, or GCP:

| state | how to reach it |
| --- | --- |
| empty + first-run hints | any workspace with no interns |
| populated table | seed rows straight into `interns` for your workspace |
| status badges | seed one row per status (`running`, `queued`, `failed`, …) |
| intern gone | `?intern=<any-unused-uuid>` on the hub, or `interns/<uuid>` with the gate on |
| roster load failure | DevTools → Network → Offline, then reload |

To see the empty state without deleting anything, add a second workspace for your own `entity_id` and visit it — the roster is workspace-scoped:

```sql
INSERT INTO workspaces (entity_id, name, slug)
VALUES ('<your clerk user id>', 'scratch', 'scratch-empty');
```

## Tests

Run the colocated `.dom.test.tsx` files with `--parallel`:

```bash
cd projects/web && COVERAGE_ENABLED=false BUN_TEST_NO_CONCURRENT=1 \
  RTL_SKIP_AUTO_CLEANUP=true bun test --parallel \
  --preload ./bun-test.dom-setup.ts <paths>
```

Without it every file shares one process, and a partial `mock.module` of `queries.ts` in one file breaks module loading for the rest — reported as `SyntaxError: Export named '…' not found`, which looks like a broken import and is not. CI runs them sharded, so those failures are an artifact of the local command, not of the branch.

When writing tests in `InternDetailSheet.dom.test.tsx`, expect `waitFor` to hang, and a single `await act(async () => {})` to catch the query observer's re-render only sometimes. Yield a macrotask instead (`setTimeout(resolve, 0)` inside `act`) — a zero delay, so it stays clear of `openrouter/no-real-timer-sleeps`.
