# SubmitGenerationFeedbackRequest

Structured feedback about a specific generation

## Example Usage

```typescript
import { SubmitGenerationFeedbackRequest } from "@openrouter-monorepo/management-sdk-generated/models";

let value: SubmitGenerationFeedbackRequest = {
  generationId: "gen-3bhGkxlo4XFrqiabUM7NDtwDzWwG",
  category: "incorrect_response",
  comment: "The model repeated the same paragraph three times.",
};
```

## Fields

| Field                                                 | Type                                                  | Required                                              | Description                                           | Example                                               |
| ----------------------------------------------------- | ----------------------------------------------------- | ----------------------------------------------------- | ----------------------------------------------------- | ----------------------------------------------------- |
| `generationId`                                        | *string*                                              | :heavy_check_mark:                                    | The generation to submit feedback on                  | gen-3bhGkxlo4XFrqiabUM7NDtwDzWwG                      |
| `category`                                            | [models.Category](../models/category.md)              | :heavy_check_mark:                                    | The category of feedback being reported               | incorrect_response                                    |
| `comment`                                             | *string*                                              | :heavy_minus_sign:                                    | An optional free-text comment describing the feedback | The model repeated the same paragraph three times.    |