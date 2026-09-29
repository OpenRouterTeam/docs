# Featured Launch Example (image / video)

Use this for the final image or video launch gate. It implements [`docs/runbooks/model-launch.md`](../../../../docs/runbooks/model-launch.md) sections 3a and 3b. Read the current handlers in `services/cfw-internal/src/routes/buddy-api/` before you use a route.

## 1. Check the launch state

1. Resolve the full model permaslug and output modality.
2. Verify that the model and endpoint are private, unhidden, and priced.
3. Verify that the organization behind your `OPENROUTER_API_KEY` has an explicit private access grant.
4. Check that `BUDDY_API_KEY` exists. Do not print its value.
5. Check that `OPENROUTER_API_KEY` exists. Do not print its value.
6. If a key is missing, stop and name the missing key.
7. Validate `OPENROUTER_API_KEY` with `GET https://openrouter.ai/api/v1/key`.
8. Require HTTP 200 and a `data` object. Delete the response file after the check.

The key check does not prove private access. A public submit can return 404 when the key lacks the grant. This failure is free.

`OPENROUTER_API_KEY` must match cfw-internal's `MODEL_EXAMPLES_API_KEY` billable entity. The API cannot compare these keys. A settled video finalize that returns 404 can indicate a mismatch.

## 2. Build and approve one request

1. Call the request route with the model permaslug.
2. Omit both `prompt` and `prompt_id` to use the shared registry default.
3. Never write a one-off prompt for a featured launch example.
4. Put explicit generation settings in `params` only.
5. Show the complete returned `request`, including all resolved defaults.
6. Get explicit human approval before the paid submit, except under the launch-readiness default below.

One approval covers one paid submit, the related video poll, and one finalize. It also covers a finalize retry with the same generation ID. Get new approval if the request changes or another paid generation is required.

**Launch-readiness default.** For a model being staged for launch, the first featured example per output modality with the registry default prompt runs without waiting for approval: post the returned `request`, then submit in the same turn. The example lands `pending` and is not public. The default applies only when the model has no example in that modality yet, and the API does not check this for you: the request route does not look for an existing example, and finalize deduplicates by generation ID only, so an existing pending, approved, or rejected example (including one a human made from the preview card) has consumed the allowance. Read `GET /api/v1/internal/model-examples/image-models` or `/video-models` first: `hasExample: true` settles it as a repeat. The opposite is not proof, because that listing rosters public models only and counts pending and approved rows only, so a private launching model or one whose only example was rejected looks fresh. When the listing omits the model or shows `hasExample: false`, state in the preview that no earlier example was found and ask the human staging the model to confirm none was generated before submitting. A retry after `Reject and try again`, a custom prompt, changed `params`, or any second paid generation for the same modality still needs explicit approval, and the §6 curation decision stays with the human.

Submit the returned `request` verbatim. Do not add, remove, or change fields.

## 3. Generate an image

1. Call `POST /api/v1/internal/buddy/image-example/request`.
2. Submit its `request` verbatim to `POST https://openrouter.ai/api/v1/images`.
3. Use `OPENROUTER_API_KEY` for the public request.
4. Record the wall-clock duration in milliseconds.
5. Save the response body without printing large base64 values.
6. Capture the `X-Generation-Id` response header.
7. Require HTTP 200 and a non-empty `data` array.
8. Require a non-empty generation ID and non-null `usage.cost`.
9. Call `POST /api/v1/internal/buddy/image-example/finalize`.
10. Send the response body, generation ID, duration, permaslug, and original prompt selection.

Images settle in the submit response. Do not poll an image job.

## 4. Generate a video

1. Call `POST /api/v1/internal/buddy/video-example/request`.
2. Submit its `request` verbatim to `POST https://openrouter.ai/api/v1/videos`.
3. Use `OPENROUTER_API_KEY` for the public request.
4. Save the returned job ID.
5. Poll `GET https://openrouter.ai/api/v1/videos/{job_id}` with the same key.
6. Poll every 10 seconds for up to 5 minutes unless the user specifies other timing.
7. Stop when the job reaches a settled state.
8. Require `status: "completed"`, a generation ID, and non-null `usage.cost`.
9. Record submit-to-settled wall-clock duration in milliseconds.
10. Call `POST /api/v1/internal/buddy/video-example/finalize`.
11. Send the job ID, duration, permaslug, and original prompt selection.

If the job settles with another status, report its error and stop. If polling times out, report the job ID and last status. Do not claim completion.

## 5. Validate and report

Treat each validation, submit, poll, output, or storage failure as a launch blocker. Do not use provider-direct generation or internal model-example batch routes as gate evidence.

Require the finalize response to contain:

- `example_id`
- `generation_id`
- non-null `cost`
- non-empty `output_assets`
- `media_url`
- `mission_control_url`

Report the following details in the originating thread:

- model permaslug and modality
- generation ID and example ID
- cost and expected list rate
- pending example status
- media URL and Mission Control URL
- video job ID and final status, when applicable
- every concrete failure

Use this model URL with the full permaslug:

```text
https://internal.openrouter.ai/model/edit/{model-permaslug}
```

Attach the image inline. For a video, download the file and attach it. Keep the direct media URL in the report.

## 6. Get and apply the human decision

The finalized example is pending and is not public. Ask the human to choose between these exact options:

- `Approve and make primary`
- `Approve`
- `Reject and try again`
- `Reject`

Use the `example_id` from finalize. Never infer it from a message or a recent asset.

- For `Approve and make primary`, call `POST /api/v1/internal/buddy/model-example/{exampleId}/approve` with `{"make_primary": true}`.
- For `Approve`, call the same route with `{"make_primary": false}`.
- For either rejection, call `POST /api/v1/internal/buddy/model-example/{exampleId}/reject`.
- After `Reject and try again`, start at request construction and get new paid-call approval.
- After `Reject`, stop.

Never make the curation decision yourself. Report the persisted `status` and `is_primary`. Use Mission Control for unsupported actions, including unpublishing an approved example.

## 7. Retry and cleanup rules

Finalize is idempotent on `generation_id`. If its response is lost, retry finalize with the same generation. Never pay for another generation to recover a finalize response.

Delete all temporary request, response, header, image, video, and thumbnail files once the upload is confirmed. Also delete them after a failed upload unless an immediate retry needs them.

## Bulk example refresh (model-examples batch routes)

Routine or bulk example art, outside the launch gate, goes through the internal model-examples API on the same `BUDDY_API_KEY`. Its OpenAPI document is `GET https://openrouter.ai/api/v1/internal/model-examples/openapi.json`, and the handlers are in `services/cfw-internal/src/routes/model-examples/`. Never use these routes as §3b launch-gate evidence.

These routes bill on submit. The §2 approval rule applies unchanged: show the exact model, prompt, resolved `params`, and `Idempotency-Key` for every generation, and get explicit human approval before the first paid call. One approval covers retries with the same key. A changed model, prompt, `params`, or key is a new paid generation and needs new approval. The later approve / reject decision only controls publication and cannot recover the cost.

1. `POST /api/v1/internal/model-examples/generations` (image) or `/video-generations` (video) with `{ "model": "<permaslug>", "prompt": "…", "params": { … } }`. An `Idempotency-Key` header is required: reuse it to retry, change it to pay for a second generation. `params` is strict per modality, so an image parameter on the video route is a 400.
2. `GET /api/v1/internal/model-examples/batches/{batchId}` until the item settles. A video job runs for minutes. The item carries `generationId` and `cost` for billing reconciliation.
3. Every example lands `pending`. Apply the human decision through the same `approve` / `reject` routes as §6, keyed on the item's `exampleId`.

`GET /image-models` and `/video-models` on the same prefix list the candidates with `hasExample` / `hasPrimaryExample`, so check them before paying for art that is already there.

## Forbidden paths

Do not use:

- provider-direct generation
- internal model-example batch routes as launch-gate evidence
- the removed one-step `POST /api/v1/internal/buddy/image-example` route
- a custom one-off prompt for a featured launch example
- a second paid generation without a new approval
- `sku_items` for billing reconciliation

If a caller names a workflow that does not exist, say so and point them back to this reference.