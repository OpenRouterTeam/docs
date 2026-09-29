# Status

Current status of the sync job: queued, running, succeeded, or failed.

## Example Usage

```typescript
import { Status } from "@openrouter-monorepo/management-sdk-generated/models";

let value: Status = "succeeded";

// Open enum: unrecognized values are captured as Unrecognized<string>
```

## Values

```typescript
"queued" | "running" | "succeeded" | "failed" | Unrecognized<string>
```