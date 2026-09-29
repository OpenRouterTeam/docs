# startups

Shared logic for OpenRouter's startup-program application flow. Holds the Zod submission schemas, supporting-material validation, the submission handler, HubSpot contact/deal sync, and organization helpers — split out of `projects/web` so the `cfw-frontend-api` `startups/apply` routes and the web form can share one implementation.

## Architecture

```mermaid
graph TD
    Form["startups/apply routes\n+ web form"] --> Schemas["submission-schemas.ts\nZod request schemas"]
    Form --> Handler["submission-handler.ts\nvalidate · dedupe · submit"]
    Handler --> Materials["supporting-material-validation.ts\nMIME + type-group checks"]
    Handler --> Org["organization-helpers.ts\nClerk org create/join"]
    Handler --> HubSpot["hubspot-operations.ts\ncontact + deal upsert"]
    HubSpot --> Env["hubspot-env.ts\nrequired HubSpot env"]
    Handler --> DB["db · email · prompt-storage"]
```

## Commands

| Command | Description |
|---------|-------------|
| `bun test` | Run unit tests |
| `bun run typecheck` | Type-check |
