---
name: kill-port
description: Clear occupied local dev service ports or recover a stuck Tilt stack using the repository cleanup commands.
allowed-tools: Bash
user-invocable: true
---

# Clear local dev ports

For a running service that needs rebuilding, use `tilt trigger <resource>` and watch its new build and readiness in Tilt. A `tilt wait` immediately after triggering can observe the previous Ready state.

## Restart a stuck stack

1. Stop the Tilt process with Ctrl+C in its terminal, or send SIGTERM to its PID. `bun run dev:dashboard` lists running Tilt processes and their actual ports.
1. Run `tilt down` to delete Tilt-managed resources. This command does not stop the Tilt process itself.
1. Run `bun run kill-ports` to clear lingering service listeners, then restart with `bun run dev:up` following [local-dev-env](../local-dev-env/SKILL.md).

`bun run kill-ports --list` previews listeners on the configured service ports. The command reads shell and `.env.worktree` port overrides; it excludes Tilt and Docker containers. Local Postgres is managed separately with `bun run db:stop`.

## Aggressive cleanup

```bash
bun run kill-all --list
bun run kill-all
```

`kill-all` first clears service ports, then stops the Tilt listener on its configured port and matching wrangler, workerd, esbuild, and dev-server processes under this repository. The additional process scan is restricted to repository paths; the initial port cleanup kills listeners on configured service ports regardless of their working directory. It does not stop Docker containers.

Report which service or stack was restarted and confirm the new startup succeeds.
