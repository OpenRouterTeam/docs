# ListPresetsRequest

## Example Usage

```typescript
import { ListPresetsRequest } from "@openrouter-monorepo/management-sdk-generated/models/operations";

let value: ListPresetsRequest = {};
```

## Fields

| Field                                         | Type                                          | Required                                      | Description                                   | Example                                       |
| --------------------------------------------- | --------------------------------------------- | --------------------------------------------- | --------------------------------------------- | --------------------------------------------- |
| `offset`                                      | *number*                                      | :heavy_minus_sign:                            | Number of records to skip for pagination      | 0                                             |
| `limit`                                       | *number*                                      | :heavy_minus_sign:                            | Maximum number of records to return (max 100) | 50                                            |