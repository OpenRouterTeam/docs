# PostKeysLimitReset

Type of limit reset for the API key (daily, weekly, monthly, or null for no reset). Resets happen automatically at midnight UTC, and weeks are Monday through Sunday.

## Example Usage

```typescript
import { PostKeysLimitReset } from "@openrouter-monorepo/management-sdk-generated/models/operations";

let value: PostKeysLimitReset = "monthly";
```

## Values

```typescript
"daily" | "weekly" | "monthly"
```