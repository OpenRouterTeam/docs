# CREMA autoscaler image (built from source)

This builds the CREMA (Cloud Run External Metrics Autoscaling) autoscaler image
from source into our Artifact Registry. Required because the published image
`us-docker.pkg.dev/cloud-run-oss-images/crema-v1/autoscaler:1.0` is not directly
runnable (its `entrypoint.sh` needs bash + a JRE, but the published Dockerfile's
final stage is `FROM scratch`).

The image here is built from the public source at
https://github.com/GoogleCloudPlatform/cloud-run-external-metrics-autoscaling
with a patched final stage (`FROM eclipse-temurin:21-jre-noble` so bash + a JRE
are present).

## Build (one-time + on CREMA version bumps)

```bash
git clone --depth 1 https://github.com/GoogleCloudPlatform/cloud-run-external-metrics-autoscaling /tmp/crema-src
cp services/gcp-bench-worker/cloudrun/crema-image/Dockerfile /tmp/crema-src/Dockerfile
cd /tmp/crema-src
gcloud builds submit --project=openrouter-core \
  --tag us-docker.pkg.dev/openrouter-core/openrouter/crema-autoscaler:1.0 .
```

Takes ~30-40 min (Bazel Java build + Go build). The build uses only public
base images (`gcr.io/cloud-marketplace/google/ubuntu2204` for the builder
stages, `eclipse-temurin:21-jre-noble` for the final stage) — no cross-project
Artifact Registry reads needed.
