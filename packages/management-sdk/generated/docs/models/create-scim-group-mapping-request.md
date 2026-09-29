# CreateScimGroupMappingRequest

## Example Usage

```typescript
import { CreateScimGroupMappingRequest } from "@openrouter-monorepo/management-sdk-generated/models";

let value: CreateScimGroupMappingRequest = {
  scimGroupId: "3fba433f-4bd0-4434-b24b-4391cb2de7f2",
  workspaceId: "39879e2e-ff04-4418-8aec-d84b6faa74f7",
  role: "member",
};
```

## Fields

| Field                                                                                           | Type                                                                                            | Required                                                                                        | Description                                                                                     |
| ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `scimGroupId`                                                                                   | *string*                                                                                        | :heavy_check_mark:                                                                              | N/A                                                                                             |
| `workspaceId`                                                                                   | *string*                                                                                        | :heavy_check_mark:                                                                              | N/A                                                                                             |
| `role`                                                                                          | [models.CreateScimGroupMappingRequestRole](../models/create-scim-group-mapping-request-role.md) | :heavy_check_mark:                                                                              | N/A                                                                                             |