# PatchKeysHashLimitReset

New limit reset type for the API key (daily, weekly, monthly, or null for no reset). Resets happen automatically at midnight UTC, and weeks are Monday through Sunday.

## Example Usage

```typescript
import { PatchKeysHashLimitReset } from "@openrouter-monorepo/management-sdk-generated/models/operations";

let value: PatchKeysHashLimitReset = "daily";
```

## Values

```typescript
"daily" | "weekly" | "monthly"
```