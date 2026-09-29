# Models

## Overview

### Available Operations

* [list](#list) - List all models and their properties

## list

List all models and their properties

### Example Usage

<!-- UsageSnippet language="typescript" operationID="get_/models" method="get" path="/models" -->
```typescript
import { OpenRouterManagement } from "@openrouter-monorepo/management-sdk-generated";

const openRouterManagement = new OpenRouterManagement({
  bearerAuth: "<YOUR_BEARER_TOKEN_HERE>",
});

async function run() {
  const result = await openRouterManagement.models.list({
    category: "programming",
    supportedParameters: "temperature",
    outputModalities: "text",
    sort: "newest",
    useRss: "true",
    useRssChatLinks: "true",
    q: "gpt-4",
    inputModalities: "text,image",
    context: 128000,
    minPrice: 0,
    maxPrice: 10,
    arch: "GPT",
    modelAuthors: "openai,anthropic",
    providers: "OpenAI,Anthropic",
    distillable: "true",
    zdr: "true",
    region: "eu",
    minOutputPrice: 0,
    maxOutputPrice: 10,
    minAgeDays: 0,
    maxAgeDays: 90,
    minIntelligenceIndex: 50,
    maxIntelligenceIndex: 100,
    minCodingIndex: 50,
    maxCodingIndex: 100,
    minAgenticIndex: 50,
    maxAgenticIndex: 100,
    minToolSuccessRate: 0.9,
    maxToolSuccessRate: 1,
  });

  for await (const page of result) {
    console.log(page);
  }
}

run();
```

### Standalone function

The standalone function version of this method:

```typescript
import { OpenRouterManagementCore } from "@openrouter-monorepo/management-sdk-generated/core.js";
import { modelsList } from "@openrouter-monorepo/management-sdk-generated/funcs/models-list.js";

// Use `OpenRouterManagementCore` for best tree-shaking performance.
// You can create one instance of it to use across an application.
const openRouterManagement = new OpenRouterManagementCore({
  bearerAuth: "<YOUR_BEARER_TOKEN_HERE>",
});

async function run() {
  const res = await modelsList(openRouterManagement, {
    category: "programming",
    supportedParameters: "temperature",
    outputModalities: "text",
    sort: "newest",
    useRss: "true",
    useRssChatLinks: "true",
    q: "gpt-4",
    inputModalities: "text,image",
    context: 128000,
    minPrice: 0,
    maxPrice: 10,
    arch: "GPT",
    modelAuthors: "openai,anthropic",
    providers: "OpenAI,Anthropic",
    distillable: "true",
    zdr: "true",
    region: "eu",
    minOutputPrice: 0,
    maxOutputPrice: 10,
    minAgeDays: 0,
    maxAgeDays: 90,
    minIntelligenceIndex: 50,
    maxIntelligenceIndex: 100,
    minCodingIndex: 50,
    maxCodingIndex: 100,
    minAgenticIndex: 50,
    maxAgenticIndex: 100,
    minToolSuccessRate: 0.9,
    maxToolSuccessRate: 1,
  });
  if (res.ok) {
    const { value: result } = res;
    for await (const page of result) {
    console.log(page);
  }
  } else {
    console.log("modelsList failed:", res.error);
  }
}

run();
```

### Parameters

| Parameter                                                                                                                                                                      | Type                                                                                                                                                                           | Required                                                                                                                                                                       | Description                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `request`                                                                                                                                                                      | [operations.GetModelsRequest](../../models/operations/get-models-request.md)                                                                                                   | :heavy_check_mark:                                                                                                                                                             | The request object to use for the request.                                                                                                                                     |
| `options`                                                                                                                                                                      | RequestOptions                                                                                                                                                                 | :heavy_minus_sign:                                                                                                                                                             | Used to set various options for making HTTP requests.                                                                                                                          |
| `options.fetchOptions`                                                                                                                                                         | [RequestInit](https://developer.mozilla.org/en-US/docs/Web/API/Request/Request#options)                                                                                        | :heavy_minus_sign:                                                                                                                                                             | Options that are passed to the underlying HTTP request. This can be used to inject extra headers for examples. All `Request` options, except `method` and `body`, are allowed. |
| `options.retries`                                                                                                                                                              | [RetryConfig](../../lib/utils/retryconfig.md)                                                                                                                                  | :heavy_minus_sign:                                                                                                                                                             | Enables retrying HTTP requests under certain failure conditions.                                                                                                               |

### Response

**Promise\<[operations.GetModelsResponse](../../models/operations/get-models-response.md)\>**

### Errors

| Error Type                              | Status Code                             | Content Type                            |
| --------------------------------------- | --------------------------------------- | --------------------------------------- |
| errors.BadRequestResponseError          | 400                                     | application/json                        |
| errors.ForbiddenResponseError           | 403                                     | application/json                        |
| errors.InternalServerResponseError      | 500                                     | application/json                        |
| errors.OpenRouterManagementDefaultError | 4XX, 5XX                                | \*/\*                                   |