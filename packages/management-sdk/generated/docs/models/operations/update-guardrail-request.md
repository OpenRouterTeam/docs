# UpdateGuardrailRequest

## Example Usage

```typescript
import { UpdateGuardrailRequest } from "@openrouter-monorepo/management-sdk-generated/models/operations";

let value: UpdateGuardrailRequest = {
  id: "550e8400-e29b-41d4-a716-446655440000",
};
```

## Fields

| Field                                                                                                                   | Type                                                                                                                    | Required                                                                                                                | Description                                                                                                             | Example                                                                                                                 |
| ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `id`                                                                                                                    | *string*                                                                                                                | :heavy_check_mark:                                                                                                      | The unique identifier of the guardrail to update                                                                        | 550e8400-e29b-41d4-a716-446655440000                                                                                    |
| `body`                                                                                                                  | [models.UpdateGuardrailRequest](../../models/update-guardrail-request.md)                                               | :heavy_minus_sign:                                                                                                      | N/A                                                                                                                     | {<br/>"name": "Updated Guardrail Name",<br/>"description": "Updated description",<br/>"limit_usd": 75,<br/>"reset_interval": "weekly"<br/>} |