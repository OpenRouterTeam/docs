# GetModelsResponse

## Example Usage

```typescript
import { GetModelsResponse } from "@openrouter-monorepo/management-sdk-generated/models/operations";

let value: GetModelsResponse = {
  result: {
    data: [
      {
        id: "openai/gpt-4",
        canonicalSlug: "openai/gpt-4",
        name: "GPT-4",
        created: 1692901234,
        description:
          "GPT-4 is a large multimodal model that can solve difficult problems with greater accuracy.",
        pricing: {
          prompt: "0.00003",
          completion: "0.00006",
          request: "0",
          image: "0",
        },
        contextLength: 8192,
        architecture: {
          tokenizer: "GPT",
          instructType: "chatml",
          modality: "text->text",
          inputModalities: [
            "text",
          ],
          outputModalities: [
            "text",
          ],
        },
        topProvider: {
          contextLength: 8192,
          maxCompletionTokens: 4096,
          isModerated: true,
        },
        perRequestLimits: null,
        supportedParameters: [
          "temperature",
          "top_p",
          "max_tokens",
          "frequency_penalty",
          "presence_penalty",
        ],
        defaultParameters: null,
        supportedVoices: null,
        knowledgeCutoff: null,
        expirationDate: null,
        links: {
          details: "/api/v1/models/openai/gpt-4/endpoints",
        },
      },
    ],
    totalCount: 150,
    links: {
      next: "/api/v1/models?offset=500&limit=500",
    },
  },
};
```

## Fields

| Field                                | Type                                 | Required                             | Description                          |
| ------------------------------------ | ------------------------------------ | ------------------------------------ | ------------------------------------ |
| `result`                             | *operations.GetModelsResponseResult* | :heavy_check_mark:                   | N/A                                  |