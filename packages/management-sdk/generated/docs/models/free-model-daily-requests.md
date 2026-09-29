# FreeModelDailyRequests

Free-model (`:free` variant) daily request quota for the account that owns the key. Reports the same counter and tier limit that free-model enforcement reads for accounts subject to the free-model limits; the counter resets at UTC midnight. Accounts and endpoints exempt from free-model limits, and BYOK requests, are not gated by it, so `remaining` is the tier policy rather than an enforced ceiling for them.

## Example Usage

```typescript
import { FreeModelDailyRequests } from "@openrouter-monorepo/management-sdk-generated/models";

let value: FreeModelDailyRequests = {
  used: 12,
  limit: 50,
  remaining: 38,
};
```

## Fields

| Field                                                                                                                                     | Type                                                                                                                                      | Required                                                                                                                                  | Description                                                                                                                               | Example                                                                                                                                   |
| ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `used`                                                                                                                                    | *number*                                                                                                                                  | :heavy_check_mark:                                                                                                                        | Free-model requests recorded for the account so far in the current UTC day                                                                | 12                                                                                                                                        |
| `limit`                                                                                                                                   | *number*                                                                                                                                  | :heavy_check_mark:                                                                                                                        | Free-model requests the account may make per UTC day; the ceiling depends on total credits purchased and is independent of `is_free_tier` | 50                                                                                                                                        |
| `remaining`                                                                                                                               | *number*                                                                                                                                  | :heavy_check_mark:                                                                                                                        | Free-model requests left in the current UTC day                                                                                           | 38                                                                                                                                        |