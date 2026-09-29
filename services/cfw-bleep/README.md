# cfw-bleep

Pure-wasm PII detection worker serving the bleep model
(`OpenRouterTeam/bleep`). Routes: `GET /healthz`, `POST /v1/detect`,
`POST /v1/bench`. Detection is also exposed over a `WorkerEntrypoint`
RPC (`detect` in `src/index.ts`, shared logic in `src/rpc-detect.ts`)
so sibling workers can call it via service bindings without HTTP
overhead; the request/response types live in
`packages/cloudflare/bleep-types.ts`.

## Legacy detector artifacts

The HTTP routes and legacy RPC contract use these vendored files:

- `src/wasm/pkg/` — the compiled `bleep-wasm` detector-only runtime and its matching JavaScript glue and TypeScript declarations.
- `src/wasm/bundle-data.json` — detector configuration, labels, runtime metadata, independent goldens, an empty tensor list, and an empty `weights.bin`, stored as `{ path: base64 }`. The loader checks each payload hash against `manifest.json`.

## Legacy artifact status

The legacy detector uses the detector-only artifact from Bleep Experiment 122. It has zero neural parameters and no weight payload. The optimized Wasm file contains 643,529 bytes.

The Wasm SHA-256 is `1bde7b6fc6cbbbcf9c3a44058f5f632c3d0f5f8c08c1d14d5e4d7d66338e4369`. `detector-artifact.test.ts` checks this identity and seven independent character-offset goldens from the Bleep research repository.

The package contains the artifact files as base64. The loader checks their hashes against the manifest. The sync script preserves a runtime-only manifest without serialization changes.

The current development candidate protected 1,140 of 1,200 sensitive requests and passed 1,780 of 1,780 clean requests. These research results do not establish production quality. An older detector candidate failed eleven sealed promotion gates.

Presidio remains the authoritative product engine. This artifact update does not add Router traffic selection. Request integration, deployed comparisons, and rollout approval have separate gates.

A release updates the detector used by existing Bleep HTTP and legacy RPC callers. The Router shadow flag does not gate these paths. Identify existing Bleep consumers and run their regression checks before release.

## Hybrid candidate for request_context_v2

The named `BleepEntrypoint.detect` uses the fixed `generic-person-broad-v1` hybrid for `request_context_v2`. HTTP routes and the legacy RPC contract retain the vendored detector. The hybrid returns its product result directly. It exposes no diagnostic HTTP route and serializes no complete research response.

Any `SVC_BLEEP` caller can select the hybrid by supplying `request_context_v2`. The RPC entrypoint does not check admin identity or the opt-in header. Those checks occur upstream in `cfw-api`, alongside the region, HIPAA-worker, and performance-mode gates.

`hybrid-artifact-manifest.json` pins eight source modules, the source package receipt, thresholds, and the generated module. An exact reversible transform replaces the research HTTP wrapper with `detectHybrid(request)`. The transform preserves the inference body and the seven asset modules. Zod checks the product identity, hybrid timing, labels, confidence, character offsets, and span text. Invalid responses return typed runtime errors.

The serving package adds the dense-layer layout from [Bleep PR #64](https://github.com/OpenRouterTeam/bleep/pull/64) and the QK attention layout from [Bleep PR #65](https://github.com/OpenRouterTeam/bleep/pull/65). Only `neural.wasm` changes from the previous SIMD serving package. The model weights, tokenizer, head, plan, deterministic runtime, JavaScript, and thresholds remain byte-identical. The runtime must support SIMD128.

The new package receipt binds the replacement Wasm and the previous serving archive. The unchanged `plan.txt` retains historical Wasm provenance. The package receipt identifies the actual Wasm.

The local three-variant comparison matched 450 final-result triplets across 1,350 RPCs against the original SIMD and dense artifacts. QK reduced successful-long latency by a median 36.63% versus dense across 27 paired observations. One 300-codepoint comparison increased by 1.000167 ms and retains its recorded regression flag. The earlier dense experiment retains its original failed gate. The source adds at most 128 KiB of logical scratch. The comparison did not measure peak memory or internal logits. Local timing results do not establish Cloudflare capacity or concurrent throughput.

The artifact comes from our Bleep export. Hash checks establish artifact identity; they do not independently establish export provenance or network isolation. This integration does not enforce runtime egress restrictions.

The hybrid retains the evaluated 128-window work limit. Some Unicode inputs fail that limit within the 32,768-codepoint cap. These failures remain errors. Local length probes and development quality results do not establish Cloudflare capacity or replacement readiness.

The Router's four-second filtering deadline stops waiting but does not cancel an active RPC. Sequential scanning leaves at most one unfinished RPC per filtering invocation. Provider retries can start new invocations with fresh four-second deadlines, so unfinished calls can accumulate across attempts. Before increasing benchmark load, measure timeout frequency, unfinished-call drain time, and CPU in bounded Cloudflare runs.

## Stage the hybrid before build

The generated JavaScript and model assets stay gitignored. Wrangler verifies their hashes before each build or deployment. The command performs no model execution and refuses different staged files.

From `services/cfw-bleep`, stage an explicit local package:

```sh
bun run hybrid:stage /absolute/path/to/package-v1
bun run hybrid:verify
```

For CI or another checkout, fetch the pinned recovery asset with an authenticated GitHub CLI session:

```sh
bun run hybrid:fetch
bun run hybrid:verify
```

The fetch command uses the build-artifact prerelease in the private `OpenRouterTeam/openrouter-web` repository, with tag `bleep-hybrid-qk-serving-20260918-v1`. It checks the archive hash before extraction, then checks each module. The command needs read access to that repository. It does not discover credentials, create releases, or deploy a Worker. CI must run this explicit fetch step before a Worker build. A normal build never fetches assets implicitly.

The upstream package remains in the Bleep recovery release. The manifest's `recovery_*` fields record informational provenance; CI does not fetch or verify that upstream recovery archive. CI verifies the serving archive identified by `build_asset`, the package receipt, the source modules, and the generated module. The recovery identifiers locate the upstream evidence independently of a developer laptop.

## Updating the detector artifact (manual)

The current inputs come from Bleep source `b6e832f4cfaf7014cd8cc4afbad1d35b638e9a63`. The [Experiment 122 result](https://github.com/OpenRouterTeam/bleep/blob/11b9c052b053eec86c95e87bf4c0b07f16526070/research/exp122_detector_artifact_wasm_closure_result.json) records the source, tools, hashes, and validation results.

For this exact candidate, use the retained `artifact-a` and `wasm-package-a` outputs together. Both belong to `.research/runs/0122-detector-artifact-wasm-closure/attempt-1` in the Bleep checkout. The recorded attempt is complete. Preserve its files and receipts.

1. From this service directory, locate the retained outputs and check their identities:

   ```bash
   BLEEP_CLOSURE=/path/to/bleep/.research/runs/0122-detector-artifact-wasm-closure/attempt-1
   shasum -a 256 "$BLEEP_CLOSURE/artifact-a/manifest.json" \
     "$BLEEP_CLOSURE/wasm-package-a/bleep_wasm_bg.wasm"
   ```

   The manifest must match `6cc01fcb29c98708e4370470c041d58b9a078d376cd8c4e32209b03e853da47b`. The optimized Wasm must match the SHA-256 in Current artifact status. If either identity differs, stop and establish new artifact evidence before updating the vendored files.

1. Regenerate the bundle and copy the matching runtime files:

   ```bash
   bun scripts/sync-bundle.ts --dir "$BLEEP_CLOSURE/artifact-a"
   cp "$BLEEP_CLOSURE/wasm-package-a/bleep_wasm.js" src/wasm/pkg/
   cp "$BLEEP_CLOSURE/wasm-package-a/bleep_wasm_bg.wasm" src/wasm/pkg/
   cp "$BLEEP_CLOSURE/wasm-package-a/bleep_wasm.d.ts" src/wasm/pkg/
   cp "$BLEEP_CLOSURE/wasm-package-a/bleep_wasm_bg.wasm.d.ts" src/wasm/pkg/
   ```

   The detector-only manifest requires no file filtering. Its original bytes and all listed payload bytes must survive the sync unchanged.

1. From the openrouter-web repository root, run the local checks:

   ```bash
   bun run verify
   bun run --filter @openrouter-monorepo/cfw-bleep test
   bun run --filter @openrouter-monorepo/cfw-bleep cf:bundle
   ```

   `detector-artifact.test.ts` checks the Wasm identity, empty weights, and seven independent character-offset goldens. The bundle command performs a dry run. These checks supply no production quality or rollout authorization.

1. Review the regenerated diff and its provenance before opening or updating the artifact PR.

The normal release pipeline can deploy merged Worker code. Customer selection and rollout approval remain separate from artifact synchronization.

## Rebuilding the artifact inputs

The [recorded harness](https://github.com/OpenRouterTeam/bleep/blob/b6e832f4cfaf7014cd8cc4afbad1d35b638e9a63/research/exp122_detector_artifact_wasm_closure.mjs#L798-L870) uses `bleep-research build-detector-artifact` and `validate-detector-artifact`. Its source artifact supplies frozen labels and detector configuration. The builder writes zero parameters, an empty tensor list, and empty weights.

The following commands show the recorded build shape with fresh output paths. Run them from the pinned Bleep checkout with the recorded tool and dependency versions. The [protocol](https://github.com/OpenRouterTeam/bleep/blob/11b9c052b053eec86c95e87bf4c0b07f16526070/research/exp122_detector_artifact_wasm_closure.md) specifies Rust/Cargo 1.96.0, wasm-pack 0.15.0, wasm-bindgen 0.2.122, wasm-opt 117, and the offline build environment. These commands alone do not reproduce the harness's independent-build and provenance checks.

```bash
BLEEP_BUILD_DIR=/path/to/new-build-output
cargo build --release --locked --offline --bin bleep-research

target/release/bleep-research build-detector-artifact \
  --source-artifact runs/history/2026-07-02-openrouter-pa-serving-retrain/export/bleep-small-q8 \
  --goldens research/exp095_detector_goldens.v1.jsonl \
  --expected-goldens-sha256 05175a33f4dbb9adf9c6b95b08d98494b50e86ea8983139d930c2c7789f69221 \
  --output "$BLEEP_BUILD_DIR/artifact" \
  --max-seq-len 1024 \
  --created-at 2026-08-23T00:00:00Z

target/release/bleep-research validate-detector-artifact \
  --artifact "$BLEEP_BUILD_DIR/artifact" \
  --expected-goldens-sha256 05175a33f4dbb9adf9c6b95b08d98494b50e86ea8983139d930c2c7789f69221 \
  --output "$BLEEP_BUILD_DIR/artifact-validation.json"

wasm-pack build crates/bleep-wasm --release --target web \
  --out-dir "$BLEEP_BUILD_DIR/wasm-package" --mode no-install \
  -- --locked --offline --no-default-features --features detector-only
```

The seven goldens are independent detector controls. They are not the sealed promotion dataset. Keep the completed Experiment 122 record intact when building a new candidate. Source, tool, or input changes require new provenance, artifact validation, and golden review before a Worker update. A build or structural-validation pass does not establish promotion, deployment readiness, or a replacement for Presidio.
