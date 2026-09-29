# GetWorkspaceRequest

## Example Usage

```typescript
import { GetWorkspaceRequest } from "@openrouter-monorepo/management-sdk-generated/models/operations";

let value: GetWorkspaceRequest = {
  id: "production",
};
```

## Fields

| Field                           | Type                            | Required                        | Description                     | Example                         |
| ------------------------------- | ------------------------------- | ------------------------------- | ------------------------------- | ------------------------------- |
| `id`                            | *string*                        | :heavy_check_mark:              | The workspace ID (UUID) or slug | production                      |