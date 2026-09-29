# ListWorkspaceBudgetsRequest

## Example Usage

```typescript
import { ListWorkspaceBudgetsRequest } from "@openrouter-monorepo/management-sdk-generated/models/operations";

let value: ListWorkspaceBudgetsRequest = {
  workspaceRef: "production",
};
```

## Fields

| Field                           | Type                            | Required                        | Description                     | Example                         |
| ------------------------------- | ------------------------------- | ------------------------------- | ------------------------------- | ------------------------------- |
| `workspaceRef`                  | *string*                        | :heavy_check_mark:              | The workspace ID (UUID) or slug | production                      |