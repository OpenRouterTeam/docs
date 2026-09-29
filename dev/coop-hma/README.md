# Local Coop + HMA bootstrap, transport smokes, and pipeline acceptance

This pinned, loopback-only stack runs HMA 1.1.7 and Coop 1.0.2. It is for
benign local development, not production deployment. HMA has no built-in
request authentication, so do not expose these services beyond localhost.

```bash
bun run scripts/coop-hma-local-runtime.ts ensure-env
bun run scripts/coop-hma-local-runtime.ts validate-config
bun run scripts/coop-hma-local-runtime.ts start
bun run scripts/coop-hma-local-runtime.ts bootstrap-benign-bank
bun run scripts/coop-hma-local-runtime.ts wait-ready
bun run scripts/coop-hma-local-runtime.ts bootstrap-coop
bun run scripts/coop-hma-local-runtime.ts smoke-hma-transport
bun run scripts/coop-hma-local-runtime.ts smoke-coop-transport
bun run scripts/coop-hma-local-runtime.ts pipeline-acceptance
```

`ensure-env` creates the ignored, secrets-only `dev/coop-hma/.env.local` with
mode `0600`. It refuses to mint a new file while named volumes for this
worktree's Compose project still exist, because a fresh admin password would
lock Coop's preserved database. The host ports default to `15100` (HMA),
`16100` (Coop API), and `17100` (Coop UI); `bun run dev:ports on` overrides
them per worktree through `COOP_HMA_HMA_PORT`, `COOP_HMA_SERVER_PORT`, and
`COOP_HMA_UI_PORT` in `.env.worktree`, which every CLI command loads ahead
of the process environment and validates before running. The harmless fixtures live in
`dev/coop-hma/fixtures/`: `exact-match.png` is seeded into the benign bank and
`no-match.png` is the negative control.

The pinned HMA image's default `PDQMultiHashIndex` loses matches after HMA
serializes and restores it, on both ARM64 and AMD64. The local HMA config uses
the supported `PDQFlatIndex` implementation instead and fails startup unless a
persisted benign exact match returns distance `0`. The OpenRouter HMA client
still enforces the normal maximum PDQ distance of `31`. A production HMA
deployment must select the flat index or a release with the upstream persisted
multi-index defect fixed; do not deploy this pinned image's default PDQ index
without the same regression check.

HMA 1.1.7 treats an empty hostname list as allow-all and hard-codes two GitHub
exceptions before consulting that list. The local config therefore sets
`ALLOWED_HOSTNAMES` to exactly `coop-client` and adds an exact-origin request
guard around remote hashing. The pinned local nginx config converts every 3xx
response, including proxied responses, to a terminal `404`; the readiness and
HMA smokes neither follow fixture redirects nor accept another hostname.
Production evidence must come from dedicated, exact-allowlisted origins that
cannot redirect to a different origin. Do not use an allow-all or suffix-based
hostname policy for user-controlled evidence URLs.

The pinned Coop server returns `404` from `/ready`; its actual unauthenticated
readiness endpoint is `/api/v1/ready`. The local Compose healthcheck and Tilt
link deliberately use the served endpoint rather than the mismatched path.
Its create-item-type mutation also persists successfully while returning a
null `data` field in the success wrapper, so bootstrap validates the success
typename and re-queries `myOrg.itemTypes` through the official API.

Coop's official seed script creates `admin@openrouter.local`; its random local
password is in `.env.local`. `bootstrap-coop` signs in through Coop's public
GraphQL surface, creates or validates the local known-match item type with
required bank-provenance and PDQ-distance fields, rotates an API key, and
stores the key plus item-type IDs in that same mode-`0600` ignored file. It
does not write Coop's database directly.

`smoke-hma-transport` tests the HMA client and gate independently.
`smoke-coop-transport` repeats the benign distance-`0` HMA confirmation and
submits that match directly to Coop's normal review queue with `csam: false`.
Open the Coop UI to inspect the transport-smoke item. The two commands stay
separate because production HMA scanning and Coop handoff have independent
rollout gates.

Local development enables the Coop review path so the human-review workflow is
testable end to end. Production Coop handoff remains an explicit opt-in and is
off by default; starting this local stack does not change that rollout gate.

The two direct transport smokes remain separate prerequisite checks: they
bootstrap infrastructure and isolate the HMA and Coop transport contracts.
`pipeline-acceptance` then traverses the local scheduler, observer, real HMA
client, and optional Coop handoff. In one run it verifies:

- both rollout gates disabled without calling either transport;
- HMA enabled and Coop disabled while preserving a confirmed exact match;
- both gates enabled with exactly one Coop review item for the exact match;
- an unrelated image producing no Coop handoff;
- the invalid Coop-enabled/HMA-disabled gate matrix being rejected; and
- a synthetic Coop failure remaining fail-open without losing the confirmed
  HMA match.

Each run uses a fresh, deterministic-within-run request identity so repeated
acceptance runs do not collide or overwrite prior review items. Production
Coop handoff can therefore remain off during rollout while the complete review
path stays testable locally. NCMEC queue setup and real CyberTip credentials
are not part of this local stack.

```bash
bun run scripts/coop-hma-local-runtime.ts teardown
```

Teardown (also run by `bun run dev:teardown`) stops the project and preserves
its volumes; it fails instead of creating a replacement `.env.local`. Remove the
volumes only through an explicit, reviewed local cleanup operation.
