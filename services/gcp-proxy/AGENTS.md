# gcp-proxy

Regional egress relays for cfw-api. Rationale, diagrams and failure behaviour are in [README.md](./README.md). The routing rules themselves live in `services/cfw-api/src/middlewares/proxy.ts`.

## Rules

- **Never misrepresent a caller's region.** A caller outside CN and HK must never be presented to a provider as Chinese, and a CN or HK caller must never be presented as non-Chinese. RU and BY callers are never relayed.
- **Update the README routing diagram with the rules.** Any change to the colo or country sets or the predicates in `proxy.ts` updates the Routing decision diagram in `README.md` in the same PR.
- **More than cfw-api relays.** cfw-api mounts `createProxyMiddleware` on `chat/completions`, `completions`, `responses`, `messages` and `cursor`. cfw-embeddings-api, cfw-image-api, cfw-rerank-api, cfw-stt-api, cfw-tts-api, cfw-video-api, cfw-decisions-api and cfw-workflow-api mount the same middleware. Scope a relay change or outage across all of them (`rg "createProxyMiddleware\(" services`).
- **Stream bodies, never buffer them.** Both cfw-api and the relay hand the incoming body stream straight to the outgoing request. Cloud Run's front end may buffer independently of this code.
- **Keep the relay free of logic.** It validates the pre-shared key, drops the `host` header, re-sets the PSK header and calls `fetch`. The first hop in `buildRelayRequest` already drops the query string, rebuilds the path from the endpoint, and strips `host`, `accept-encoding`, `OR_FORCE_PROXY` and the client IP headers before stamping its own.
- **Only the client IP survives the hop.** The first hop puts the caller's IP in `or-client-forwarded-ip` and `or-client-forwarded-ip-secure`, and the second hop trusts them only with a valid PSK. Country, colo, ASN and TLS fingerprint on the second hop describe Google's egress, not the caller. Forwarding the caller's geo and network fields as authenticated headers is tracked in PLA-2560.
- **Nothing stops a second relay.** The second hop recomputes the decision from its own `cf.colo` and `cf.country`. It normally lands at SIN or HKG, where the rules do not fire, but a Singapore hop that landed at HKG would be relayed again. A short-circuit on a valid PSK is tracked in PLA-2559.
