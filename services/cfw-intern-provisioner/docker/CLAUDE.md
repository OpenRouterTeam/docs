# Intern VM runtime image

Intern VMs run **Container-Optimized OS (COS)** and execute `ori` in
**Docker**. Every intern pulls the SAME **ori-runtime** image — configured
as the `:stable` tag in `../wrangler.toml`, resolved to a digest at
VM-create time and stamped per VM — a thin wrapper around the standalone
`ori` CLI, with no workspace baked in. There are **no per-intern image
builds**; per-intern uniqueness is delivered at runtime by the persistent
workspace volume (`/var/lib/interns/<bot>/workspace`, bind-mounted at
`/workspace`) plus the secret env-file.

## Source of the image

**This image is not built in this repo.** It is built and published by
`OpenRouterIncubator/ori`, in `.github/workflows/runtime-image.yml`, from
that repo's own `docker/ori-runtime.Dockerfile`. Nothing here builds it, and
there is no local build path to fall back on — if you need to change what is
in the image, change it in ori.

What the image is, since the contract matters on this side: `FROM
debian:stable-slim`, runs as **root**, `WORKDIR /workspace`, `ENTRYPOINT
["/usr/local/bin/ori"]` — which is why the systemd units invoke it as
`docker run <image> start …`.

The `ori` binary is **compiled from the commit the workflow checked out** and
copied in. That detail is load-bearing: an installer-based build
(`install.sh`) fetches the latest CLI of a channel through a CDN-cached
pointer, so a build started shortly after a release can bake the PREVIOUS
binary while stamping a brand-new digest. Compiling from the checked-out
commit rules that out, and the workflow additionally runs the built image
and requires it to report the version the run compiled **before** anything
reaches the registry.

## The `pi` harness runtime

**The transitive-drift crash is fixed upstream in ori. Do not re-add an
image-side pre-seed to guard against it.**

ori installs `@earendil-works/pi-coding-agent` on the first agent turn,
into `join(ORI_PI_INSTALL_DIR ?? join(homedir(), '.ori', 'pi-runtime'),
<pi version>)`, via `bun install --backend=copyfile` against a manifest it
generates itself.

**ori pins `pi-coding-agent` and every `@earendil-works/*` sibling exactly
in that generated manifest** (`overrides`). A caret on a sibling would let
it drift past the pinned agent to a release whose exports no longer match
the agent's imports, and the bot would crash on every message with a
`SyntaxError` at import time; exact pins on the whole set rule that out,
and cover a superset of what any Dockerfile pre-seed could. The pin set is
per-image: to see it for a given digest, read the manifest out of that
image's shipped binary.

One thing follows (ORI-1183):
**`/workspace/.ori/…` in ANY image layer is shadowed at runtime.** The
runtime unit runs `-v /var/lib/interns/<bot>/workspace:/workspace`
(`gcp-startup-script-service.ts`), so a bind mount covers the whole
directory. An image-baked pre-seed under `/workspace` can never be read.

What the provisioner does instead is **persistence**, not pinning: the
env-file sets `ORI_PI_INSTALL_DIR=/workspace/<bot>/.ori/pi-runtime`, inside
the bind mount. The image runs as root with `HOME=/root`, so without this
the install lands on the container's ephemeral layer and the unit's
`docker run --rm` + `Restart=always` re-fetches it from npm on every
restart. ori appends the version itself, so the var names the `pi-runtime`
parent, never a versioned dir.

## Publishing

Publishing is ori's `runtime-image.yml`, on merge to ori's `main`. It emits a
moving tag per channel plus an immutable `:<version>` tag on the same digest;
the moving tag is what a consumer asks for, the immutable one is what makes a
rollback possible.

Intern VMs have **no external IP** (Cloud NAT egress only) and run
Container-Optimized OS wired with `docker-credential-gcr`, which
authenticates **Google registries only** — every other host is an anonymous
pull. So the image must resolve from the interns' same-region Artifact
Registry (`us-central1-docker.pkg.dev/ext-interns-spawner-000/interns`),
where the VM service account holds `roles/artifactregistry.reader`. A GHCR
ref is not pullable from an intern unless the package is public.

### Mirroring a build by hand

ori's release workflow publishes to the interns' Artifact Registry under the
publish identity in `ci/infra/gcp-ori-runtime-image.tf` and moves the
`:stable` tag there (see the `INTERN_RUNTIME_IMAGE` comment in
`../wrangler.toml`). A build that exists only on
`ghcr.io/openrouterincubator/ori-runtime` — which by the paragraph above is
exactly what an intern cannot pull — has to be copied across by hand:

```sh
docker buildx imagetools create --prefer-index=false \
  --tag us-central1-docker.pkg.dev/ext-interns-spawner-000/interns/ori-runtime:<tag> \
  ghcr.io/openrouterincubator/ori-runtime:<tag>
```

**`--prefer-index=false` is load-bearing.** Without it a single-platform
source gets rewrapped in a fresh index and the digest changes — so the digest
you then pin is not the digest ori built and verified, and the immutable
`:<version>` tag stops meaning anything.

**The check is that the DIGEST did not change**, not that any particular media
type came back:

```sh
docker buildx imagetools inspect --raw <source-ref> | shasum -a 256
docker buildx imagetools inspect --raw <mirrored-ref> | shasum -a 256
```

For a single-platform source like `ori-runtime`, that shows up as the mirrored
ref reporting `application/vnd.docker.distribution.manifest.v2+json`, and an
index media type means the copy rewrapped it. Do not read that as a rule that
every mirrored ref must be a plain manifest: `--prefer-index=false` governs
what happens to a **single** manifest, so a genuinely multi-platform source is
copied as the manifest list it already is and keeps its list media type and
its digest. `cloudflared` below is that case. Comparing the raw manifests is
the check that is correct for both.

A `+` is not a legal OCI tag character, so ori's `0.7.1-alpha+9941271` mirrors
as the tag `0.7.1-alpha-9941271`. The digest is the identity; the tag is a
label.

### Re-pinning

`INTERN_RUNTIME_IMAGE` names the `:stable` tag that ori's release workflow
moves, so a release reaches new interns with no edit here; the worker
resolves the tag to a digest at VM-create time and stamps that digest per
VM. Pinning a `…@sha256:…` digest instead is how a rollback or a specific
build is expressed. Either way the value lives in **two places that must
stay byte-identical** (#34948): `[vars]` in `../wrangler.toml` (what the
deployed worker resolves) and the matching zod default in `../src/env.ts`
(what local and hermetic-e2e boot). `runtime-image-pin.test.ts` asserts
they agree.

**Confirm the digest resolves in AR before you pin it**, because nothing after
this point will:

```sh
gcloud artifacts docker images describe \
  us-central1-docker.pkg.dev/ext-interns-spawner-000/interns/ori-runtime@sha256:<digest>
```

`runtime-image-pin.test.ts` checks the two declarations match and that the
shape is a digest or a tag this worker can resolve — never that the image
exists. An unpullable ref therefore deploys green and fails at the far end
of provisioning: the VM boots, the runtime unit crash-loops on the pull,
`runHealthPoll` spends its 60 x 5s budget, and `workflow.ts` stamps the
intern `failed` once the step's retries are exhausted. The failure IS
visible — it just costs minutes of retry per attempt and points at
`/health`, not at the pull — and a digest present in neither AR nor GHCR
has reached production this way (#35772). A digest reported by a release
note is not a digest that exists; the `imagetools` copy above also *changes*
the digest unless `--prefer-index=false` is passed, so the GHCR digest and
the AR digest are not interchangeable.

### The tunnel sidecar

The second container on every intern VM. `INTERN_CLOUDFLARED_IMAGE` is
mirrored and digest-pinned on the same terms as the runtime image, in the same
two declarations, asserted by the same test (ORI-1267).

The current pin is `cloudflare/cloudflared:2026.8.3`, mirrored from Docker Hub:

```sh
docker buildx imagetools create --prefer-index=false \
  --tag us-central1-docker.pkg.dev/ext-interns-spawner-000/interns/cloudflared:2026.8.3 \
  cloudflare/cloudflared@sha256:<upstream digest>
```

Upstream publishes a manifest list (amd64 + arm64), so per the note above the
copy preserves it and the pinned digest is byte-identical to Docker Hub's.
Mirror from the DIGEST rather than the tag, so an upstream tag move between
inspecting and copying cannot change what lands.

**A digest here, never a tag — unlike `INTERN_RUNTIME_IMAGE`.** The runtime
image can name `:stable` because the worker dereferences it at VM-create and
stamps the digest per VM. There is no such step for this ref: `create-gcp-vm`
hands it to the startup script verbatim, so a tag would be resolved on the VM
at pull time and nothing would record which connector build an intern ran.
That is the `:latest` failure this pin replaced, and `runtime-image-pin.test.ts`
fails the build if a later bump reintroduces a tag.

**Bumping it.** cloudflared changes a few times a year, so this is a standing
task rather than a cadence: bump on a Cloudflare advisory or a connector
deprecation notice, and check at least quarterly otherwise. A frozen connector
eventually ages out of Cloudflare support — that cost is accepted deliberately,
and unlike `:latest` it is visible. Nothing in this repo watches for a
cloudflared release.

Nothing on the consuming side needs changing for a private mirror:
`../src/startup-script/cloudflared.ts` already pulls the connector while the
bootstrap shell's `DOCKER_CONFIG` is in effect, fails fast on an unpullable
ref, and retries transient egress failures.

**Re-pinning still does not move interns that already exist.** Nothing
rewrites a live VM's instance metadata on deploy, so a new pin governs what
boots from here on. An existing intern *can* be moved deliberately through
the reconcile subsystem — but only if its VM was created with the timer.
See "Upgrading an intern's runtime image" in `../RUNBOOK.md` for which VMs
qualify and what the alternative costs.

### The metrics collector

The third and last container on an intern VM, and until ORI-1878 the only one
still fetched from a public registry. `INTERN_OTEL_COLLECTOR_IMAGE` is now
mirrored and digest-pinned on exactly the terms above, in the same two
declarations, asserted by the same test.

The current pin is `otel/opentelemetry-collector-contrib:0.118.0`, mirrored
from Docker Hub:

```sh
docker buildx imagetools create --prefer-index=false \
  --tag us-central1-docker.pkg.dev/ext-interns-spawner-000/interns/opentelemetry-collector-contrib:0.118.0 \
  otel/opentelemetry-collector-contrib@sha256:<upstream digest>
```

Upstream publishes a manifest list, so the copy preserves it and the pinned
digest is byte-identical to Docker Hub's. Mirror from the DIGEST rather than
the tag, so an upstream tag move between inspecting and copying cannot change
what lands.

The `-contrib` distribution is required: the Datadog exporter is not in the
core image. The container is only pulled when `INTERN_DD_API_KEY` is set, so
an unpullable ref here degrades telemetry rather than provisioning — *unless*
the failure is the pull itself. Intern VMs have no external IP and egress
through a small set of shared Cloud NAT addresses, and public registries meter
anonymous pulls per source IP, so a fleet booting together against Docker Hub
turns a rate limit into a boot failure. That is the reason to mirror it, over
and above the retag risk a version tag carries.

**Bumping it.** Same standing commitment as cloudflared: bump on a security
advisory or a deprecation notice, and check at least quarterly otherwise.
Nothing in this repo watches for a collector release. Verify the config schema
still parses when bumping — `otel.test.ts` parses the
generated YAML, but only against the schema the tests encode, not against the
collector binary.

## Bumping ori

A merge to ori's `main` publishes a new image; nothing in this repo watches
for it and nothing re-pins automatically.

- **The image digest *is* the ori version.** The CLI is compiled into the
  image from the commit that built it, so there is no separate version knob
  on this side and no way to run a different ori in a given digest.
- **Rolling back = re-pin `INTERN_RUNTIME_IMAGE` to an older digest**, which
  is what ori's immutable `:<version>` tag exists to make possible. That rolls
  back what *new* VMs boot. Rolling a *running* intern back is the swap
  endpoint with an older digest, and only works on a VM that carries the
  reconcile timer.
- **Nothing needs to move in lockstep with the `pi` version** — ori resolves
  and pins that itself (see "The `pi` harness runtime" above).

## Runtime contract (VM startup script)

The startup script (`../src/clients/gcp-startup-script-*.ts`):

1. bind-remounts `/var/lib/interns` `exec` (COS mounts `/var` `noexec`, and
   the workspace's `node_modules/.bin` must be execve-able),
2. `docker pull`s the pinned image, then seeds the workspace with
   `docker run --entrypoint ori <image> init /workspace/<bot>` against the
   persistent volume — idempotent, so reboots re-sync it,
3. writes `/etc/<bot>/runtime-image` (`ORI_RUNTIME_IMAGE=<ref>`), the
   systemd `EnvironmentFile` the runtime unit reads the image ref from,
4. writes `/etc/<bot>/env` (secrets, `ORI_STATE_DIR`, `ORI_PI_INSTALL_DIR`,
   and the vault's proxy vars),
5. runs the runtime under systemd: `docker run --rm --init --network host
   --env-file /etc/<bot>/env -v /var/lib/interns/<bot>/workspace:/workspace
   --entrypoint ori ${ORI_RUNTIME_IMAGE} start --features /workspace/<bot>/features
   --host 127.0.0.1 …`.

Note step 5's mount: **`/workspace` in the container is the host volume, not
the image layer.** Anything an image bakes under `/workspace` is invisible at
runtime.
