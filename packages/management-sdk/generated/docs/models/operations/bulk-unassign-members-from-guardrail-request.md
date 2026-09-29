# BulkUnassignMembersFromGuardrailRequest

## Example Usage

```typescript
import { BulkUnassignMembersFromGuardrailRequest } from "@openrouter-monorepo/management-sdk-generated/models/operations";

let value: BulkUnassignMembersFromGuardrailRequest = {
  id: "550e8400-e29b-41d4-a716-446655440000",
};
```

## Fields

| Field                                                                              | Type                                                                               | Required                                                                           | Description                                                                        | Example                                                                            |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `id`                                                                               | *string*                                                                           | :heavy_check_mark:                                                                 | The unique identifier of the guardrail                                             | 550e8400-e29b-41d4-a716-446655440000                                               |
| `body`                                                                             | [models.BulkUnassignMembersRequest](../../models/bulk-unassign-members-request.md) | :heavy_minus_sign:                                                                 | N/A                                                                                | {<br/>"member_user_ids": [<br/>"user_abc123",<br/>"user_def456"<br/>]<br/>}        |