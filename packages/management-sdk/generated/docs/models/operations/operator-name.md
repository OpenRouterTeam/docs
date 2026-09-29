# OperatorName

Operator identifier used in filter definitions

## Example Usage

```typescript
import { OperatorName } from "@openrouter-monorepo/management-sdk-generated/models/operations";

let value: OperatorName = "eq";

// Open enum: unrecognized values are captured as Unrecognized<string>
```

## Values

```typescript
"eq" | "neq" | "in" | "not_in" | "gt" | "gte" | "lt" | "lte" | Unrecognized<string>
```