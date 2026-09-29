# Selected schedules and session budgets

The selected-schedule API uses the existing bounded response reader and request transport. It does not change the default six-fixture CLI.

Each selected fixture supplies its name, complete text segments, and serialized request SHA256. The model name is part of that hash. Each fixture requires two pairs with opposite first-arm order. Both requests in each pair use the same body and token.

`runBenchmark` accepts these fixtures and pairs through `selectionInput`. Selected runs require `rounds: 2` and `concurrency: 1`. Invalid schedules fail before the function reads token fields or calls the transport. The API supports 1–60 selected fixtures, at most 16 segments, and at most 32,768 Unicode codepoints per fixture.

The optional `reserve` callback runs before each request. A rejected reservation stops subsequent dispatch. The transport checks its deadline again after the callback. The optional `shouldStop` callback can stop dispatch after an observation. Callback and observation-sink failures also stop dispatch.

## Durable budget journal

`openSessionBudget` creates a new file with exclusive creation and mode `0600`. It writes each reservation with `fsync` before it returns success. An existing file cannot start another session. A process restart cannot reopen this journal. The module also synchronizes the parent directory before it admits external work. Storage-device failure can still prevent persistence.

The journal caps the session at 480 reserved requests and two hours. The earlier wall or monotonic deadline controls admission. Charges and reservations use integer nanodollars. Unknown charges retain their full declared reservation. A later phase requires explicit charge and attempt evidence for every reservation. A charge above its declared bound stops dispatch and remains in the recorded total.

A deadline after a journal write preserves that reservation but refuses dispatch. The journal remains the source for charge accounting after an interrupted callback.

The journal records client observations separately from charge evidence. HTTP 408, 429, 503, or 504 stops dispatch. Transport uncertainty also stops dispatch. Three consecutive unexpected responses stop dispatch. A parsed BLOCK HTTP 403 remains unclassified until server evidence establishes its cause.

The supplied cost bound requires independent price and attempt evidence. This client limit is not an account billing cap. Neither successful responses nor elapsed time establish the engine, deployment identity, remote cancellation, or completed RPC work.

## Prospective session integration

The [REDACT session](REDACT.md) connects the selected-schedule API to explicit credentials, deployment reads, and bounded scalar telemetry. It selects 240 REDACT slots from the unchanged 480-slot proposal. The default six-fixture CLI and the historical proposal remain unchanged.

The wrapper checks the frozen schedule before credential access. It reserves each phase cost before dispatch and stops later phases on missing evidence. It retains exact body hashes, unsent slots, deployment identities, and unknown remote drain state. All telemetry requests consume the same 90-read limit.

The wrapper is prospective and unexecuted. Its controls use invented responses. Its production admission requires current deployment, guardrail, price, and key evidence.

## Offline controls

Run the controls from the repository root:

```sh
node node_modules/vitest/vitest.mjs run --config tests/manual/2026-09-16-bleep-header-benchmark/vitest.config.ts
```

The controls use invented inputs and injected transports. They require no service or API credential. The journal controls use temporary files and injected clocks.
