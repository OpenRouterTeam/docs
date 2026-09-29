# PrivateEndpoints

## Overview

### Available Operations

* [list](#list) - List private endpoints
* [create](#create) - Create a private endpoint
* [get](#get) - Get a private endpoint
* [update](#update) - Update a draft private endpoint
* [delete](#delete) - Delete a private endpoint
* [activate](#activate) - Activate a validated private endpoint
* [disable](#disable) - Disable a private endpoint
* [enable](#enable) - Enable a private endpoint
* [updatePricing](#updatepricing) - Set private endpoint pricing
* [validate](#validate) - Validate a draft private endpoint

## list

List the organization's private endpoints, including drafts. Requires the private endpoints entitlement. [Management key](/docs/guides/overview/auth/management-api-keys) required.

### Example Usage

<!-- UsageSnippet language="typescript" operationID="listPrivateEndpoints" method="get" path="/private-endpoints" -->
```typescript
import { OpenRouterManagement } from "@openrouter-monorepo/management-sdk-generated";

const openRouterManagement = new OpenRouterManagement({
  bearerAuth: "<YOUR_BEARER_TOKEN_HERE>",
});

async function run() {
  const result = await openRouterManagement.privateEndpoints.list();

  console.log(result);
}

run();
```

### Standalone function

The standalone function version of this method:

```typescript
import { OpenRouterManagementCore } from "@openrouter-monorepo/management-sdk-generated/core.js";
import { privateEndpointsList } from "@openrouter-monorepo/management-sdk-generated/funcs/private-endpoints-list.js";

// Use `OpenRouterManagementCore` for best tree-shaking performance.
// You can create one instance of it to use across an application.
const openRouterManagement = new OpenRouterManagementCore({
  bearerAuth: "<YOUR_BEARER_TOKEN_HERE>",
});

async function run() {
  const res = await privateEndpointsList(openRouterManagement);
  if (res.ok) {
    const { value: result } = res;
    console.log(result);
  } else {
    console.log("privateEndpointsList failed:", res.error);
  }
}

run();
```

### Parameters

| Parameter                                                                                                                                                                      | Type                                                                                                                                                                           | Required                                                                                                                                                                       | Description                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `options`                                                                                                                                                                      | RequestOptions                                                                                                                                                                 | :heavy_minus_sign:                                                                                                                                                             | Used to set various options for making HTTP requests.                                                                                                                          |
| `options.fetchOptions`                                                                                                                                                         | [RequestInit](https://developer.mozilla.org/en-US/docs/Web/API/Request/Request#options)                                                                                        | :heavy_minus_sign:                                                                                                                                                             | Options that are passed to the underlying HTTP request. This can be used to inject extra headers for examples. All `Request` options, except `method` and `body`, are allowed. |
| `options.retries`                                                                                                                                                              | [RetryConfig](../../lib/utils/retryconfig.md)                                                                                                                                  | :heavy_minus_sign:                                                                                                                                                             | Enables retrying HTTP requests under certain failure conditions.                                                                                                               |

### Response

**Promise\<[models.ListPrivateEndpointsResponse](../../models/list-private-endpoints-response.md)\>**

### Errors

| Error Type                              | Status Code                             | Content Type                            |
| --------------------------------------- | --------------------------------------- | --------------------------------------- |
| errors.UnauthorizedResponseError        | 401                                     | application/json                        |
| errors.ForbiddenResponseError           | 403                                     | application/json                        |
| errors.RequestTimeoutResponseError      | 408                                     | application/json                        |
| errors.InternalServerResponseError      | 500                                     | application/json                        |
| errors.OpenRouterManagementDefaultError | 4XX, 5XX                                | \*/\*                                   |

## create

Create a private endpoint as a draft. Drafts are not routable: validate one with `POST /private-endpoints/{id}/validate`, then activate it with `POST /private-endpoints/{id}/activate`. Pass `activate` to do all three in one call; if validation fails the draft is kept and returned with the failed checks. Send an `Idempotency-Key` header to make retries safe: a repeated key with the same request returns the endpoint the first request created; reusing it with different fields returns 422 `idempotency_key_reused`. [Management key](/docs/guides/overview/auth/management-api-keys) required.

### Example Usage

<!-- UsageSnippet language="typescript" operationID="createPrivateEndpoint" method="post" path="/private-endpoints" -->
```typescript
import { OpenRouterManagement } from "@openrouter-monorepo/management-sdk-generated";

const openRouterManagement = new OpenRouterManagement({
  bearerAuth: "<YOUR_BEARER_TOKEN_HERE>",
});

async function run() {
  const result = await openRouterManagement.privateEndpoints.create({
    idempotencyKey: "wayfair-gpt-4o-eastus-2026-09",
    body: {
      modelPermaslug: "openai/gpt-4o-2024-08-06",
      providerSlug: "azure",
      baseUrl: "https://contoso.openai.azure.com",
      upstreamModelId: "gpt-4o-prod",
      declaredRegion: "us",
      pricing: {
        prompt: "0.0000025",
        completion: "0.00001",
      },
      activate: {
        workspaceId: "550e8400-e29b-41d4-a716-446655440000",
      },
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
import { privateEndpointsCreate } from "@openrouter-monorepo/management-sdk-generated/funcs/private-endpoints-create.js";

// Use `OpenRouterManagementCore` for best tree-shaking performance.
// You can create one instance of it to use across an application.
const openRouterManagement = new OpenRouterManagementCore({
  bearerAuth: "<YOUR_BEARER_TOKEN_HERE>",
});

async function run() {
  const res = await privateEndpointsCreate(openRouterManagement, {
    idempotencyKey: "wayfair-gpt-4o-eastus-2026-09",
    body: {
      modelPermaslug: "openai/gpt-4o-2024-08-06",
      providerSlug: "azure",
      baseUrl: "https://contoso.openai.azure.com",
      upstreamModelId: "gpt-4o-prod",
      declaredRegion: "us",
      pricing: {
        prompt: "0.0000025",
        completion: "0.00001",
      },
      activate: {
        workspaceId: "550e8400-e29b-41d4-a716-446655440000",
      },
    },
  });
  if (res.ok) {
    const { value: result } = res;
    console.log(result);
  } else {
    console.log("privateEndpointsCreate failed:", res.error);
  }
}

run();
```

### Parameters

| Parameter                                                                                                                                                                      | Type                                                                                                                                                                           | Required                                                                                                                                                                       | Description                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `request`                                                                                                                                                                      | [operations.CreatePrivateEndpointRequest](../../models/operations/create-private-endpoint-request.md)                                                                          | :heavy_check_mark:                                                                                                                                                             | The request object to use for the request.                                                                                                                                     |
| `options`                                                                                                                                                                      | RequestOptions                                                                                                                                                                 | :heavy_minus_sign:                                                                                                                                                             | Used to set various options for making HTTP requests.                                                                                                                          |
| `options.fetchOptions`                                                                                                                                                         | [RequestInit](https://developer.mozilla.org/en-US/docs/Web/API/Request/Request#options)                                                                                        | :heavy_minus_sign:                                                                                                                                                             | Options that are passed to the underlying HTTP request. This can be used to inject extra headers for examples. All `Request` options, except `method` and `body`, are allowed. |
| `options.retries`                                                                                                                                                              | [RetryConfig](../../lib/utils/retryconfig.md)                                                                                                                                  | :heavy_minus_sign:                                                                                                                                                             | Enables retrying HTTP requests under certain failure conditions.                                                                                                               |

### Response

**Promise\<[models.ManagedPrivateEndpointResponse](../../models/managed-private-endpoint-response.md)\>**

### Errors

| Error Type                                                | Status Code                                               | Content Type                                              |
| --------------------------------------------------------- | --------------------------------------------------------- | --------------------------------------------------------- |
| errors.BadRequestResponseError                            | 400                                                       | application/json                                          |
| errors.UnauthorizedResponseError                          | 401                                                       | application/json                                          |
| errors.ForbiddenResponseError                             | 403                                                       | application/json                                          |
| errors.CreatePrivateEndpointValidationFailedResponseError | 404                                                       | application/json                                          |
| errors.NotFoundResponseError                              | 404                                                       | application/json                                          |
| errors.RequestTimeoutResponseError                        | 408                                                       | application/json                                          |
| errors.CreatePrivateEndpointValidationFailedResponseError | 409                                                       | application/json                                          |
| errors.ConflictResponseError                              | 409                                                       | application/json                                          |
| errors.CreatePrivateEndpointValidationFailedResponseError | 422                                                       | application/json                                          |
| errors.UnprocessableEntityResponseError                   | 422                                                       | application/json                                          |
| errors.CreatePrivateEndpointValidationFailedResponseError | 500                                                       | application/json                                          |
| errors.InternalServerResponseError                        | 500                                                       | application/json                                          |
| errors.CreatePrivateEndpointValidationFailedResponseError | 502                                                       | application/json                                          |
| errors.BadGatewayResponseError                            | 502                                                       | application/json                                          |
| errors.OpenRouterManagementDefaultError                   | 4XX, 5XX                                                  | \*/\*                                                     |

## get

Get one private endpoint with its upstream configuration and current pricing. [Management key](/docs/guides/overview/auth/management-api-keys) required.

### Example Usage

<!-- UsageSnippet language="typescript" operationID="getPrivateEndpoint" method="get" path="/private-endpoints/{id}" -->
```typescript
import { OpenRouterManagement } from "@openrouter-monorepo/management-sdk-generated";

const openRouterManagement = new OpenRouterManagement({
  bearerAuth: "<YOUR_BEARER_TOKEN_HERE>",
});

async function run() {
  const result = await openRouterManagement.privateEndpoints.get({
    id: "5b1c4c4e-7d0a-4a8e-9f3a-2d6c1b0e8a11",
  });

  console.log(result);
}

run();
```

### Standalone function

The standalone function version of this method:

```typescript
import { OpenRouterManagementCore } from "@openrouter-monorepo/management-sdk-generated/core.js";
import { privateEndpointsGet } from "@openrouter-monorepo/management-sdk-generated/funcs/private-endpoints-get.js";

// Use `OpenRouterManagementCore` for best tree-shaking performance.
// You can create one instance of it to use across an application.
const openRouterManagement = new OpenRouterManagementCore({
  bearerAuth: "<YOUR_BEARER_TOKEN_HERE>",
});

async function run() {
  const res = await privateEndpointsGet(openRouterManagement, {
    id: "5b1c4c4e-7d0a-4a8e-9f3a-2d6c1b0e8a11",
  });
  if (res.ok) {
    const { value: result } = res;
    console.log(result);
  } else {
    console.log("privateEndpointsGet failed:", res.error);
  }
}

run();
```

### Parameters

| Parameter                                                                                                                                                                      | Type                                                                                                                                                                           | Required                                                                                                                                                                       | Description                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `request`                                                                                                                                                                      | [operations.GetPrivateEndpointRequest](../../models/operations/get-private-endpoint-request.md)                                                                                | :heavy_check_mark:                                                                                                                                                             | The request object to use for the request.                                                                                                                                     |
| `options`                                                                                                                                                                      | RequestOptions                                                                                                                                                                 | :heavy_minus_sign:                                                                                                                                                             | Used to set various options for making HTTP requests.                                                                                                                          |
| `options.fetchOptions`                                                                                                                                                         | [RequestInit](https://developer.mozilla.org/en-US/docs/Web/API/Request/Request#options)                                                                                        | :heavy_minus_sign:                                                                                                                                                             | Options that are passed to the underlying HTTP request. This can be used to inject extra headers for examples. All `Request` options, except `method` and `body`, are allowed. |
| `options.retries`                                                                                                                                                              | [RetryConfig](../../lib/utils/retryconfig.md)                                                                                                                                  | :heavy_minus_sign:                                                                                                                                                             | Enables retrying HTTP requests under certain failure conditions.                                                                                                               |

### Response

**Promise\<[models.PrivateEndpointResponse](../../models/private-endpoint-response.md)\>**

### Errors

| Error Type                              | Status Code                             | Content Type                            |
| --------------------------------------- | --------------------------------------- | --------------------------------------- |
| errors.UnauthorizedResponseError        | 401                                     | application/json                        |
| errors.ForbiddenResponseError           | 403                                     | application/json                        |
| errors.NotFoundResponseError            | 404                                     | application/json                        |
| errors.RequestTimeoutResponseError      | 408                                     | application/json                        |
| errors.InternalServerResponseError      | 500                                     | application/json                        |
| errors.OpenRouterManagementDefaultError | 4XX, 5XX                                | \*/\*                                   |

## update

Replace a draft endpoint's upstream configuration: send `upstream_model_id`, and `base_url` to change it (an omitted `base_url` keeps the stored one). Omitted data-policy declarations are kept while the upstream is unchanged and cleared when it changes. Any change clears earlier validation. Active endpoints return 409; delete and re-create them instead. [Management key](/docs/guides/overview/auth/management-api-keys) required.

### Example Usage

<!-- UsageSnippet language="typescript" operationID="updatePrivateEndpoint" method="patch" path="/private-endpoints/{id}" -->
```typescript
import { OpenRouterManagement } from "@openrouter-monorepo/management-sdk-generated";

const openRouterManagement = new OpenRouterManagement({
  bearerAuth: "<YOUR_BEARER_TOKEN_HERE>",
});

async function run() {
  const result = await openRouterManagement.privateEndpoints.update({
    id: "5b1c4c4e-7d0a-4a8e-9f3a-2d6c1b0e8a11",
    body: {
      baseUrl: "https://contoso.openai.azure.com",
      upstreamModelId: "gpt-4o-prod",
      declaredRegion: "us",
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
import { privateEndpointsUpdate } from "@openrouter-monorepo/management-sdk-generated/funcs/private-endpoints-update.js";

// Use `OpenRouterManagementCore` for best tree-shaking performance.
// You can create one instance of it to use across an application.
const openRouterManagement = new OpenRouterManagementCore({
  bearerAuth: "<YOUR_BEARER_TOKEN_HERE>",
});

async function run() {
  const res = await privateEndpointsUpdate(openRouterManagement, {
    id: "5b1c4c4e-7d0a-4a8e-9f3a-2d6c1b0e8a11",
    body: {
      baseUrl: "https://contoso.openai.azure.com",
      upstreamModelId: "gpt-4o-prod",
      declaredRegion: "us",
    },
  });
  if (res.ok) {
    const { value: result } = res;
    console.log(result);
  } else {
    console.log("privateEndpointsUpdate failed:", res.error);
  }
}

run();
```

### Parameters

| Parameter                                                                                                                                                                      | Type                                                                                                                                                                           | Required                                                                                                                                                                       | Description                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `request`                                                                                                                                                                      | [operations.UpdatePrivateEndpointRequest](../../models/operations/update-private-endpoint-request.md)                                                                          | :heavy_check_mark:                                                                                                                                                             | The request object to use for the request.                                                                                                                                     |
| `options`                                                                                                                                                                      | RequestOptions                                                                                                                                                                 | :heavy_minus_sign:                                                                                                                                                             | Used to set various options for making HTTP requests.                                                                                                                          |
| `options.fetchOptions`                                                                                                                                                         | [RequestInit](https://developer.mozilla.org/en-US/docs/Web/API/Request/Request#options)                                                                                        | :heavy_minus_sign:                                                                                                                                                             | Options that are passed to the underlying HTTP request. This can be used to inject extra headers for examples. All `Request` options, except `method` and `body`, are allowed. |
| `options.retries`                                                                                                                                                              | [RetryConfig](../../lib/utils/retryconfig.md)                                                                                                                                  | :heavy_minus_sign:                                                                                                                                                             | Enables retrying HTTP requests under certain failure conditions.                                                                                                               |

### Response

**Promise\<[models.PrivateEndpointResponse](../../models/private-endpoint-response.md)\>**

### Errors

| Error Type                              | Status Code                             | Content Type                            |
| --------------------------------------- | --------------------------------------- | --------------------------------------- |
| errors.BadRequestResponseError          | 400                                     | application/json                        |
| errors.UnauthorizedResponseError        | 401                                     | application/json                        |
| errors.ForbiddenResponseError           | 403                                     | application/json                        |
| errors.NotFoundResponseError            | 404                                     | application/json                        |
| errors.RequestTimeoutResponseError      | 408                                     | application/json                        |
| errors.ConflictResponseError            | 409                                     | application/json                        |
| errors.UnprocessableEntityResponseError | 422                                     | application/json                        |
| errors.InternalServerResponseError      | 500                                     | application/json                        |
| errors.BadGatewayResponseError          | 502                                     | application/json                        |
| errors.OpenRouterManagementDefaultError | 4XX, 5XX                                | \*/\*                                   |

## delete

Delete a private endpoint and stop routing to it. Pass `draft_only=true` to refuse (409) when the endpoint has been activated. [Management key](/docs/guides/overview/auth/management-api-keys) required.

### Example Usage

<!-- UsageSnippet language="typescript" operationID="deletePrivateEndpoint" method="delete" path="/private-endpoints/{id}" -->
```typescript
import { OpenRouterManagement } from "@openrouter-monorepo/management-sdk-generated";

const openRouterManagement = new OpenRouterManagement({
  bearerAuth: "<YOUR_BEARER_TOKEN_HERE>",
});

async function run() {
  const result = await openRouterManagement.privateEndpoints.delete({
    id: "5b1c4c4e-7d0a-4a8e-9f3a-2d6c1b0e8a11",
  });

  console.log(result);
}

run();
```

### Standalone function

The standalone function version of this method:

```typescript
import { OpenRouterManagementCore } from "@openrouter-monorepo/management-sdk-generated/core.js";
import { privateEndpointsDelete } from "@openrouter-monorepo/management-sdk-generated/funcs/private-endpoints-delete.js";

// Use `OpenRouterManagementCore` for best tree-shaking performance.
// You can create one instance of it to use across an application.
const openRouterManagement = new OpenRouterManagementCore({
  bearerAuth: "<YOUR_BEARER_TOKEN_HERE>",
});

async function run() {
  const res = await privateEndpointsDelete(openRouterManagement, {
    id: "5b1c4c4e-7d0a-4a8e-9f3a-2d6c1b0e8a11",
  });
  if (res.ok) {
    const { value: result } = res;
    console.log(result);
  } else {
    console.log("privateEndpointsDelete failed:", res.error);
  }
}

run();
```

### Parameters

| Parameter                                                                                                                                                                      | Type                                                                                                                                                                           | Required                                                                                                                                                                       | Description                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `request`                                                                                                                                                                      | [operations.DeletePrivateEndpointRequest](../../models/operations/delete-private-endpoint-request.md)                                                                          | :heavy_check_mark:                                                                                                                                                             | The request object to use for the request.                                                                                                                                     |
| `options`                                                                                                                                                                      | RequestOptions                                                                                                                                                                 | :heavy_minus_sign:                                                                                                                                                             | Used to set various options for making HTTP requests.                                                                                                                          |
| `options.fetchOptions`                                                                                                                                                         | [RequestInit](https://developer.mozilla.org/en-US/docs/Web/API/Request/Request#options)                                                                                        | :heavy_minus_sign:                                                                                                                                                             | Options that are passed to the underlying HTTP request. This can be used to inject extra headers for examples. All `Request` options, except `method` and `body`, are allowed. |
| `options.retries`                                                                                                                                                              | [RetryConfig](../../lib/utils/retryconfig.md)                                                                                                                                  | :heavy_minus_sign:                                                                                                                                                             | Enables retrying HTTP requests under certain failure conditions.                                                                                                               |

### Response

**Promise\<[models.DeletePrivateEndpointResponse](../../models/delete-private-endpoint-response.md)\>**

### Errors

| Error Type                              | Status Code                             | Content Type                            |
| --------------------------------------- | --------------------------------------- | --------------------------------------- |
| errors.BadRequestResponseError          | 400                                     | application/json                        |
| errors.UnauthorizedResponseError        | 401                                     | application/json                        |
| errors.ForbiddenResponseError           | 403                                     | application/json                        |
| errors.NotFoundResponseError            | 404                                     | application/json                        |
| errors.RequestTimeoutResponseError      | 408                                     | application/json                        |
| errors.ConflictResponseError            | 409                                     | application/json                        |
| errors.UnprocessableEntityResponseError | 422                                     | application/json                        |
| errors.InternalServerResponseError      | 500                                     | application/json                        |
| errors.BadGatewayResponseError          | 502                                     | application/json                        |
| errors.OpenRouterManagementDefaultError | 4XX, 5XX                                | \*/\*                                   |

## activate

Make a validated draft routable. Returns 409 when the endpoint was never validated, the validation is stale, or it is already active. [Management key](/docs/guides/overview/auth/management-api-keys) required.

### Example Usage

<!-- UsageSnippet language="typescript" operationID="activatePrivateEndpoint" method="post" path="/private-endpoints/{id}/activate" -->
```typescript
import { OpenRouterManagement } from "@openrouter-monorepo/management-sdk-generated";

const openRouterManagement = new OpenRouterManagement({
  bearerAuth: "<YOUR_BEARER_TOKEN_HERE>",
});

async function run() {
  const result = await openRouterManagement.privateEndpoints.activate({
    id: "5b1c4c4e-7d0a-4a8e-9f3a-2d6c1b0e8a11",
  });

  console.log(result);
}

run();
```

### Standalone function

The standalone function version of this method:

```typescript
import { OpenRouterManagementCore } from "@openrouter-monorepo/management-sdk-generated/core.js";
import { privateEndpointsActivate } from "@openrouter-monorepo/management-sdk-generated/funcs/private-endpoints-activate.js";

// Use `OpenRouterManagementCore` for best tree-shaking performance.
// You can create one instance of it to use across an application.
const openRouterManagement = new OpenRouterManagementCore({
  bearerAuth: "<YOUR_BEARER_TOKEN_HERE>",
});

async function run() {
  const res = await privateEndpointsActivate(openRouterManagement, {
    id: "5b1c4c4e-7d0a-4a8e-9f3a-2d6c1b0e8a11",
  });
  if (res.ok) {
    const { value: result } = res;
    console.log(result);
  } else {
    console.log("privateEndpointsActivate failed:", res.error);
  }
}

run();
```

### Parameters

| Parameter                                                                                                                                                                      | Type                                                                                                                                                                           | Required                                                                                                                                                                       | Description                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `request`                                                                                                                                                                      | [operations.ActivatePrivateEndpointRequest](../../models/operations/activate-private-endpoint-request.md)                                                                      | :heavy_check_mark:                                                                                                                                                             | The request object to use for the request.                                                                                                                                     |
| `options`                                                                                                                                                                      | RequestOptions                                                                                                                                                                 | :heavy_minus_sign:                                                                                                                                                             | Used to set various options for making HTTP requests.                                                                                                                          |
| `options.fetchOptions`                                                                                                                                                         | [RequestInit](https://developer.mozilla.org/en-US/docs/Web/API/Request/Request#options)                                                                                        | :heavy_minus_sign:                                                                                                                                                             | Options that are passed to the underlying HTTP request. This can be used to inject extra headers for examples. All `Request` options, except `method` and `body`, are allowed. |
| `options.retries`                                                                                                                                                              | [RetryConfig](../../lib/utils/retryconfig.md)                                                                                                                                  | :heavy_minus_sign:                                                                                                                                                             | Enables retrying HTTP requests under certain failure conditions.                                                                                                               |

### Response

**Promise\<[models.ManagedPrivateEndpointResponse](../../models/managed-private-endpoint-response.md)\>**

### Errors

| Error Type                              | Status Code                             | Content Type                            |
| --------------------------------------- | --------------------------------------- | --------------------------------------- |
| errors.BadRequestResponseError          | 400                                     | application/json                        |
| errors.UnauthorizedResponseError        | 401                                     | application/json                        |
| errors.ForbiddenResponseError           | 403                                     | application/json                        |
| errors.NotFoundResponseError            | 404                                     | application/json                        |
| errors.RequestTimeoutResponseError      | 408                                     | application/json                        |
| errors.ConflictResponseError            | 409                                     | application/json                        |
| errors.UnprocessableEntityResponseError | 422                                     | application/json                        |
| errors.InternalServerResponseError      | 500                                     | application/json                        |
| errors.BadGatewayResponseError          | 502                                     | application/json                        |
| errors.OpenRouterManagementDefaultError | 4XX, 5XX                                | \*/\*                                   |

## disable

Stop routing to an active endpoint without deleting it. [Management key](/docs/guides/overview/auth/management-api-keys) required.

### Example Usage

<!-- UsageSnippet language="typescript" operationID="disablePrivateEndpoint" method="post" path="/private-endpoints/{id}/disable" -->
```typescript
import { OpenRouterManagement } from "@openrouter-monorepo/management-sdk-generated";

const openRouterManagement = new OpenRouterManagement({
  bearerAuth: "<YOUR_BEARER_TOKEN_HERE>",
});

async function run() {
  const result = await openRouterManagement.privateEndpoints.disable({
    id: "5b1c4c4e-7d0a-4a8e-9f3a-2d6c1b0e8a11",
  });

  console.log(result);
}

run();
```

### Standalone function

The standalone function version of this method:

```typescript
import { OpenRouterManagementCore } from "@openrouter-monorepo/management-sdk-generated/core.js";
import { privateEndpointsDisable } from "@openrouter-monorepo/management-sdk-generated/funcs/private-endpoints-disable.js";

// Use `OpenRouterManagementCore` for best tree-shaking performance.
// You can create one instance of it to use across an application.
const openRouterManagement = new OpenRouterManagementCore({
  bearerAuth: "<YOUR_BEARER_TOKEN_HERE>",
});

async function run() {
  const res = await privateEndpointsDisable(openRouterManagement, {
    id: "5b1c4c4e-7d0a-4a8e-9f3a-2d6c1b0e8a11",
  });
  if (res.ok) {
    const { value: result } = res;
    console.log(result);
  } else {
    console.log("privateEndpointsDisable failed:", res.error);
  }
}

run();
```

### Parameters

| Parameter                                                                                                                                                                      | Type                                                                                                                                                                           | Required                                                                                                                                                                       | Description                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `request`                                                                                                                                                                      | [operations.DisablePrivateEndpointRequest](../../models/operations/disable-private-endpoint-request.md)                                                                        | :heavy_check_mark:                                                                                                                                                             | The request object to use for the request.                                                                                                                                     |
| `options`                                                                                                                                                                      | RequestOptions                                                                                                                                                                 | :heavy_minus_sign:                                                                                                                                                             | Used to set various options for making HTTP requests.                                                                                                                          |
| `options.fetchOptions`                                                                                                                                                         | [RequestInit](https://developer.mozilla.org/en-US/docs/Web/API/Request/Request#options)                                                                                        | :heavy_minus_sign:                                                                                                                                                             | Options that are passed to the underlying HTTP request. This can be used to inject extra headers for examples. All `Request` options, except `method` and `body`, are allowed. |
| `options.retries`                                                                                                                                                              | [RetryConfig](../../lib/utils/retryconfig.md)                                                                                                                                  | :heavy_minus_sign:                                                                                                                                                             | Enables retrying HTTP requests under certain failure conditions.                                                                                                               |

### Response

**Promise\<[models.ManagedPrivateEndpointResponse](../../models/managed-private-endpoint-response.md)\>**

### Errors

| Error Type                              | Status Code                             | Content Type                            |
| --------------------------------------- | --------------------------------------- | --------------------------------------- |
| errors.BadRequestResponseError          | 400                                     | application/json                        |
| errors.UnauthorizedResponseError        | 401                                     | application/json                        |
| errors.ForbiddenResponseError           | 403                                     | application/json                        |
| errors.NotFoundResponseError            | 404                                     | application/json                        |
| errors.RequestTimeoutResponseError      | 408                                     | application/json                        |
| errors.ConflictResponseError            | 409                                     | application/json                        |
| errors.UnprocessableEntityResponseError | 422                                     | application/json                        |
| errors.InternalServerResponseError      | 500                                     | application/json                        |
| errors.BadGatewayResponseError          | 502                                     | application/json                        |
| errors.OpenRouterManagementDefaultError | 4XX, 5XX                                | \*/\*                                   |

## enable

Resume routing to a disabled endpoint. [Management key](/docs/guides/overview/auth/management-api-keys) required.

### Example Usage

<!-- UsageSnippet language="typescript" operationID="enablePrivateEndpoint" method="post" path="/private-endpoints/{id}/enable" -->
```typescript
import { OpenRouterManagement } from "@openrouter-monorepo/management-sdk-generated";

const openRouterManagement = new OpenRouterManagement({
  bearerAuth: "<YOUR_BEARER_TOKEN_HERE>",
});

async function run() {
  const result = await openRouterManagement.privateEndpoints.enable({
    id: "5b1c4c4e-7d0a-4a8e-9f3a-2d6c1b0e8a11",
  });

  console.log(result);
}

run();
```

### Standalone function

The standalone function version of this method:

```typescript
import { OpenRouterManagementCore } from "@openrouter-monorepo/management-sdk-generated/core.js";
import { privateEndpointsEnable } from "@openrouter-monorepo/management-sdk-generated/funcs/private-endpoints-enable.js";

// Use `OpenRouterManagementCore` for best tree-shaking performance.
// You can create one instance of it to use across an application.
const openRouterManagement = new OpenRouterManagementCore({
  bearerAuth: "<YOUR_BEARER_TOKEN_HERE>",
});

async function run() {
  const res = await privateEndpointsEnable(openRouterManagement, {
    id: "5b1c4c4e-7d0a-4a8e-9f3a-2d6c1b0e8a11",
  });
  if (res.ok) {
    const { value: result } = res;
    console.log(result);
  } else {
    console.log("privateEndpointsEnable failed:", res.error);
  }
}

run();
```

### Parameters

| Parameter                                                                                                                                                                      | Type                                                                                                                                                                           | Required                                                                                                                                                                       | Description                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `request`                                                                                                                                                                      | [operations.EnablePrivateEndpointRequest](../../models/operations/enable-private-endpoint-request.md)                                                                          | :heavy_check_mark:                                                                                                                                                             | The request object to use for the request.                                                                                                                                     |
| `options`                                                                                                                                                                      | RequestOptions                                                                                                                                                                 | :heavy_minus_sign:                                                                                                                                                             | Used to set various options for making HTTP requests.                                                                                                                          |
| `options.fetchOptions`                                                                                                                                                         | [RequestInit](https://developer.mozilla.org/en-US/docs/Web/API/Request/Request#options)                                                                                        | :heavy_minus_sign:                                                                                                                                                             | Options that are passed to the underlying HTTP request. This can be used to inject extra headers for examples. All `Request` options, except `method` and `body`, are allowed. |
| `options.retries`                                                                                                                                                              | [RetryConfig](../../lib/utils/retryconfig.md)                                                                                                                                  | :heavy_minus_sign:                                                                                                                                                             | Enables retrying HTTP requests under certain failure conditions.                                                                                                               |

### Response

**Promise\<[models.ManagedPrivateEndpointResponse](../../models/managed-private-endpoint-response.md)\>**

### Errors

| Error Type                              | Status Code                             | Content Type                            |
| --------------------------------------- | --------------------------------------- | --------------------------------------- |
| errors.BadRequestResponseError          | 400                                     | application/json                        |
| errors.UnauthorizedResponseError        | 401                                     | application/json                        |
| errors.ForbiddenResponseError           | 403                                     | application/json                        |
| errors.NotFoundResponseError            | 404                                     | application/json                        |
| errors.RequestTimeoutResponseError      | 408                                     | application/json                        |
| errors.ConflictResponseError            | 409                                     | application/json                        |
| errors.UnprocessableEntityResponseError | 422                                     | application/json                        |
| errors.InternalServerResponseError      | 500                                     | application/json                        |
| errors.BadGatewayResponseError          | 502                                     | application/json                        |
| errors.OpenRouterManagementDefaultError | 4XX, 5XX                                | \*/\*                                   |

## updatePricing

Set the negotiated per-token rates reported for requests routed to this endpoint. Applies to drafts and active endpoints; new rates take effect for subsequent requests. [Management key](/docs/guides/overview/auth/management-api-keys) required.

### Example Usage

<!-- UsageSnippet language="typescript" operationID="updatePrivateEndpointPricing" method="put" path="/private-endpoints/{id}/pricing" -->
```typescript
import { OpenRouterManagement } from "@openrouter-monorepo/management-sdk-generated";

const openRouterManagement = new OpenRouterManagement({
  bearerAuth: "<YOUR_BEARER_TOKEN_HERE>",
});

async function run() {
  const result = await openRouterManagement.privateEndpoints.updatePricing({
    id: "5b1c4c4e-7d0a-4a8e-9f3a-2d6c1b0e8a11",
    body: {
      pricing: {
        prompt: "0.0000025",
        completion: "0.00001",
      },
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
import { privateEndpointsUpdatePricing } from "@openrouter-monorepo/management-sdk-generated/funcs/private-endpoints-update-pricing.js";

// Use `OpenRouterManagementCore` for best tree-shaking performance.
// You can create one instance of it to use across an application.
const openRouterManagement = new OpenRouterManagementCore({
  bearerAuth: "<YOUR_BEARER_TOKEN_HERE>",
});

async function run() {
  const res = await privateEndpointsUpdatePricing(openRouterManagement, {
    id: "5b1c4c4e-7d0a-4a8e-9f3a-2d6c1b0e8a11",
    body: {
      pricing: {
        prompt: "0.0000025",
        completion: "0.00001",
      },
    },
  });
  if (res.ok) {
    const { value: result } = res;
    console.log(result);
  } else {
    console.log("privateEndpointsUpdatePricing failed:", res.error);
  }
}

run();
```

### Parameters

| Parameter                                                                                                                                                                      | Type                                                                                                                                                                           | Required                                                                                                                                                                       | Description                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `request`                                                                                                                                                                      | [operations.UpdatePrivateEndpointPricingRequest](../../models/operations/update-private-endpoint-pricing-request.md)                                                           | :heavy_check_mark:                                                                                                                                                             | The request object to use for the request.                                                                                                                                     |
| `options`                                                                                                                                                                      | RequestOptions                                                                                                                                                                 | :heavy_minus_sign:                                                                                                                                                             | Used to set various options for making HTTP requests.                                                                                                                          |
| `options.fetchOptions`                                                                                                                                                         | [RequestInit](https://developer.mozilla.org/en-US/docs/Web/API/Request/Request#options)                                                                                        | :heavy_minus_sign:                                                                                                                                                             | Options that are passed to the underlying HTTP request. This can be used to inject extra headers for examples. All `Request` options, except `method` and `body`, are allowed. |
| `options.retries`                                                                                                                                                              | [RetryConfig](../../lib/utils/retryconfig.md)                                                                                                                                  | :heavy_minus_sign:                                                                                                                                                             | Enables retrying HTTP requests under certain failure conditions.                                                                                                               |

### Response

**Promise\<[models.PrivateEndpointResponse](../../models/private-endpoint-response.md)\>**

### Errors

| Error Type                              | Status Code                             | Content Type                            |
| --------------------------------------- | --------------------------------------- | --------------------------------------- |
| errors.BadRequestResponseError          | 400                                     | application/json                        |
| errors.UnauthorizedResponseError        | 401                                     | application/json                        |
| errors.ForbiddenResponseError           | 403                                     | application/json                        |
| errors.NotFoundResponseError            | 404                                     | application/json                        |
| errors.RequestTimeoutResponseError      | 408                                     | application/json                        |
| errors.ConflictResponseError            | 409                                     | application/json                        |
| errors.UnprocessableEntityResponseError | 422                                     | application/json                        |
| errors.InternalServerResponseError      | 500                                     | application/json                        |
| errors.BadGatewayResponseError          | 502                                     | application/json                        |
| errors.OpenRouterManagementDefaultError | 4XX, 5XX                                | \*/\*                                   |

## validate

Send a live test request to the draft endpoint using the given workspace's BYOK credential for its provider. A passing validation is required before activation. Failed checks return 200 with `passed: false`. [Management key](/docs/guides/overview/auth/management-api-keys) required.

### Example Usage

<!-- UsageSnippet language="typescript" operationID="validatePrivateEndpoint" method="post" path="/private-endpoints/{id}/validate" -->
```typescript
import { OpenRouterManagement } from "@openrouter-monorepo/management-sdk-generated";

const openRouterManagement = new OpenRouterManagement({
  bearerAuth: "<YOUR_BEARER_TOKEN_HERE>",
});

async function run() {
  const result = await openRouterManagement.privateEndpoints.validate({
    id: "5b1c4c4e-7d0a-4a8e-9f3a-2d6c1b0e8a11",
    body: {
      workspaceId: "550e8400-e29b-41d4-a716-446655440000",
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
import { privateEndpointsValidate } from "@openrouter-monorepo/management-sdk-generated/funcs/private-endpoints-validate.js";

// Use `OpenRouterManagementCore` for best tree-shaking performance.
// You can create one instance of it to use across an application.
const openRouterManagement = new OpenRouterManagementCore({
  bearerAuth: "<YOUR_BEARER_TOKEN_HERE>",
});

async function run() {
  const res = await privateEndpointsValidate(openRouterManagement, {
    id: "5b1c4c4e-7d0a-4a8e-9f3a-2d6c1b0e8a11",
    body: {
      workspaceId: "550e8400-e29b-41d4-a716-446655440000",
    },
  });
  if (res.ok) {
    const { value: result } = res;
    console.log(result);
  } else {
    console.log("privateEndpointsValidate failed:", res.error);
  }
}

run();
```

### Parameters

| Parameter                                                                                                                                                                      | Type                                                                                                                                                                           | Required                                                                                                                                                                       | Description                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `request`                                                                                                                                                                      | [operations.ValidatePrivateEndpointRequest](../../models/operations/validate-private-endpoint-request.md)                                                                      | :heavy_check_mark:                                                                                                                                                             | The request object to use for the request.                                                                                                                                     |
| `options`                                                                                                                                                                      | RequestOptions                                                                                                                                                                 | :heavy_minus_sign:                                                                                                                                                             | Used to set various options for making HTTP requests.                                                                                                                          |
| `options.fetchOptions`                                                                                                                                                         | [RequestInit](https://developer.mozilla.org/en-US/docs/Web/API/Request/Request#options)                                                                                        | :heavy_minus_sign:                                                                                                                                                             | Options that are passed to the underlying HTTP request. This can be used to inject extra headers for examples. All `Request` options, except `method` and `body`, are allowed. |
| `options.retries`                                                                                                                                                              | [RetryConfig](../../lib/utils/retryconfig.md)                                                                                                                                  | :heavy_minus_sign:                                                                                                                                                             | Enables retrying HTTP requests under certain failure conditions.                                                                                                               |

### Response

**Promise\<[models.PrivateEndpointValidationResponse](../../models/private-endpoint-validation-response.md)\>**

### Errors

| Error Type                              | Status Code                             | Content Type                            |
| --------------------------------------- | --------------------------------------- | --------------------------------------- |
| errors.BadRequestResponseError          | 400                                     | application/json                        |
| errors.UnauthorizedResponseError        | 401                                     | application/json                        |
| errors.ForbiddenResponseError           | 403                                     | application/json                        |
| errors.NotFoundResponseError            | 404                                     | application/json                        |
| errors.RequestTimeoutResponseError      | 408                                     | application/json                        |
| errors.ConflictResponseError            | 409                                     | application/json                        |
| errors.UnprocessableEntityResponseError | 422                                     | application/json                        |
| errors.InternalServerResponseError      | 500                                     | application/json                        |
| errors.BadGatewayResponseError          | 502                                     | application/json                        |
| errors.OpenRouterManagementDefaultError | 4XX, 5XX                                | \*/\*                                   |