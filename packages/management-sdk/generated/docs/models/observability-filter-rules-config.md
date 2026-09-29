# ObservabilityFilterRulesConfig

Optional structured filter rules controlling which events are forwarded.

## Example Usage

```typescript
import { ObservabilityFilterRulesConfig } from "@openrouter-monorepo/management-sdk-generated/models";

let value: ObservabilityFilterRulesConfig = {
  groups: [
    {
      rules: [
        {
          field: "model",
          operator: "equals",
          value: "openai/gpt-4o",
        },
      ],
    },
  ],
};
```

## Fields

| Field                                                                                 | Type                                                                                  | Required                                                                              | Description                                                                           |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `enabled`                                                                             | *boolean*                                                                             | :heavy_minus_sign:                                                                    | N/A                                                                                   |
| `groups`                                                                              | [models.ObservabilityFilterRuleGroup](../models/observability-filter-rule-group.md)[] | :heavy_check_mark:                                                                    | N/A                                                                                   |