# Observability

## Overview

### Available Operations

* [list](#list) - List observability destinations
* [create](#create) - Create an observability destination
* [get](#get) - Get an observability destination
* [update](#update) - Update an observability destination
* [delete](#delete) - Delete an observability destination

## list

List the observability destinations configured for the authenticated entity's default workspace. Use the `workspace_id` query parameter to scope the result to a different workspace. Only destinations with stable release status are surfaced — destinations of other types are excluded. [Management key](/docs/guides/overview/auth/management-api-keys) required.

### Example Usage

<!-- UsageSnippet language="typescript" operationID="listObservabilityDestinations" method="get" path="/observability/destinations" -->
```typescript
import { OpenRouterManagement } from "@openrouter-monorepo/management-sdk-generated";

const openRouterManagement = new OpenRouterManagement({
  bearerAuth: "<YOUR_BEARER_TOKEN_HERE>",
});

async function run() {
  const result = await openRouterManagement.observability.list({
    workspaceId: "550e8400-e29b-41d4-a716-446655440000",
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
import { observabilityList } from "@openrouter-monorepo/management-sdk-generated/funcs/observability-list.js";

// Use `OpenRouterManagementCore` for best tree-shaking performance.
// You can create one instance of it to use across an application.
const openRouterManagement = new OpenRouterManagementCore({
  bearerAuth: "<YOUR_BEARER_TOKEN_HERE>",
});

async function run() {
  const res = await observabilityList(openRouterManagement, {
    workspaceId: "550e8400-e29b-41d4-a716-446655440000",
  });
  if (res.ok) {
    const { value: result } = res;
    for await (const page of result) {
    console.log(page);
  }
  } else {
    console.log("observabilityList failed:", res.error);
  }
}

run();
```

### Parameters

| Parameter                                                                                                                                                                      | Type                                                                                                                                                                           | Required                                                                                                                                                                       | Description                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `request`                                                                                                                                                                      | [operations.ListObservabilityDestinationsRequest](../../models/operations/list-observability-destinations-request.md)                                                          | :heavy_check_mark:                                                                                                                                                             | The request object to use for the request.                                                                                                                                     |
| `options`                                                                                                                                                                      | RequestOptions                                                                                                                                                                 | :heavy_minus_sign:                                                                                                                                                             | Used to set various options for making HTTP requests.                                                                                                                          |
| `options.fetchOptions`                                                                                                                                                         | [RequestInit](https://developer.mozilla.org/en-US/docs/Web/API/Request/Request#options)                                                                                        | :heavy_minus_sign:                                                                                                                                                             | Options that are passed to the underlying HTTP request. This can be used to inject extra headers for examples. All `Request` options, except `method` and `body`, are allowed. |
| `options.retries`                                                                                                                                                              | [RetryConfig](../../lib/utils/retryconfig.md)                                                                                                                                  | :heavy_minus_sign:                                                                                                                                                             | Enables retrying HTTP requests under certain failure conditions.                                                                                                               |

### Response

**Promise\<[operations.ListObservabilityDestinationsResponse](../../models/operations/list-observability-destinations-response.md)\>**

### Errors

| Error Type                              | Status Code                             | Content Type                            |
| --------------------------------------- | --------------------------------------- | --------------------------------------- |
| errors.BadRequestResponseError          | 400                                     | application/json                        |
| errors.UnauthorizedResponseError        | 401                                     | application/json                        |
| errors.InternalServerResponseError      | 500                                     | application/json                        |
| errors.OpenRouterManagementDefaultError | 4XX, 5XX                                | \*/\*                                   |

## create

Create a new observability destination. A maximum of 5 destinations per type is allowed. Defaults to the authenticated entity's default workspace; use the `workspace_id` body field to scope to a different workspace. [Management key](/docs/guides/overview/auth/management-api-keys) required.

### Example Usage

<!-- UsageSnippet language="typescript" operationID="createObservabilityDestination" method="post" path="/observability/destinations" -->
```typescript
import { OpenRouterManagement } from "@openrouter-monorepo/management-sdk-generated";

const openRouterManagement = new OpenRouterManagement({
  bearerAuth: "<YOUR_BEARER_TOKEN_HERE>",
});

async function run() {
  const result = await openRouterManagement.observability.create({
    type: "langfuse",
    name: "Production Langfuse",
    config: {
      "secretKey": "sk-l...AbCd",
      "publicKey": "pk-l...EfGh",
      "baseUrl": "https://us.cloud.langfuse.com",
    },
  });

  console.log(result);
}

run();
```

### Standalone function

The standalone function version of this method:

```typescript
import { OpenRouterManagementCore } from "@openrouter-monorepo/management-sdk-generated/core.js";
import { observabilityCreate } from "@openrouter-monorepo/management-sdk-generated/funcs/observability-create.js";

// Use `OpenRouterManagementCore` for best tree-shaking performance.
// You can create one instance of it to use across an application.
const openRouterManagement = new OpenRouterManagementCore({
  bearerAuth: "<YOUR_BEARER_TOKEN_HERE>",
});

async function run() {
  const res = await observabilityCreate(openRouterManagement, {
    type: "langfuse",
    name: "Production Langfuse",
    config: {
      "secretKey": "sk-l...AbCd",
      "publicKey": "pk-l...EfGh",
      "baseUrl": "https://us.cloud.langfuse.com",
    },
  });
  if (res.ok) {
    const { value: result } = res;
    console.log(result);
  } else {
    console.log("observabilityCreate failed:", res.error);
  }
}

run();
```

### Parameters

| Parameter                                                                                                                                                                      | Type                                                                                                                                                                           | Required                                                                                                                                                                       | Description                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `request`                                                                                                                                                                      | [models.CreateObservabilityDestinationRequest](../../models/create-observability-destination-request.md)                                                                       | :heavy_check_mark:                                                                                                                                                             | The request object to use for the request.                                                                                                                                     |
| `options`                                                                                                                                                                      | RequestOptions                                                                                                                                                                 | :heavy_minus_sign:                                                                                                                                                             | Used to set various options for making HTTP requests.                                                                                                                          |
| `options.fetchOptions`                                                                                                                                                         | [RequestInit](https://developer.mozilla.org/en-US/docs/Web/API/Request/Request#options)                                                                                        | :heavy_minus_sign:                                                                                                                                                             | Options that are passed to the underlying HTTP request. This can be used to inject extra headers for examples. All `Request` options, except `method` and `body`, are allowed. |
| `options.retries`                                                                                                                                                              | [RetryConfig](../../lib/utils/retryconfig.md)                                                                                                                                  | :heavy_minus_sign:                                                                                                                                                             | Enables retrying HTTP requests under certain failure conditions.                                                                                                               |

### Response

**Promise\<[models.CreateObservabilityDestinationResponse](../../models/create-observability-destination-response.md)\>**

### Errors

| Error Type                              | Status Code                             | Content Type                            |
| --------------------------------------- | --------------------------------------- | --------------------------------------- |
| errors.BadRequestResponseError          | 400                                     | application/json                        |
| errors.UnauthorizedResponseError        | 401                                     | application/json                        |
| errors.ForbiddenResponseError           | 403                                     | application/json                        |
| errors.ConflictResponseError            | 409                                     | application/json                        |
| errors.InternalServerResponseError      | 500                                     | application/json                        |
| errors.OpenRouterManagementDefaultError | 4XX, 5XX                                | \*/\*                                   |

## get

Fetch a single observability destination by its UUID. [Management key](/docs/guides/overview/auth/management-api-keys) required.

### Example Usage

<!-- UsageSnippet language="typescript" operationID="getObservabilityDestination" method="get" path="/observability/destinations/{id}" -->
```typescript
import { OpenRouterManagement } from "@openrouter-monorepo/management-sdk-generated";

const openRouterManagement = new OpenRouterManagement({
  bearerAuth: "<YOUR_BEARER_TOKEN_HERE>",
});

async function run() {
  const result = await openRouterManagement.observability.get({
    id: "99999999-aaaa-bbbb-cccc-dddddddddddd",
  });

  console.log(result);
}

run();
```

### Standalone function

The standalone function version of this method:

```typescript
import { OpenRouterManagementCore } from "@openrouter-monorepo/management-sdk-generated/core.js";
import { observabilityGet } from "@openrouter-monorepo/management-sdk-generated/funcs/observability-get.js";

// Use `OpenRouterManagementCore` for best tree-shaking performance.
// You can create one instance of it to use across an application.
const openRouterManagement = new OpenRouterManagementCore({
  bearerAuth: "<YOUR_BEARER_TOKEN_HERE>",
});

async function run() {
  const res = await observabilityGet(openRouterManagement, {
    id: "99999999-aaaa-bbbb-cccc-dddddddddddd",
  });
  if (res.ok) {
    const { value: result } = res;
    console.log(result);
  } else {
    console.log("observabilityGet failed:", res.error);
  }
}

run();
```

### Parameters

| Parameter                                                                                                                                                                      | Type                                                                                                                                                                           | Required                                                                                                                                                                       | Description                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `request`                                                                                                                                                                      | [operations.GetObservabilityDestinationRequest](../../models/operations/get-observability-destination-request.md)                                                              | :heavy_check_mark:                                                                                                                                                             | The request object to use for the request.                                                                                                                                     |
| `options`                                                                                                                                                                      | RequestOptions                                                                                                                                                                 | :heavy_minus_sign:                                                                                                                                                             | Used to set various options for making HTTP requests.                                                                                                                          |
| `options.fetchOptions`                                                                                                                                                         | [RequestInit](https://developer.mozilla.org/en-US/docs/Web/API/Request/Request#options)                                                                                        | :heavy_minus_sign:                                                                                                                                                             | Options that are passed to the underlying HTTP request. This can be used to inject extra headers for examples. All `Request` options, except `method` and `body`, are allowed. |
| `options.retries`                                                                                                                                                              | [RetryConfig](../../lib/utils/retryconfig.md)                                                                                                                                  | :heavy_minus_sign:                                                                                                                                                             | Enables retrying HTTP requests under certain failure conditions.                                                                                                               |

### Response

**Promise\<[models.GetObservabilityDestinationResponse](../../models/get-observability-destination-response.md)\>**

### Errors

| Error Type                              | Status Code                             | Content Type                            |
| --------------------------------------- | --------------------------------------- | --------------------------------------- |
| errors.UnauthorizedResponseError        | 401                                     | application/json                        |
| errors.NotFoundResponseError            | 404                                     | application/json                        |
| errors.InternalServerResponseError      | 500                                     | application/json                        |
| errors.OpenRouterManagementDefaultError | 4XX, 5XX                                | \*/\*                                   |

## update

Update an existing observability destination. Only the fields provided in the request body are updated. [Management key](/docs/guides/overview/auth/management-api-keys) required.

### Example Usage

<!-- UsageSnippet language="typescript" operationID="updateObservabilityDestination" method="patch" path="/observability/destinations/{id}" -->
```typescript
import { OpenRouterManagement } from "@openrouter-monorepo/management-sdk-generated";

const openRouterManagement = new OpenRouterManagement({
  bearerAuth: "<YOUR_BEARER_TOKEN_HERE>",
});

async function run() {
  const result = await openRouterManagement.observability.update({
    id: "99999999-aaaa-bbbb-cccc-dddddddddddd",
    body: {
      name: "Updated Langfuse",
      enabled: false,
    },
  });

  console.log(result);
}

run();
```

### Standalone function

The standalone function version of this method:

```typescript
import { OpenRouterManagementCore } from "@openrouter-monorepo/management-sdk-generated/core.js";
import { observabilityUpdate } from "@openrouter-monorepo/management-sdk-generated/funcs/observability-update.js";

// Use `OpenRouterManagementCore` for best tree-shaking performance.
// You can create one instance of it to use across an application.
const openRouterManagement = new OpenRouterManagementCore({
  bearerAuth: "<YOUR_BEARER_TOKEN_HERE>",
});

async function run() {
  const res = await observabilityUpdate(openRouterManagement, {
    id: "99999999-aaaa-bbbb-cccc-dddddddddddd",
    body: {
      name: "Updated Langfuse",
      enabled: false,
    },
  });
  if (res.ok) {
    const { value: result } = res;
    console.log(result);
  } else {
    console.log("observabilityUpdate failed:", res.error);
  }
}

run();
```

### Parameters

| Parameter                                                                                                                                                                      | Type                                                                                                                                                                           | Required                                                                                                                                                                       | Description                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `request`                                                                                                                                                                      | [operations.UpdateObservabilityDestinationRequest](../../models/operations/update-observability-destination-request.md)                                                        | :heavy_check_mark:                                                                                                                                                             | The request object to use for the request.                                                                                                                                     |
| `options`                                                                                                                                                                      | RequestOptions                                                                                                                                                                 | :heavy_minus_sign:                                                                                                                                                             | Used to set various options for making HTTP requests.                                                                                                                          |
| `options.fetchOptions`                                                                                                                                                         | [RequestInit](https://developer.mozilla.org/en-US/docs/Web/API/Request/Request#options)                                                                                        | :heavy_minus_sign:                                                                                                                                                             | Options that are passed to the underlying HTTP request. This can be used to inject extra headers for examples. All `Request` options, except `method` and `body`, are allowed. |
| `options.retries`                                                                                                                                                              | [RetryConfig](../../lib/utils/retryconfig.md)                                                                                                                                  | :heavy_minus_sign:                                                                                                                                                             | Enables retrying HTTP requests under certain failure conditions.                                                                                                               |

### Response

**Promise\<[models.UpdateObservabilityDestinationResponse](../../models/update-observability-destination-response.md)\>**

### Errors

| Error Type                              | Status Code                             | Content Type                            |
| --------------------------------------- | --------------------------------------- | --------------------------------------- |
| errors.BadRequestResponseError          | 400                                     | application/json                        |
| errors.UnauthorizedResponseError        | 401                                     | application/json                        |
| errors.ForbiddenResponseError           | 403                                     | application/json                        |
| errors.NotFoundResponseError            | 404                                     | application/json                        |
| errors.ConflictResponseError            | 409                                     | application/json                        |
| errors.InternalServerResponseError      | 500                                     | application/json                        |
| errors.OpenRouterManagementDefaultError | 4XX, 5XX                                | \*/\*                                   |

## delete

Delete an existing observability destination. This performs a soft delete. [Management key](/docs/guides/overview/auth/management-api-keys) required.

### Example Usage

<!-- UsageSnippet language="typescript" operationID="deleteObservabilityDestination" method="delete" path="/observability/destinations/{id}" -->
```typescript
import { OpenRouterManagement } from "@openrouter-monorepo/management-sdk-generated";

const openRouterManagement = new OpenRouterManagement({
  bearerAuth: "<YOUR_BEARER_TOKEN_HERE>",
});

async function run() {
  const result = await openRouterManagement.observability.delete({
    id: "99999999-aaaa-bbbb-cccc-dddddddddddd",
  });

  console.log(result);
}

run();
```

### Standalone function

The standalone function version of this method:

```typescript
import { OpenRouterManagementCore } from "@openrouter-monorepo/management-sdk-generated/core.js";
import { observabilityDelete } from "@openrouter-monorepo/management-sdk-generated/funcs/observability-delete.js";

// Use `OpenRouterManagementCore` for best tree-shaking performance.
// You can create one instance of it to use across an application.
const openRouterManagement = new OpenRouterManagementCore({
  bearerAuth: "<YOUR_BEARER_TOKEN_HERE>",
});

async function run() {
  const res = await observabilityDelete(openRouterManagement, {
    id: "99999999-aaaa-bbbb-cccc-dddddddddddd",
  });
  if (res.ok) {
    const { value: result } = res;
    console.log(result);
  } else {
    console.log("observabilityDelete failed:", res.error);
  }
}

run();
```

### Parameters

| Parameter                                                                                                                                                                      | Type                                                                                                                                                                           | Required                                                                                                                                                                       | Description                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `request`                                                                                                                                                                      | [operations.DeleteObservabilityDestinationRequest](../../models/operations/delete-observability-destination-request.md)                                                        | :heavy_check_mark:                                                                                                                                                             | The request object to use for the request.                                                                                                                                     |
| `options`                                                                                                                                                                      | RequestOptions                                                                                                                                                                 | :heavy_minus_sign:                                                                                                                                                             | Used to set various options for making HTTP requests.                                                                                                                          |
| `options.fetchOptions`                                                                                                                                                         | [RequestInit](https://developer.mozilla.org/en-US/docs/Web/API/Request/Request#options)                                                                                        | :heavy_minus_sign:                                                                                                                                                             | Options that are passed to the underlying HTTP request. This can be used to inject extra headers for examples. All `Request` options, except `method` and `body`, are allowed. |
| `options.retries`                                                                                                                                                              | [RetryConfig](../../lib/utils/retryconfig.md)                                                                                                                                  | :heavy_minus_sign:                                                                                                                                                             | Enables retrying HTTP requests under certain failure conditions.                                                                                                               |

### Response

**Promise\<[models.DeleteObservabilityDestinationResponse](../../models/delete-observability-destination-response.md)\>**

### Errors

| Error Type                              | Status Code                             | Content Type                            |
| --------------------------------------- | --------------------------------------- | --------------------------------------- |
| errors.UnauthorizedResponseError        | 401                                     | application/json                        |
| errors.NotFoundResponseError            | 404                                     | application/json                        |
| errors.InternalServerResponseError      | 500                                     | application/json                        |
| errors.OpenRouterManagementDefaultError | 4XX, 5XX                                | \*/\*                                   |