# WorkspaceBudgetInterval

Budget reset interval. Use "lifetime" for a one-time budget that never resets.

## Example Usage

```typescript
import { WorkspaceBudgetInterval } from "@openrouter-monorepo/management-sdk-generated/models";

let value: WorkspaceBudgetInterval = "monthly";
```

## Values

```typescript
"daily" | "weekly" | "monthly" | "lifetime"
```