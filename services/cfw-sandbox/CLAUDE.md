# cfw-sandbox agent guidelines

## Local development on Linux

`wrangler dev` container emulation launches an egress-interceptor sidecar (`cloudflare/proxy-everything`) next to each sandbox container. On some Linux hosts the sidecar dies at startup, so the sandbox container never starts and `/exec` keeps returning `SandboxError: Container is starting. Please retry in a moment.` while wrangler logs `Container failed to start`. Two known causes:

- `Fatal error: setsockoptint: operation not supported` — the proxy's Go listeners default to MPTCP, and on kernels where MPTCP sockets reject `IP_TRANSPARENT` (observed on 5.15.x with `EOPNOTSUPP`) the proxy aborts.
- `Fatal error: lookup host.docker.internal ...: no such host` — Linux Docker provides no `host.docker.internal` and workerd adds no `--add-host` mapping.

Run [`scripts/local-dev-egress.sh`](./scripts/local-dev-egress.sh) once to build a patched egress image (forces `GODEBUG=multipathtcp=0` and maps `host.docker.internal` to the container gateway) served from a local registry, then start the worker with:

```sh
MINIFLARE_CONTAINER_EGRESS_IMAGE=localhost:5000/proxy-everything:mptcp-fix wrangler dev
```

The local registry keeps running (`--restart unless-stopped`, loopback-only) so `wrangler dev` can pull the patched image after Docker daemon restarts. To tear it down when done:

```sh
docker rm -f cfw-sandbox-local-registry
```

Never run `/proxy-everything` directly on the host: it installs TPROXY iptables rules that hijack all host TCP egress until cleaned up.
