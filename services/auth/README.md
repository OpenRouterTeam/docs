# Authentication Service

This service handles authenticating users against the API and fetching their
credit balances. It runs in front of the backing databases, and is only
invoked when there is a miss in the edge authentication caches.

It consists of a Cloud Run service, accessed by a Cloudflare Tunnel.

## Local usage

The auth service runs on port `8802` when started via Tilt.
The local dev bearer token is `dev-token`.

### Health check

```bash
curl http://localhost:8802/healthz
```

### Authorize with the seeded `unlimitedkey`

The `keyHash` is the SHA-256 hash of `sk-or-v1-unlimitedkey`,
seeded in `postgres/seed.sql`:

```bash
curl -X POST http://localhost:8802/auth \
  -H "Authorization: Bearer dev-token" \
  -H "Content-Type: application/json" \
  -d '{"keyHash":"31fb2ef893d58dc3b94c9c6864c4c220afca79830c919a4f4c27e151a25e2d1f"}'
```

On success the response contains the user context
(entity, credits, rate limits, etc.).
