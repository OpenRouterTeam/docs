# ObservabilityFilterRuleGroup

## Example Usage

```typescript
import { ObservabilityFilterRuleGroup } from "@openrouter-monorepo/management-sdk-generated/models";

let value: ObservabilityFilterRuleGroup = {
  rules: [
    {
      field: "model",
      operator: "equals",
      value: "openai/gpt-4o",
    },
  ],
};
```

## Fields

| Field                              | Type                               | Required                           | Description                        |
| ---------------------------------- | ---------------------------------- | ---------------------------------- | ---------------------------------- |
| `logic`                            | [models.Logic](../models/logic.md) | :heavy_minus_sign:                 | N/A                                |
| `rules`                            | [models.Rule](../models/rule.md)[] | :heavy_check_mark:                 | N/A                                |