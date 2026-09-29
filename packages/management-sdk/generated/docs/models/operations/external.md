# External

Optional partner-defined identity associated with the created API key.

## Example Usage

```typescript
import { External } from "@openrouter-monorepo/management-sdk-generated/models/operations";

let value: External = {
  user: "partner-user-123",
};
```

## Fields

| Field                                                                                                                                         | Type                                                                                                                                          | Required                                                                                                                                      | Description                                                                                                                                   | Example                                                                                                                                       |
| --------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `user`                                                                                                                                        | *string*                                                                                                                                      | :heavy_check_mark:                                                                                                                            | Partner's end-user identifier for attribution.                                                                                                | partner-user-123                                                                                                                              |
| `apiKey`                                                                                                                                      | *string*                                                                                                                                      | :heavy_minus_sign:                                                                                                                            | Optional partner-supplied API key with a minimum length of 32 characters and sufficient entropy. Stored as a SHA-256 hash and never returned. |                                                                                                                                               |