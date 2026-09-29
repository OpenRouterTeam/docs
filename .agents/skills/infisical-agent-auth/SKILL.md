---
name: infisical-agent-auth
description: Authenticate to Infisical non-interactively with the org-provisioned INFISICAL_CLIENT / INFISICAL_SECRET and read or inject secrets for a repo folder. Use when an agent session needs a credential that lives in Infisical (for example E2E_CLERK_USER / E2E_CLERK_PASSWORD under /tests/e2e) instead of asking a human for it.
---

# Infisical agent authentication

`INFISICAL_CLIENT` and `INFISICAL_SECRET` are provisioned org-wide on every Devin session. Authenticate non-interactively and read values directly. Don't ask the human, or call `secrets(action="request")`, for any credential that lives in Infisical.

**Keep secret values out of the terminal, files, and the transcript.** `infisical login --plain` and `infisical secrets get --plain` print the raw value to stdout, so use them only inside `VAR=$(…)`. Don't pipe or redirect their output anywhere else, don't `echo` the variable, and don't write it to a file (`-o dotenv`, `infisical export`, or a hand-built `.env*` or `.dev.vars` file). `INFISICAL_TOKEN` is itself a secret. Check a value by presence or length only: `[ -n "$VAR" ]` or `${#VAR}`. Don't use `set -x`, `bash -x`, or verbose or debug flags while a secret is in scope. Agents are read-only: don't run `secrets set`, `secrets delete`, `folders create`, `folders delete`, `import`, or any other mutating subcommand. A skill step that writes a secret (for example, the `secrets set` step in [add-internal-signing-key](../add-internal-signing-key/SKILL.md)) is for a human at their own terminal; stop and hand it to them. Pass `--env` explicitly on every call, and don't target an environment whose slug contains `prod`, `prd`, or `live`.

**Default to `infisical run -- <cmd>`.** The values go straight into the child process. Use `secrets get` only when the current shell needs the value. The wrapped command must not print its environment (`env`, `printenv`, `echo "$X"`, or a debug dump of the environment).

**Turn off imports unless the folder needs them.** `infisical run`, `infisical secrets`, `infisical secrets get`, and `infisical export` include imported secrets by default and show them as if they belonged to the requested folder. Pass `--include-imports=false` when the folder holds its own secrets, for example `infisical run --env=dev --path=/tests/e2e --include-imports=false -- <cmd>`. Many dev service folders (`/projects/web`, `/projects/mission-control`, `/services/cfw-api`, `/services/cfw-internal-api` and others) get shared keys from `dev:/_shared` and `dev:/_providers` through imports, so keep imports on for those. An import from a different environment is never expected; report it instead of using the values.

**When something fails, stop and report.** If login fails, a read returns empty or `403`, or a name is missing, report the error and stop. Don't try other environments, `--path=/ --recursive`, or listing commands. On `401` or an expired token, rerun `infisical_auth` once; otherwise reuse the token for the life of the shell.

The helper functions live in [scripts/infisical/agent-auth.sh](../../../scripts/infisical/agent-auth.sh). They are shell functions, so a failure returns to the caller instead of exiting the shell. Source the file, authenticate, then run a command or read a value:

```bash
source scripts/infisical/agent-auth.sh
infisical_auth

# Default: inject one folder's secrets into one command.
infisical_run /tests/e2e bun run test:e2e

# Only if the value is needed in this shell; the third argument names the receiving variable.
infisical_get /tests/e2e E2E_CLERK_USER CLERK_USER && use "$CLERK_USER"
```

Each function returns nonzero on failure, so `infisical_get FOLDER NAME OUTVAR && consumer` doesn't run the consumer after an empty read. `$(…)` strips trailing newlines; use `infisical_run` when the value must be byte-exact. Pass one folder per call; don't use `--path=/ --recursive`.

`infisical_run` and `infisical_get` do not yet pass `--include-imports=false`, and you can't add it through them: anything after the folder argument to `infisical_run` lands after `--` in the child command. Until [#47707](https://github.com/OpenRouterTeam/openrouter-web/pull/47707) lands the flag inside the helpers, call the CLI directly when the folder holds its own secrets. `infisical_auth` leaves `INFISICAL_TOKEN` unexported, so pass it explicitly, and keep the manifest guard the helper would have run: `infisical_manifest_has <folder> && infisical run --projectId="$INFISICAL_PROJECT_ID" --env=dev --path=<folder> --token="$INFISICAL_TOKEN" --silent --include-imports=false -- <cmd>`.

**The functions and the token exist only in the shell that sourced the file.** In a persistent shell (one reused `shell_id`), source the file and run `infisical_auth` once. Each one-shot `exec` call is a fresh shell with neither, so put `source scripts/infisical/agent-auth.sh && infisical_auth && infisical_run …` in the same call. A missing token in a new shell is not a login failure; don't retry with more verbose output.

**Repo entrypoints that read `INFISICAL_TOKEN` from the environment** (`bun run x`, `bun run db:start`, `bun run dev:up`, `bun run sentinel:ban-candidates`, Tilt, and any `package.json` script that wraps `infisical run`) don't see the unexported token. Scope it to that one command: `INFISICAL_TOKEN="$INFISICAL_TOKEN" bun run db:start`. Don't `export` it for the whole shell. Read the script first and confirm that it passes a non-production `--env` and doesn't print values; if it does either, stop and ask.

Folder paths mirror the repo (for example, `/tests/e2e`, `/services/cfw-api`, and `/projects/web`). The repo-root `env.manifest.json` file lists the secret names in each folder; read it to discover names. Don't run `infisical secrets` (the list command), and don't run `secrets get` without `--plain` inside `VAR=$(…)`; the table output includes values. If a name is not in the manifest, stop and ask; `infisical_run` and `infisical_get` check the manifest (with `jq`) and return nonzero before calling Infisical for a folder or name it doesn't list.

[INFISICAL.md](../../../scripts/infisical/INFISICAL.md) is the setup guide for humans (folder layout, `.env.development.local` overrides, and Tilt wiring). Where it shows `infisical secrets` tables or echoes a value, that step is for a human at their own terminal; for agents, the rules in this document take precedence.
