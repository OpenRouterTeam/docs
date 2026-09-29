# AABenchmarkEntry

Artificial Analysis benchmark index scores.

## Example Usage

```typescript
import { AABenchmarkEntry } from "@openrouter-monorepo/management-sdk-generated/models";

let value: AABenchmarkEntry = {
  intelligenceIndex: 71.4,
  codingIndex: 63.2,
  agenticIndex: 55.8,
};
```

## Fields

| Field                                        | Type                                         | Required                                     | Description                                  | Example                                      |
| -------------------------------------------- | -------------------------------------------- | -------------------------------------------- | -------------------------------------------- | -------------------------------------------- |
| `intelligenceIndex`                          | *number*                                     | :heavy_check_mark:                           | Artificial Analysis Intelligence Index score | 71.4                                         |
| `codingIndex`                                | *number*                                     | :heavy_check_mark:                           | Artificial Analysis Coding Index score       | 63.2                                         |
| `agenticIndex`                               | *number*                                     | :heavy_check_mark:                           | Artificial Analysis Agentic Index score      | 55.8                                         |