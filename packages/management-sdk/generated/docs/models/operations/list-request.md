# ListRequest

## Example Usage

```typescript
import { ListRequest } from "@openrouter-monorepo/management-sdk-generated/models/operations";

let value: ListRequest = {
  includeDisabled: "false",
  offset: 0,
  workspaceId: "0df9e665-d932-5740-b2c7-b52af166bc11",
};
```

## Fields

| Field                                                                                    | Type                                                                                     | Required                                                                                 | Description                                                                              | Example                                                                                  |
| ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `includeDisabled`                                                                        | *string*                                                                                 | :heavy_minus_sign:                                                                       | Whether to include disabled API keys in the response                                     | false                                                                                    |
| `offset`                                                                                 | *number*                                                                                 | :heavy_minus_sign:                                                                       | Number of API keys to skip for pagination                                                | 0                                                                                        |
| `workspaceId`                                                                            | *string*                                                                                 | :heavy_minus_sign:                                                                       | Filter API keys by workspace ID. By default, keys in the default workspace are returned. | 0df9e665-d932-5740-b2c7-b52af166bc11                                                     |