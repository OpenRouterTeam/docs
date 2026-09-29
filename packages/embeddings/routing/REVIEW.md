# Review Guidelines

## Critical Areas
* The LLM & Embeddings Routers have parallel lists of filter steps. When steps are added/removed/modified in one but not the other, verify that it is expected, and ensure the differences are intuitively documented.
* The private endpoint priority step (`prioritizePrivateEndpoints`) is shared with the LLM router. The embeddings handler passes `privateModelPermaslugs` / `privateEndpointIds` from the auth context; the step no-ops when they are empty, so a change that drops them silently disables private-endpoint routing for embeddings.
