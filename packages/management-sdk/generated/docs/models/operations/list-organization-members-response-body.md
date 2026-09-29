# ListOrganizationMembersResponseBody

List of organization members

## Example Usage

```typescript
import { ListOrganizationMembersResponseBody } from "@openrouter-monorepo/management-sdk-generated/models/operations";

let value: ListOrganizationMembersResponseBody = {
  data: [],
  totalCount: 25,
};
```

## Fields

| Field                                                                                                 | Type                                                                                                  | Required                                                                                              | Description                                                                                           | Example                                                                                               |
| ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `data`                                                                                                | [operations.ListOrganizationMembersData](../../models/operations/list-organization-members-data.md)[] | :heavy_check_mark:                                                                                    | List of organization members                                                                          |                                                                                                       |
| `totalCount`                                                                                          | *number*                                                                                              | :heavy_check_mark:                                                                                    | Total number of members in the organization                                                           | 25                                                                                                    |