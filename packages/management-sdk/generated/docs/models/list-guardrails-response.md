# ListGuardrailsResponse

## Example Usage

```typescript
import { ListGuardrailsResponse } from "@openrouter-monorepo/management-sdk-generated/models";

let value: ListGuardrailsResponse = {
  data: [
    {
      id: "550e8400-e29b-41d4-a716-446655440000",
      name: "Production Guardrail",
      description: "Guardrail for production environment",
      limitUsd: 100,
      resetInterval: "monthly",
      includeByokInBudgets: false,
      allowedProviders: [
        "openai",
        "anthropic",
        "google",
      ],
      ignoredProviders: null,
      allowedModels: null,
      ignoredModels: null,
      enforceZdr: null,
      enforceZdrAnthropic: true,
      enforceZdrOpenai: true,
      enforceZdrGoogle: false,
      enforceZdrXai: false,
      enforceZdrOther: false,
      enablePaidModelTraining: true,
      enableFreeModelTraining: true,
      enableFreeModelPublication: false,
      contentFilterBuiltins: [
        {
          slug: "email",
          action: "redact",
          label: "[EMAIL]",
        },
      ],
      contentFilters: null,
      createdAt: "2025-08-24T10:30:00Z",
      updatedAt: "2025-08-24T15:45:00Z",
      workspaceId: "0df9e665-d932-5740-b2c7-b52af166bc11",
    },
  ],
  totalCount: 1,
};
```

## Fields

| Field                                        | Type                                         | Required                                     | Description                                  | Example                                      |
| -------------------------------------------- | -------------------------------------------- | -------------------------------------------- | -------------------------------------------- | -------------------------------------------- |
| `data`                                       | [models.Guardrail](../models/guardrail.md)[] | :heavy_check_mark:                           | List of guardrails                           |                                              |
| `totalCount`                                 | *number*                                     | :heavy_check_mark:                           | Total number of guardrails                   | 25                                           |