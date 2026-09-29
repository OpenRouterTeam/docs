# Capture execution runbook

How `bun run capture` launches a harness against a local Arbiter capture gateway, what provenance it records, and — explicitly — what is and is not verified today.

## Verification status (read this first)

| Layer | Status |
| --- | --- |
| Process plumbing: isolation, PATH/HOME scrubbing, executable resolution, version probes, process-tree timeout, token redaction, launch provenance recording | Tested against real spawned fixture processes in `capture.test.ts` (not live harnesses) |
| Direct native recipes (claude-code, codex, deepseek-harness, kimi-code, qwen-code) | Capture-verified by the existing committed baselines; recipe changes require a fresh live run |
| Ori recipes (9 kinds) | Local ingress recordings and file-task runs exercised all nine on 2026-09-08. They are not yet certified by committed, paired replay fixtures; plan tests alone are not capture proof |

Native-provider recapture still requires provider credentials. Ori ingress can be recorded locally through Arbiter forwarding to OpenRouter using the gateway-override Ori source. Publishing replay-grade compatibility cases additionally requires the matching provider-side fixtures; an ingress recording alone is not a native-provider golden.

### Local capture findings (2026-09-08)

All nine commands completed the filesystem task with an empty HOME and an opaque gateway token. Tested child versions: Claude Code 2.1.259, Codex 0.153.4, Pi 0.85.1, OpenCode 1.18.25, Cline 3.0.61, Kilo 7.5.16, Grok 1.0.13, Prime Agent 0.9.3, and Muse 1.0.3 (artifact 1.0.3-R2198.1).

- Grok print mode stopped before writing until the recipe supplied `--always-approve`. Its startup also requests `/api/v1/api-key` and sends an auxiliary native `grok-4.6` model request; these returned 404 and 400 through OpenRouter. A passing file task does not make that complete session contract-clean.
- OpenCode with `openai/gpt-5.1-codex-mini` copied the Read tool's line numbers into the result and failed the filesystem check despite exit 0. A separate run with `anthropic/claude-haiku-4.5` passed. Preserve both outcomes; do not treat the second as fixing the first model's behavior.
- OpenCode and Kilo send auxiliary title-model requests as well as the selected task model. Preserve those exchanges rather than presenting the recording as a single-model conversation.
- These runs captured only the Ori-to-OpenRouter leg. No existing native golden was overwritten, and no compatibility case was published without provider fixtures.
- Known follow-up: verification does not yet fail a case on failed auxiliary harness calls (Grok's `/api/v1/api-key` 404, the auxiliary `grok-4.6` request, OpenCode/Kilo title-model requests). The corpus preserves every exchange, so the evidence is not lost — asserting these calls surface as findings is verification-layer work, tracked separately from publishing these goldens.

## Prerequisites

1. A running loopback Arbiter capture gateway. `CAPTURE_TOKEN` holds an opaque, short-lived gateway token — never a provider key.
2. `CODING_AGENT_CONTRACTS_ALLOW_LOCAL_CAPTURE=1` (accident brake; capture refuses to run in CI).
3. For Ori captures: an explicit Ori executable that implements the O1 gateway override contract. The installed release is never assumed to support it.

## Direct executor (native contracts)

```sh
CAPTURE_TOKEN=<opaque> bun run capture --harness codex --gateway http://127.0.0.1:8787
```

- Only the five registry harnesses with a non-null `capture` recipe run directly; everything else fails closed.
- The child gets a throwaway HOME/workspace, an absolute-only PATH, and exactly one credential: the gateway token under the recipe's credential env var.
- `--harness-executable <path>` (direct only) pins the child binary; otherwise it is resolved on the isolated PATH. The version probe and the run always use the same canonically resolved executable.

## Ori executor (OpenRouter ingress compatibility)

```sh
CAPTURE_TOKEN=<opaque> bun run capture --harness pi --gateway http://127.0.0.1:8787 \
  --executor ori --ori-executable /path/to/o1/ori [--model <id>]
```

The `ori <command>` process receives exactly the settled O1 env contract plus filesystem isolation — nothing else, and no caller-controlled env names exist:

- `ORI_GATEWAY_URL` — the validated loopback **root origin** (no path; Ori derives `/api`, `/api/v1`, and catalog URLs itself). Non-loopback hosts, paths, userinfo, queries, and fragments fail before launch.
- `ORI_LOCAL_CAPTURE=1` — required opt-in.
- `OPENROUTER_API_KEY` — the opaque gateway token only. Under an active override Ori reads no stored credentials.

Ori resolves the child harness by kind on its own PATH, so capture hands Ori the same isolated PATH it used to probe the child version — that is what makes `launch.harness_version` describe the executable Ori actually launches. `--harness-executable` is therefore rejected under `--executor ori`: an override Ori would not use must not be recorded.

### Ori roster

Ori can launch 11 kinds; the O1 override can route 9 of them:

| Group | Kinds |
| --- | --- |
| Capture-supported (9) | claude, codex, grok, opencode, prime-agent, kilo, cline, pi, muse |
| Ori-launchable but capture-blocked (2) | omp, hermes — no chat base-URL control surface, so the override cannot route their traffic |
| Not Ori launches | dsh (`ori dsh` is setup-only), kimi-code / qwen-code (no Ori command) |

Blocked and unsupported kinds fail closed with a typed error; Ori execution is never inferred from the registry's `oriKind`.

omp and hermes are captured through the DIRECT executor instead: both route
their model traffic through base-URL-controlled catalogs (omp's `models.yml`
provider entry, Hermes's `config.yaml` custom provider), which
`prepareHarnessHome` points at the capture gateway with the gateway token
resolved through env-first config-value resolution. Their goldens are
provider-parity cases with `arbiter-exact-capture` provenance — see
[the direct capture note](omp-hermes-direct-capture-2026-09-16.md). The Ori
row above stays true: an O1-mediated `ori omp` / `ori hermes` launch remains
impossible until Ori's launchers grow the routing surface.

## Provenance

Every successful run returns a `launch` object destined for `manifest.capture.launch`:

- `executor` — `direct` or `ori`. Absent on old manifests means legacy/unknown; it is never backfilled.
- `command` — the exact executed argv, shell-escaped, with the real (controlled, secret-free) scenario prompt. No env values, tokens, or host paths.
- `harness_version` — probed from the same resolved child executable that ran.
- `ori_version` — probed from the invoked Ori executable. There is no flag to supply it: identity comes from the binary, never a caller claim. `ori_source_revision` is reserved for a verified build identity and is never written by this package, because a caller-supplied SHA cannot be tied to the executable.

`convertBundleToCase` re-enforces the invariants before any write: Ori captures must be `platform-compatibility`, provider-parity cases must not carry Ori provenance, `launch.harness_version` must equal the probed harness version, and an Ori launch without Ori identity is rejected.

## Paired refresh: single-model scenario profile (2026-09-09)

The current target is nine paired Ori captures: Claude Code, Codex, OpenCode, Prime Agent, Kilo, Cline, Pi, Muse, and Grok. Grok is no longer deferred; the startup and single-model requirements below must be applied before its fresh paired run. The earlier ingress-only runs and the failed/mixed-model Kilo attempt remain historical evidence, not newly certified paired sessions. Do not discard, synthesize, or relabel title exchanges to promote a mixed session.

Before launching Ori, `captureCase` now writes these vendor-supported project settings in the fresh `file-edit-v1` scratch workspace:

| Harness | Project file | Setting |
| --- | --- | --- |
| Kilo 7.5.16 | `kilo.json` | `small_model: "openrouter/<resolved Ori model>"` |
| OpenCode 1.18.25 | `opencode.json` | `small_model: "openrouter/<resolved Ori model>"` |

For `--model openai/gpt-6-astra`, the exact generated JSON is:

```json
{
  "small_model": "openrouter/openai/gpt-6-astra"
}
```

This is an explicit **single-model capture profile**, not stock vendor behavior. The title agent still runs normally and its actual request/response must be retained and paired. Only its model selection is pinned; no title agent is disabled and no response is supplied by this package. The helper takes `planOriLaunch().model`, which resolves the existing recipe default or the supplied override once; it has no separate default. The existing default is not changed to match a limited local catalog: the controller must explicitly request a catalog-supported model (currently GPT-6 Astra or Haiku). Ori alone still owns the primary model, provider configuration, base URL, and credentials.

No project config is generated for other harnesses or direct execution. The project writer refuses an existing file (`wx`) rather than overwriting user settings. Config files remain in `CaptureRunResult.workspaceDir`; the parent controller must copy the actual `kilo.json`/`opencode.json` alongside the task/workspace evidence **before another run replaces the workspace**, and verify their final bytes match the pre-launch profile. They are deterministic from the recorded model and this scenario setup, so this does not expand the corpus source schema.

### Installed-vendor verification

The implementation was checked by reading bounded embedded-source snippets, without executing model calls or modifying external vendor/Ori sources:

- `/Users/luke/.local/share/coding-contract-captures/tool-installations/kilo-7.5.16/package/bin/kilo`: the config schema declares `small_model` as an optional nullable string for title generation in `provider/model` format; project config names include `kilo.json`/`kilo.jsonc`; `Provider.getSmallModel` resolves that setting before its automatic small-model selection. The provider parser splits at the first slash and rejoins the rest as the model id.
- `/Users/luke/.opencode/bin/opencode`: the config schema declares optional string `small_model` with the same title-generation description; project discovery loads `opencode.json`/`opencode.jsonc`; `Provider.getSmallModel` resolves that setting first, using the same first-slash parser. Thus `openrouter/openai/gpt-6-astra`, not `openai/gpt-6-astra`, selects the OpenRouter provider and the full OpenRouter model id.

These source checks and deterministic tests establish setup behavior, not successful live capture. The parent must inspect every actual ingress/provider pair for the requested model before promoting the fresh session; a passing file task alone is insufficient.

## Prime Agent runtime isolation and required teardown

Prime 0.9.3's `dist/bundle/cli.js` imports `cli-main-GZC5LKRJ.js`. Bounded inspection of its bundled dependencies established:

- `chunk-YROFJ6N5.js`, `dist/modes/daemon/daemon-socket.js`: `defaultDaemonSocketDir()` returns `join(tmpdir(), "prime-agent-<uid>")`, importing `tmpdir` from `node:os`. Changing HOME alone cannot isolate this socket.
- `chunk-6RJTZ7BG.js`, supervisor ownership code: ownership records live under the home-scoped `.prime/supervisor-owners` registry. Deleting that HOME while a detached supervisor retains the UID-global socket causes the observed generation/registry mismatch.
- Prime spawns the daemon detached with inherited environment. The controller's process-group timeout does **not** guarantee teardown of this detached supervisor.

The latest actual Prime 0.9.3 attempt is retained at `/Users/luke/.local/share/coding-contract-captures/2026-09-09-paired/prime-agent-2026-09-09T20-01-32.966Z`. Its `prime-daemon.log` proves worker listen `EINVAL`: `/tmp/coding-agent-contracts-capture/prime-agent-3HuKEM/home/.tmp/prime-agent-501/worker-2cf562601e36-f5d397e9a2a1.sock` exceeds macOS's 104-byte `sun_path` capacity. TMPDIR isolation worked; the longer worker socket path, not credential routing or the shorter daemon socket, failed. No model calls occurred in that attempt.

Every capture now creates a unique owner-only (0700) `temporaryDir` directly under the validated owner-only root, using `mkdtempSync(join(root, 't-'))`. The supported root remains `/tmp/coding-agent-contracts-capture`; no symlink workaround is used. Prime's socket paths become `<temporaryDir>/prime-agent-<uid>/daemon.sock` and `<temporaryDir>/prime-agent-<uid>/worker-<id>-<id>.sock`. Tests use the observed suffix lengths without copying native identities: the worker path is 98 bytes on this short root, below 104 bytes including room for the terminating NUL. This budget is not a guarantee for arbitrarily long roots or future native suffix formats.

Ori and direct runs receive this exact `TMPDIR`, and both the actual child-binary and Ori version probes receive the same directory while retaining separate credential-free probe HOMEs. Standalone Ori env builders and version probes keep their `HOME/.tmp` defaults; the standalone direct env builder keeps its prior default when no directory is supplied. The run receives only the opaque gateway token; ambient credentials/TMPDIR are not inherited. Every harness retains unique `<capture-root>/<harness-id>-XXXXXX` workspace/HOME trees, and retries preserve all earlier workspace, registry, log and runtime files.

`CaptureRunResult.temporaryDir` returns the exact runtime resource separately from `workspaceDir`. The operator must record both paths with the attempt and retain them as ownership/teardown evidence. The runtime directory is a sibling of the scratch tree, so deleting a workspace/HOME tree does not clean it up; remove only these exact owned resources after lifecycle checks. Deterministic shell fixtures verify directory/probe/runtime agreement; no new real Prime/Ori capture or model call is claimed by this fix.

Each scratch tree also contains an owner-only (0600) `capture-attempt.json` with its exact `workspaceDir` and `temporaryDir`. Setup writes this association immediately after allocating the two roots, before scenario setup, executable resolution, profiles, catalog preflight or version probes. It survives later `Err` results, so retained failed attempts remain correlated even when no `CaptureRunResult` reaches the caller. The record contains paths only; retain it with that attempt's private evidence and inspect it when recovering failed preflights.

If runtime allocation or association-record creation fails, setup removes only that invocation's newly allocated roots, including any partial marker file. It attempts every removal even if one fails. An incomplete cleanup returns the exact owned paths in a sanitized error so they can be recovered manually; older attempts and successfully recorded evidence are preserved.

**Parent action required before launching Prime:** establish bounded, ownership-proven teardown for the fresh supervisor and workers, including timeout/error paths. Do not run additional Prime attempts while leaving detached supervisors behind. Retain the scratch HOME, temporaryDir, registry, socket path and process identity evidence until teardown is confirmed; a unique path avoids collisions but is not daemon cleanup.

The public `prime-agent shutdown [--force] [--json]` is **not scoped by HOME/TMPDIR**: `runShutdownAll` calls `discoverDaemons`, which scans `ss`, `lsof` and `ps` for system-wide Prime listeners. Do not invoke it here. An internal socket-specific shutdown implementation exists, but the public `daemon` command is explicitly rejected as removed in 0.9.3; do not assume `prime-agent daemon shutdown --socket ...` works. No safe public socket-scoped shutdown command was established. The parent must either arrange a vendor-supported isolated lifecycle or verify the fresh socket's listener PID/start identity and corresponding supervisor/worker ownership before a narrowly targeted, bounded termination. Verify process exit and socket closure before deleting that scratch tree and its separately recorded temporaryDir. Never kill the pre-existing PID 61811 or remove the global socket without independent ownership proof. This change neither launches nor cleans up any real Prime daemon.


### Grok startup and session-title model

The retained September 8 startup failure was a gateway-policy rejection, not a missing credential: `GET /api/v1/api-key` returned 403 (path not allowed), and Grok 1.0.13 exited with “Not signed in” before inference. A later attempt forwarded that request and received OpenRouter's genuine 404; Grok continued. The capture controller must permit this metadata request through the recording gateway and retain its actual response, not synthesize auth success. The existing Ori overlay already points both catalog and xAI API URLs at that gateway and supplies the opaque token.

The subsequent session also made an auxiliary `/api/v1/responses` request using native `grok-4.6`. Its captured prompt explicitly requests a session title. Native `--model` does not select the title model: the installed binary's embedded configuration reference documents `models.session_summary` as the model for titles and summaries. The Grok capture profile now writes only that setting, using the resolved Ori model, into the fresh isolated `HOME/.grok/config.toml`. It does not disable title generation, change authentication or routing, or supply any response. Existing configuration directories (including symlinks) are refused rather than overwritten.

A credential-free native `grok inspect --json` probe confirmed that 1.0.13 discovers this HOME config. Offline tests verify the setting, private permissions, non-overwrite behavior, and its presence in the HOME actually handed to the launched process. These checks are not fresh inference or paired replay evidence. The parent controller must remove its old Grok-deferred guard, permit the metadata request, and perform the genuine paired capture; retain and replay every resulting title and task call, assigning reviewed conversation groups where needed.
