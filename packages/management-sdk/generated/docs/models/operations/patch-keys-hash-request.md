# PatchKeysHashRequest

## Example Usage

```typescript
import { PatchKeysHashRequest } from "@openrouter-monorepo/management-sdk-generated/models/operations";

let value: PatchKeysHashRequest = {
  hash: "f01d52606dc8f0a8303a7b5cc3fa07109c2e346cec7c0a16b40de462992ce943",
};
```

## Fields

| Field                                                                                                                     | Type                                                                                                                      | Required                                                                                                                  | Description                                                                                                               | Example                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `hash`                                                                                                                    | *string*                                                                                                                  | :heavy_check_mark:                                                                                                        | The hash identifier of the API key to update                                                                              | f01d52606dc8f0a8303a7b5cc3fa07109c2e346cec7c0a16b40de462992ce943                                                          |
| `body`                                                                                                                    | [operations.PatchKeysHashRequestBody](../../models/operations/patch-keys-hash-request-body.md)                            | :heavy_minus_sign:                                                                                                        | N/A                                                                                                                       | {<br/>"name": "Updated API Key Name",<br/>"disabled": false,<br/>"limit": 75,<br/>"limit_reset": "daily",<br/>"include_byok_in_limit": true<br/>} |