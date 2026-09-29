# Router Latency v2

`router_latency_v2` and `post_dispatch` measure the time a request spends in OpenRouter, not waiting on the provider, the client, or a tool the user turned on. This directory holds the recorder, the interval model, and the metric and log emitters. Work to close the known gaps is tracked in Linear project P-PLA-495 (Router Latency Instrumentation).

## Coverage map

[`docs/router-latency-coverage.html`](../../../docs/router-latency-coverage.html) places every step of a cfw-api request on the two measurement windows. For each step it records how the step is counted today, what it should be, the evidence, and the Linear ticket. Engineers and reviewers use it to judge what the metric includes, so it must describe what is on main, not what is planned.

GitHub shows the file as source only. To read it rendered, open it locally (`open docs/router-latency-coverage.html` on macOS).

## Keep the coverage map current

Update the coverage map in the same PR as any change that alters what router latency measures. That includes:

- adding, removing or moving an own phase or excluded interval (`recordOwn`, `measureOwn`, `measureOwnWith`, `recordExcluded`, `startExcluded`, `measureExcludedWith`, the upstream tracker)
- changing where the recorder starts, where first dispatch is stamped, or where `compute()` runs
- changing which requests emit, or how they are tagged (server-tool calls, HIPAA mirror, modalities)
- adding a pre-dispatch step that awaits I/O on the inference path
- adding a new router latency metric, log field or ClickHouse column

For each change:

1. Edit the matching rows in all three places that describe a step: the timeline in "One request, step by step", the "Which requests get a number" table, and the "Step ledger". Their row numbers must agree.
2. Update the legend counts, the tally bar and the "Bottom line" numbers when a step changes category.
3. When a fix lands, change the "Counted today as" chip to what the code now does, and mark "Should be" as correct. Keep the ticket link until the Linear issue is closed.
4. Cite evidence as a repo path plus a symbol or string that appears in that file, for example `packages/router/index.ts · #acquirePoolPendingCharge`. Do not cite line numbers; they drift.
5. Tag any claim you did not verify in code with the `inferred` or `suspected` chip.
6. Update the footer to the commit you verified against and today's date.
7. Before opening the PR, confirm every cited path exists and every cited symbol still appears in its file.

## Terms

Use these terms in the coverage map, in Linear, and in PR descriptions:

- **User request:** the request a user sends with server tools enabled.
- **Agent-loop call:** a `POST /api/v1/responses` that the server-tools agent loop sends back to cfw-api, one per model turn. It sends `x-openrouter-no-server-tools: 1`.
- **Tool model call:** a `/responses` request that the subagent or advisor tool sends while it runs.

Do not use "inner" and "outer" for these.

## Measurement limits

- Workers freeze `Date.now()` during synchronous execution; it advances only at I/O. An own phase around a pure-CPU step reads about 0ms. Its CPU folds into whichever interval spans the next I/O. When that interval is excluded, as `upstream` is right after the dispatch stamp, the CPU is subtracted (`adapters/base/index.ts · const dispatchAtMs = Date.now()`, PLA-2975). Size CPU-only steps from `cpuTime` on the "Transaction attempt" log instead; the method and queries are in [`cpu-only-steps.md`](cpu-only-steps.md).
- An excluded interval is stored only when it ends (`recorder.ts · startExcluded`). `compute(completedAtMs)` closes intervals still open at `completedAtMs` (`recorder.ts · #closedOpenIntervals`). `compute()` without a completion time, as when the client never reads the last byte or a video job never received its client handoff stamp (`log-tx-attempt.ts · compute(router.lastByteToClientAtMs)`), still leaves them out.
- `post_dispatch` ends at the last byte to the client on every surface that answers one. A streamed body is stamped when the runtime pulls end-of-stream (`cloudflare.ts · lastByteAtMs`, `read-first-audio-chunk.ts · onLastByteToClient`, and for image a billing stream with no read-ahead, `last-byte-to-client.ts · lastByteToClientAtMs`), and embeddings and rerank log only after the client reads their JSON body (`edge-stream.ts · waitForLastByteToClient`). A buffered body the route writes whole (buffered image, STT, Decisions) is stamped when the lifecycle hands it over, which assumes no I/O between that point and the route's `Response`. Batch submit has no client, so it computes as soon as the provider submit returns (`execute-submit-job.ts · compute(Date.now())`).
- Stream-processing delay (first-byte delay, last-byte delay, per-event lag) is a separate set of metrics. Do not add it to `router_latency_v2` or `post_dispatch`: most stream CPU overlaps provider generation, so adding it would over-count. Its arrival and handoff stamps use the same frozen `Date.now()`, so CPU-only stream work between a provider read and its handoff reads about 0ms. The stream-delay values capture delay that crosses I/O, not pure CPU time. Provider reads are buffered a bounded number of chunks ahead (`stream-delay.ts · STREAM_DELAY_READ_AHEAD_CHUNKS`); while that buffer is full, arrival stamps are late, so the values are lower estimates.
