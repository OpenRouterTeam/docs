# ModelBenchmarks

Third-party benchmark rankings for this model. Omitted when no benchmark data is available.

## Example Usage

```typescript
import { ModelBenchmarks } from "@openrouter-monorepo/management-sdk-generated/models";

let value: ModelBenchmarks = {
  designArena: [
    {
      arena: "models",
      category: "website",
      elo: 1385.2,
      winRate: 62.5,
      rank: 5,
    },
  ],
  artificialAnalysis: {
    intelligenceIndex: 71.4,
    codingIndex: 63.2,
    agenticIndex: 55.8,
  },
};
```

## Fields

| Field                                                                                        | Type                                                                                         | Required                                                                                     | Description                                                                                  | Example                                                                                      |
| -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `designArena`                                                                                | [models.DABenchmarkEntry](../models/da-benchmark-entry.md)[]                                 | :heavy_check_mark:                                                                           | Design Arena ELO rankings across arena+category pairs.                                       | [<br/>{<br/>"arena": "models",<br/>"category": "website",<br/>"elo": 1385.2,<br/>"win_rate": 62.5,<br/>"rank": 5<br/>}<br/>] |
| `artificialAnalysis`                                                                         | [models.AABenchmarkEntry](../models/aa-benchmark-entry.md)                                   | :heavy_minus_sign:                                                                           | Artificial Analysis benchmark index scores.                                                  | {<br/>"intelligence_index": 71.4,<br/>"coding_index": 63.2,<br/>"agentic_index": 55.8<br/>}  |