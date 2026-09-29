---
name: debug-capsule
description: Produce and use local dev-fs-logs debug capsules for agent debugging. Use when investigating a local generation, sharing request context with an agent, or compressing dev-fs-logs into a redacted Markdown artifact.
user-invocable: true
---

# Debug Capsule

Generate a single Markdown capsule from local `dev-fs-logs` generation logs.

Use this when you have a local generation folder and need to hand request context
to an agent without manually catting dozens of files.

## What the command does

`bun run debug:capsule <generation>` reads
`services/dev-fs-logs/.logs/<generation>/` and writes Markdown to stdout.

It uses the same capsule rules as the viewer:

- Prefer `.trim.log` / `.trim.json` files.
- Include a raw `.log` / `.json` only when no trimmed sibling exists.
- Use `.debug-context.json` internally for generation-time git branch, commit,
  and status.
- Exclude `.debug-context.json` from Included Logs and File Inventory.
- Fall back to current-checkout git metadata only for old generations that do
  not have `.debug-context.json`.
- Redact sensitive fields and common key/token patterns before output.
- Show included, skipped, truncated, omitted, and unreadable files explicitly.

## Canonical usage

```bash
bun run debug:capsule <generation> > <generation>-debug-capsule.md
```

Find the newest generation:

```bash
GENERATION=$(ls -t services/dev-fs-logs/.logs | grep '^gen-' | head -1)
bun run debug:capsule "$GENERATION" > "$GENERATION-debug-capsule.md"
```

For a nonstandard log root:

```bash
bun run debug:capsule <generation> --logs-dir /path/to/.logs > debug-capsule.md
```

## Agent workflow

1. Start or confirm `dev-fs-logs` is running when reproducing locally:

   ```bash
   bun run dev dev-fs-logs
   ```

2. Reproduce the request or run the test that creates a generation folder.

3. Identify the relevant generation:

   ```bash
   ls -lt services/dev-fs-logs/.logs | head
   ```

4. Generate the capsule to a persistent file:

   ```bash
   bun run debug:capsule <generation> > debug-capsule.md
   ```

5. Inspect the Summary first:
   - `Git metadata source` should be generation time for new logs.
   - `Git status` should be `clean` or show dirty files from generation time.
   - `Model`, `Provider`, `Endpoint`, and `Status` should be populated when the
     logs contain those fields.

6. Use Included Logs for the actual request flow. Treat raw siblings listed
   under “Skipped because trimmed version was included” as intentionally omitted
   unless you need to manually inspect an unusually large untrimmed log.

## Check your work

Before sharing or relying on a capsule:

- Confirm the command exited successfully.
- Confirm the Markdown starts with `# Agent Debug Capsule: <generation>`.
- Confirm `.debug-context.json` is not present in Included Logs.
- Grep for obvious secrets if the capsule will be shared outside your local
  debugging context:

  ```bash
  rg 'sk-or|sk-proj|sk-ant|sk-svcacct|sk-admin|AIza|Bearer [A-Za-z0-9_-]{20,}|access_token|refresh_token|api_key|authorization' debug-capsule.md
  ```

  Expected result: no matches for real secret values.

## When not to use this

- Production incidents where the generation only exists in Datadog. Use the
  `debug-prod` skill instead.
- Non-generation log roots such as embeddings `default/embeddings` logs. Inspect
  those files directly unless a generation-shaped folder exists.
