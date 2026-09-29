# ListPresetVersionsRequest

## Example Usage

```typescript
import { ListPresetVersionsRequest } from "@openrouter-monorepo/management-sdk-generated/models/operations";

let value: ListPresetVersionsRequest = {
  slug: "my-preset",
};
```

## Fields

| Field                                         | Type                                          | Required                                      | Description                                   | Example                                       |
| --------------------------------------------- | --------------------------------------------- | --------------------------------------------- | --------------------------------------------- | --------------------------------------------- |
| `slug`                                        | *string*                                      | :heavy_check_mark:                            | URL-safe slug identifying the preset.         | my-preset                                     |
| `offset`                                      | *number*                                      | :heavy_minus_sign:                            | Number of records to skip for pagination      | 0                                             |
| `limit`                                       | *number*                                      | :heavy_minus_sign:                            | Maximum number of records to return (max 100) | 50                                            |