# GenerationResponse

Generation response

## Example Usage

```typescript
import { GenerationResponse } from "@openrouter-monorepo/management-sdk-generated/models";

let value: GenerationResponse = {
  data: {
    id: "gen-3bhGkxlo4XFrqiabUM7NDtwDzWwG",
    upstreamId: "chatcmpl-791bcf62-080e-4568-87d0-94c72e3b4946",
    totalCost: 0.0015,
    cacheDiscount: null,
    upstreamInferenceCost: 0.0012,
    createdAt: "2024-07-15T23:33:19.433273Z",
    model: "sao10k/l3-stheno-8b",
    appId: 12345,
    streamed: true,
    cancelled: false,
    providerName: "Infermatic",
    latency: 1250,
    moderationLatency: 50,
    generationTime: 1200,
    finishReason: "stop",
    serviceTier: "priority",
    tokensPrompt: 10,
    tokensCompletion: 25,
    nativeTokensPrompt: 10,
    nativeTokensCompletion: 25,
    nativeTokensCompletionImages: 0,
    nativeTokensReasoning: 5,
    nativeTokensCached: 3,
    numMediaPrompt: 1,
    numInputAudioPrompt: 0,
    numMediaCompletion: 0,
    numSearchResults: 5,
    numFetches: 0,
    webSearchEngine: "exa",
    origin: "https://openrouter.ai/",
    usage: 0.0015,
    isByok: false,
    nativeFinishReason: "stop",
    externalUser: "user-123",
    apiType: "completions",
    presetId: "a9e8d400-592a-494f-908c-375efa66cafd",
    router: "openrouter/auto",
    providerResponses: null,
    userAgent: "Mozilla/5.0",
    httpReferer: "https://openrouter.ai/",
    requestId: "req-1727282430-aBcDeFgHiJkLmNoPqRsT",
    sessionId: null,
    dataRegion: "global",
    workspaceId: "550e8400-e29b-41d4-a716-446655440000",
  },
};
```

## Fields

| Field                                                                  | Type                                                                   | Required                                                               | Description                                                            |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `data`                                                                 | [models.GenerationResponseData](../models/generation-response-data.md) | :heavy_check_mark:                                                     | Generation data                                                        |