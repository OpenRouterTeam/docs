# UpdateBYOKKeyRequest

## Example Usage

```typescript
import { UpdateBYOKKeyRequest } from "@openrouter-monorepo/management-sdk-generated/models/operations";

let value: UpdateBYOKKeyRequest = {
  id: "11111111-2222-3333-4444-555555555555",
};
```

## Fields

| Field                                                                  | Type                                                                   | Required                                                               | Description                                                            | Example                                                                |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `id`                                                                   | *string*                                                               | :heavy_check_mark:                                                     | The BYOK credential ID (UUID).                                         | 11111111-2222-3333-4444-555555555555                                   |
| `body`                                                                 | [models.UpdateBYOKKeyRequest](../../models/update-byok-key-request.md) | :heavy_minus_sign:                                                     | N/A                                                                    | {<br/>"name": "Updated OpenAI Key",<br/>"disabled": false<br/>}        |