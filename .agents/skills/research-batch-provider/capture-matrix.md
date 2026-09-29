# Batch capture matrix

Canonical scenario list for `research-batch-provider`. Each scenario saves the redacted request, response body, HTTP status, and headers under `$BATCH_RESEARCH_CAPTURE_ROOT/<provider>/captures/<scenario>.*`, where the variable points to a persistent location outside the repository (see `batch-sync-fixtures` for the capture/redaction mechanics). Promote the load-bearing shapes and quirks into the committed research note and fixtures — this evidence decides adapter/skin reuse and drives the implementation and its tests.

## Happy path

- [ ] `discovery` — model/capability listing relevant to batch
- [ ] `upload-create` — minimal input upload + batch create (or inline
      create for non-file providers)
- [ ] `status-queued` — poll immediately after create
- [ ] `status-in-progress` — poll mid-run (may coincide with queued on
      fast providers; note if unobservable)
- [ ] `status-completed` — terminal success poll. Record every field the
      terminal poll carries: status string, per-outcome counters, result
      handles, failure fields
- [ ] `output-download` — result file/pages download
- [ ] `error-file-download` — separate error-file download, if the
      provider has one
- [ ] `retention-fields` — the input artifact and job record as the
      provider returns them, plus every result handle resolved to the
      object it points at (output/error file metadata, or the storage
      object listing), since on file-backed providers the deadline lives
      on the referenced file rather than on the handle or the job. Row 7
      quotes each artifact's own retention fields (`expires_at` and
      friends), not just the job's. Where an artifact has a delete call,
      capture it and the read that follows it

## Native deletion

- [ ] `delete-file` — delete input, output, and error file handles where observed; record the status/body receipt and a GET after deletion
- [ ] `delete-batch` — delete one terminal and one non-terminal batch where the provider exposes the route; record status/body, a GET after deletion, and whether any provider files were removed

## Batchable-request scenarios

The shapes we expect users to batch. Capture each as a **real
request+response pair** (save the request body too, not just the
response) — these become the committed fixtures that drive both the fake
provider and the adapter/skin tests, so the request side is never
hand-written. Use one tiny deterministic prompt per scenario so the pair
compares like-for-like. Skip a row only when the provider lacks the
feature, and note the skip in the research note.

- [ ] `text` — plain response, no tools
- [ ] `tool-calls` — a `tools` request whose output contains tool
      calls / `tool_use`
- [ ] `multi-system` — multiple system messages (or system + developer)
- [ ] `multi-turn` — a prior assistant turn already in the messages array
- [ ] `reasoning` — reasoning/thinking enabled (where supported)
- [ ] `structured-output` — JSON mode / `response_format` (where
      supported)
- [ ] `truncated` — `max_tokens` cutoff (`length` / `max_tokens` finish
      reason)
- [ ] `image-url-public` — a public image URL in a batch line, not
      base64. Record whether the provider's batch format has a native
      field for it, whether the provider fetches the URL, and the error
      when the fetch or the field fails. Also capture the base64
      equivalent so the note can say which one the adapter must send
- [ ] `file-url-public` — a public file/PDF URL in a batch line, same
      three questions, plus the accepted content types. Capture it per
      wire the provider's endpoints lower to, since file URL support is
      resolved from the endpoint row rather than the provider
- [ ] `image-url-rejected` and `file-url-rejected` — the rejection shape
      when the batch format has no URL field, so the caller-facing reason
      in `batchAdapterSupportsImageUrls` / `batchAdapterSupportsFileUrls`
      quotes the provider rather than guessing

## Terminal / degraded jobs

- [ ] `job-failed` — a job that fails validation or upstream
- [ ] `job-cancelled` — cancel then poll to terminal state
- [ ] `job-expired` — expired job shape (from docs if not reproducible
      live; mark provenance)
- [ ] `partial-success` — mixed success/error lines in one job. Capture
      both the terminal poll and the downloaded results: whether the
      status differs from an all-success job, where the failed lines
      live, whether they carry `custom_id` and usage, and how the
      counters add up
- [ ] `results-on-nonsuccess-terminal` — attempt the results/output
      download on a `failed`, `cancelled`, and `expired` job; record
      whether partial output is still readable or the handle is absent

## Probe batches

Run three real jobs of about five lines each and keep every artifact per
job — input file, each poll, terminal poll, output, and error file. The
status and counter fields only become unambiguous when the same three
fields are compared across an all-success, an all-failure, and a mixed
job, so no per-scenario capture substitutes for these.

These probes do not gate the phase. Where a credential, quota, or
provider limit prevents a probe, note it and answer from the docs, then
replay the probe payloads through `pollBatch`, `parseResult`, and
`parseUsage` once they are available and correct whatever they
contradict.

- [ ] `probe-happy` — five valid requests, all expected to succeed
- [ ] `probe-sad` — five requests all expected to fail, so the terminal
      status and counters of a fully failed job are unambiguous
- [ ] `probe-mixed` — deliberately mixed outcomes in one job, the primary
      partial-failure evidence

Suggested mixed lines, adapted to what the provider actually rejects:

1. A valid request that succeeds
2. A valid request truncated by `max_tokens`
3. An unsupported or unavailable model
4. A malformed body that passes JSONL parsing but fails provider validation
5. A duplicate `custom_id` of line 1, or a request over a per-line limit

Record for each job whether the terminal status alone distinguishes it
from the other two. If it does not, name the field that does.

## Error inputs

- [ ] `bad-auth` — invalid key
- [ ] `malformed-jsonl` — broken input line
- [ ] `duplicate-custom-id` and `missing-custom-id`
- [ ] `unsupported-endpoint-or-model`
- [ ] `over-limit` — over line/byte/token limits (whichever is cheapest
      to trigger; document the rest from docs)

## Concurrency / limits

- [ ] `cancel-race` — cancel while completing; record which state wins
- [ ] `rate-limit` — 429 response and its headers/backoff hints
