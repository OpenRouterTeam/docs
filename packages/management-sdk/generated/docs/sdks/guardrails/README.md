# Guardrails

## Overview

### Available Operations

* [list](#list) - List guardrails
* [create](#create) - Create a guardrail
* [listKeyAssignments](#listkeyassignments) - List all key assignments
* [listMemberAssignments](#listmemberassignments) - List all member assignments
* [get](#get) - Get a guardrail
* [update](#update) - Update a guardrail
* [delete](#delete) - Delete a guardrail
* [listGuardrailKeyAssignments](#listguardrailkeyassignments) - List key assignments for a guardrail
* [bulkAssignKeys](#bulkassignkeys) - Bulk assign keys to a guardrail
* [bulkUnassignKeys](#bulkunassignkeys) - Bulk unassign keys from a guardrail
* [listGuardrailMemberAssignments](#listguardrailmemberassignments) - List member assignments for a guardrail
* [bulkAssignMembers](#bulkassignmembers) - Bulk assign members to a guardrail
* [bulkUnassignMembers](#bulkunassignmembers) - Bulk unassign members from a guardrail

## list

List all guardrails for the authenticated user. [Management key](/docs/guides/overview/auth/management-api-keys) required.

### Example Usage

<!-- UsageSnippet language="typescript" operationID="listGuardrails" method="get" path="/guardrails" -->
```typescript
import { OpenRouterManagement } from "@openrouter-monorepo/management-sdk-generated";

const openRouterManagement = new OpenRouterManagement({
  bearerAuth: "<YOUR_BEARER_TOKEN_HERE>",
});

async function run() {
  const result = await openRouterManagement.guardrails.list({
    workspaceId: "0df9e665-d932-5740-b2c7-b52af166bc11",
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
import { guardrailsList } from "@openrouter-monorepo/management-sdk-generated/funcs/guardrails-list.js";

// Use `OpenRouterManagementCore` for best tree-shaking performance.
// You can create one instance of it to use across an application.
const openRouterManagement = new OpenRouterManagementCore({
  bearerAuth: "<YOUR_BEARER_TOKEN_HERE>",
});

async function run() {
  const res = await guardrailsList(openRouterManagement, {
    workspaceId: "0df9e665-d932-5740-b2c7-b52af166bc11",
  });
  if (res.ok) {
    const { value: result } = res;
    for await (const page of result) {
    console.log(page);
  }
  } else {
    console.log("guardrailsList failed:", res.error);
  }
}

run();
```

### Parameters

| Parameter                                                                                                                                                                      | Type                                                                                                                                                                           | Required                                                                                                                                                                       | Description                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `request`                                                                                                                                                                      | [operations.ListGuardrailsRequest](../../models/operations/list-guardrails-request.md)                                                                                         | :heavy_check_mark:                                                                                                                                                             | The request object to use for the request.                                                                                                                                     |
| `options`                                                                                                                                                                      | RequestOptions                                                                                                                                                                 | :heavy_minus_sign:                                                                                                                                                             | Used to set various options for making HTTP requests.                                                                                                                          |
| `options.fetchOptions`                                                                                                                                                         | [RequestInit](https://developer.mozilla.org/en-US/docs/Web/API/Request/Request#options)                                                                                        | :heavy_minus_sign:                                                                                                                                                             | Options that are passed to the underlying HTTP request. This can be used to inject extra headers for examples. All `Request` options, except `method` and `body`, are allowed. |
| `options.retries`                                                                                                                                                              | [RetryConfig](../../lib/utils/retryconfig.md)                                                                                                                                  | :heavy_minus_sign:                                                                                                                                                             | Enables retrying HTTP requests under certain failure conditions.                                                                                                               |

### Response

**Promise\<[operations.ListGuardrailsResponse](../../models/operations/list-guardrails-response.md)\>**

### Errors

| Error Type                              | Status Code                             | Content Type                            |
| --------------------------------------- | --------------------------------------- | --------------------------------------- |
| errors.BadRequestResponseError          | 400                                     | application/json                        |
| errors.UnauthorizedResponseError        | 401                                     | application/json                        |
| errors.InternalServerResponseError      | 500                                     | application/json                        |
| errors.OpenRouterManagementDefaultError | 4XX, 5XX                                | \*/\*                                   |

## create

Create a new guardrail for the authenticated user. A newly created guardrail enforces nothing until it is assigned to API keys or organization members; `workspace_id` places the guardrail in a workspace but does not apply it to that workspace's traffic. To restrict all traffic in a workspace, update the workspace's default guardrail instead. Set `allowed_data_regions` to enforce [In-Region Routing](/docs/guides/features/in-region-routing#enforcing-in-region-routing-with-guardrails): governed requests must arrive through one of the listed OpenRouter domains and are rejected with a 403 otherwise. [Management key](/docs/guides/overview/auth/management-api-keys) required.

### Example Usage

<!-- UsageSnippet language="typescript" operationID="createGuardrail" method="post" path="/guardrails" -->
```typescript
import { OpenRouterManagement } from "@openrouter-monorepo/management-sdk-generated";

const openRouterManagement = new OpenRouterManagement({
  bearerAuth: "<YOUR_BEARER_TOKEN_HERE>",
});

async function run() {
  const result = await openRouterManagement.guardrails.create({
    name: "My New Guardrail",
    description: "A guardrail for limiting API usage",
    limitUsd: 50,
    resetInterval: "monthly",
    allowedProviders: [
      "openai",
      "anthropic",
      "deepseek",
    ],
    ignoredProviders: null,
    allowedModels: null,
    ignoredModels: null,
    allowedDataRegions: [
      "europe",
    ],
    enforceZdrAnthropic: true,
    enforceZdrOpenai: true,
    enforceZdrGoogle: false,
    enforceZdrXai: false,
    enforceZdrOther: false,
  });

  console.log(result);
}

run();
```

### Standalone function

The standalone function version of this method:

```typescript
import { OpenRouterManagementCore } from "@openrouter-monorepo/management-sdk-generated/core.js";
import { guardrailsCreate } from "@openrouter-monorepo/management-sdk-generated/funcs/guardrails-create.js";

// Use `OpenRouterManagementCore` for best tree-shaking performance.
// You can create one instance of it to use across an application.
const openRouterManagement = new OpenRouterManagementCore({
  bearerAuth: "<YOUR_BEARER_TOKEN_HERE>",
});

async function run() {
  const res = await guardrailsCreate(openRouterManagement, {
    name: "My New Guardrail",
    description: "A guardrail for limiting API usage",
    limitUsd: 50,
    resetInterval: "monthly",
    allowedProviders: [
      "openai",
      "anthropic",
      "deepseek",
    ],
    ignoredProviders: null,
    allowedModels: null,
    ignoredModels: null,
    allowedDataRegions: [
      "europe",
    ],
    enforceZdrAnthropic: true,
    enforceZdrOpenai: true,
    enforceZdrGoogle: false,
    enforceZdrXai: false,
    enforceZdrOther: false,
  });
  if (res.ok) {
    const { value: result } = res;
    console.log(result);
  } else {
    console.log("guardrailsCreate failed:", res.error);
  }
}

run();
```

### Parameters

| Parameter                                                                                                                                                                      | Type                                                                                                                                                                           | Required                                                                                                                                                                       | Description                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `request`                                                                                                                                                                      | [models.CreateGuardrailRequest](../../models/create-guardrail-request.md)                                                                                                      | :heavy_check_mark:                                                                                                                                                             | The request object to use for the request.                                                                                                                                     |
| `options`                                                                                                                                                                      | RequestOptions                                                                                                                                                                 | :heavy_minus_sign:                                                                                                                                                             | Used to set various options for making HTTP requests.                                                                                                                          |
| `options.fetchOptions`                                                                                                                                                         | [RequestInit](https://developer.mozilla.org/en-US/docs/Web/API/Request/Request#options)                                                                                        | :heavy_minus_sign:                                                                                                                                                             | Options that are passed to the underlying HTTP request. This can be used to inject extra headers for examples. All `Request` options, except `method` and `body`, are allowed. |
| `options.retries`                                                                                                                                                              | [RetryConfig](../../lib/utils/retryconfig.md)                                                                                                                                  | :heavy_minus_sign:                                                                                                                                                             | Enables retrying HTTP requests under certain failure conditions.                                                                                                               |

### Response

**Promise\<[models.CreateGuardrailResponse](../../models/create-guardrail-response.md)\>**

### Errors

| Error Type                              | Status Code                             | Content Type                            |
| --------------------------------------- | --------------------------------------- | --------------------------------------- |
| errors.BadRequestResponseError          | 400                                     | application/json                        |
| errors.UnauthorizedResponseError        | 401                                     | application/json                        |
| errors.ForbiddenResponseError           | 403                                     | application/json                        |
| errors.InternalServerResponseError      | 500                                     | application/json                        |
| errors.OpenRouterManagementDefaultError | 4XX, 5XX                                | \*/\*                                   |

## listKeyAssignments

List all API key guardrail assignments for the authenticated user. [Management key](/docs/guides/overview/auth/management-api-keys) required.

### Example Usage

<!-- UsageSnippet language="typescript" operationID="listKeyAssignments" method="get" path="/guardrails/assignments/keys" -->
```typescript
import { OpenRouterManagement } from "@openrouter-monorepo/management-sdk-generated";

const openRouterManagement = new OpenRouterManagement({
  bearerAuth: "<YOUR_BEARER_TOKEN_HERE>",
});

async function run() {
  const result = await openRouterManagement.guardrails.listKeyAssignments({});

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
import { guardrailsListKeyAssignments } from "@openrouter-monorepo/management-sdk-generated/funcs/guardrails-list-key-assignments.js";

// Use `OpenRouterManagementCore` for best tree-shaking performance.
// You can create one instance of it to use across an application.
const openRouterManagement = new OpenRouterManagementCore({
  bearerAuth: "<YOUR_BEARER_TOKEN_HERE>",
});

async function run() {
  const res = await guardrailsListKeyAssignments(openRouterManagement, {});
  if (res.ok) {
    const { value: result } = res;
    for await (const page of result) {
    console.log(page);
  }
  } else {
    console.log("guardrailsListKeyAssignments failed:", res.error);
  }
}

run();
```

### Parameters

| Parameter                                                                                                                                                                      | Type                                                                                                                                                                           | Required                                                                                                                                                                       | Description                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `request`                                                                                                                                                                      | [operations.ListKeyAssignmentsRequest](../../models/operations/list-key-assignments-request.md)                                                                                | :heavy_check_mark:                                                                                                                                                             | The request object to use for the request.                                                                                                                                     |
| `options`                                                                                                                                                                      | RequestOptions                                                                                                                                                                 | :heavy_minus_sign:                                                                                                                                                             | Used to set various options for making HTTP requests.                                                                                                                          |
| `options.fetchOptions`                                                                                                                                                         | [RequestInit](https://developer.mozilla.org/en-US/docs/Web/API/Request/Request#options)                                                                                        | :heavy_minus_sign:                                                                                                                                                             | Options that are passed to the underlying HTTP request. This can be used to inject extra headers for examples. All `Request` options, except `method` and `body`, are allowed. |
| `options.retries`                                                                                                                                                              | [RetryConfig](../../lib/utils/retryconfig.md)                                                                                                                                  | :heavy_minus_sign:                                                                                                                                                             | Enables retrying HTTP requests under certain failure conditions.                                                                                                               |

### Response

**Promise\<[operations.ListKeyAssignmentsResponse](../../models/operations/list-key-assignments-response.md)\>**

### Errors

| Error Type                              | Status Code                             | Content Type                            |
| --------------------------------------- | --------------------------------------- | --------------------------------------- |
| errors.UnauthorizedResponseError        | 401                                     | application/json                        |
| errors.InternalServerResponseError      | 500                                     | application/json                        |
| errors.OpenRouterManagementDefaultError | 4XX, 5XX                                | \*/\*                                   |

## listMemberAssignments

List all organization member guardrail assignments for the authenticated user. [Management key](/docs/guides/overview/auth/management-api-keys) required.

### Example Usage

<!-- UsageSnippet language="typescript" operationID="listMemberAssignments" method="get" path="/guardrails/assignments/members" -->
```typescript
import { OpenRouterManagement } from "@openrouter-monorepo/management-sdk-generated";

const openRouterManagement = new OpenRouterManagement({
  bearerAuth: "<YOUR_BEARER_TOKEN_HERE>",
});

async function run() {
  const result = await openRouterManagement.guardrails.listMemberAssignments({});

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
import { guardrailsListMemberAssignments } from "@openrouter-monorepo/management-sdk-generated/funcs/guardrails-list-member-assignments.js";

// Use `OpenRouterManagementCore` for best tree-shaking performance.
// You can create one instance of it to use across an application.
const openRouterManagement = new OpenRouterManagementCore({
  bearerAuth: "<YOUR_BEARER_TOKEN_HERE>",
});

async function run() {
  const res = await guardrailsListMemberAssignments(openRouterManagement, {});
  if (res.ok) {
    const { value: result } = res;
    for await (const page of result) {
    console.log(page);
  }
  } else {
    console.log("guardrailsListMemberAssignments failed:", res.error);
  }
}

run();
```

### Parameters

| Parameter                                                                                                                                                                      | Type                                                                                                                                                                           | Required                                                                                                                                                                       | Description                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `request`                                                                                                                                                                      | [operations.ListMemberAssignmentsRequest](../../models/operations/list-member-assignments-request.md)                                                                          | :heavy_check_mark:                                                                                                                                                             | The request object to use for the request.                                                                                                                                     |
| `options`                                                                                                                                                                      | RequestOptions                                                                                                                                                                 | :heavy_minus_sign:                                                                                                                                                             | Used to set various options for making HTTP requests.                                                                                                                          |
| `options.fetchOptions`                                                                                                                                                         | [RequestInit](https://developer.mozilla.org/en-US/docs/Web/API/Request/Request#options)                                                                                        | :heavy_minus_sign:                                                                                                                                                             | Options that are passed to the underlying HTTP request. This can be used to inject extra headers for examples. All `Request` options, except `method` and `body`, are allowed. |
| `options.retries`                                                                                                                                                              | [RetryConfig](../../lib/utils/retryconfig.md)                                                                                                                                  | :heavy_minus_sign:                                                                                                                                                             | Enables retrying HTTP requests under certain failure conditions.                                                                                                               |

### Response

**Promise\<[operations.ListMemberAssignmentsResponse](../../models/operations/list-member-assignments-response.md)\>**

### Errors

| Error Type                              | Status Code                             | Content Type                            |
| --------------------------------------- | --------------------------------------- | --------------------------------------- |
| errors.UnauthorizedResponseError        | 401                                     | application/json                        |
| errors.InternalServerResponseError      | 500                                     | application/json                        |
| errors.OpenRouterManagementDefaultError | 4XX, 5XX                                | \*/\*                                   |

## get

Get a single guardrail by ID. [Management key](/docs/guides/overview/auth/management-api-keys) required.

### Example Usage

<!-- UsageSnippet language="typescript" operationID="getGuardrail" method="get" path="/guardrails/{id}" -->
```typescript
import { OpenRouterManagement } from "@openrouter-monorepo/management-sdk-generated";

const openRouterManagement = new OpenRouterManagement({
  bearerAuth: "<YOUR_BEARER_TOKEN_HERE>",
});

async function run() {
  const result = await openRouterManagement.guardrails.get({
    id: "550e8400-e29b-41d4-a716-446655440000",
  });

  console.log(result);
}

run();
```

### Standalone function

The standalone function version of this method:

```typescript
import { OpenRouterManagementCore } from "@openrouter-monorepo/management-sdk-generated/core.js";
import { guardrailsGet } from "@openrouter-monorepo/management-sdk-generated/funcs/guardrails-get.js";

// Use `OpenRouterManagementCore` for best tree-shaking performance.
// You can create one instance of it to use across an application.
const openRouterManagement = new OpenRouterManagementCore({
  bearerAuth: "<YOUR_BEARER_TOKEN_HERE>",
});

async function run() {
  const res = await guardrailsGet(openRouterManagement, {
    id: "550e8400-e29b-41d4-a716-446655440000",
  });
  if (res.ok) {
    const { value: result } = res;
    console.log(result);
  } else {
    console.log("guardrailsGet failed:", res.error);
  }
}

run();
```

### Parameters

| Parameter                                                                                                                                                                      | Type                                                                                                                                                                           | Required                                                                                                                                                                       | Description                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `request`                                                                                                                                                                      | [operations.GetGuardrailRequest](../../models/operations/get-guardrail-request.md)                                                                                             | :heavy_check_mark:                                                                                                                                                             | The request object to use for the request.                                                                                                                                     |
| `options`                                                                                                                                                                      | RequestOptions                                                                                                                                                                 | :heavy_minus_sign:                                                                                                                                                             | Used to set various options for making HTTP requests.                                                                                                                          |
| `options.fetchOptions`                                                                                                                                                         | [RequestInit](https://developer.mozilla.org/en-US/docs/Web/API/Request/Request#options)                                                                                        | :heavy_minus_sign:                                                                                                                                                             | Options that are passed to the underlying HTTP request. This can be used to inject extra headers for examples. All `Request` options, except `method` and `body`, are allowed. |
| `options.retries`                                                                                                                                                              | [RetryConfig](../../lib/utils/retryconfig.md)                                                                                                                                  | :heavy_minus_sign:                                                                                                                                                             | Enables retrying HTTP requests under certain failure conditions.                                                                                                               |

### Response

**Promise\<[models.GetGuardrailResponse](../../models/get-guardrail-response.md)\>**

### Errors

| Error Type                              | Status Code                             | Content Type                            |
| --------------------------------------- | --------------------------------------- | --------------------------------------- |
| errors.UnauthorizedResponseError        | 401                                     | application/json                        |
| errors.NotFoundResponseError            | 404                                     | application/json                        |
| errors.InternalServerResponseError      | 500                                     | application/json                        |
| errors.OpenRouterManagementDefaultError | 4XX, 5XX                                | \*/\*                                   |

## update

Update an existing guardrail, or materialize an unconfigured workspace default guardrail. Collection fields use replace semantics: send the full desired set on every update. [Management key](/docs/guides/overview/auth/management-api-keys) required.

### Example Usage

<!-- UsageSnippet language="typescript" operationID="updateGuardrail" method="patch" path="/guardrails/{id}" -->
```typescript
import { OpenRouterManagement } from "@openrouter-monorepo/management-sdk-generated";

const openRouterManagement = new OpenRouterManagement({
  bearerAuth: "<YOUR_BEARER_TOKEN_HERE>",
});

async function run() {
  const result = await openRouterManagement.guardrails.update({
    id: "550e8400-e29b-41d4-a716-446655440000",
    body: {
      name: "Updated Guardrail Name",
      description: "Updated description",
      limitUsd: 75,
      resetInterval: "weekly",
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
import { guardrailsUpdate } from "@openrouter-monorepo/management-sdk-generated/funcs/guardrails-update.js";

// Use `OpenRouterManagementCore` for best tree-shaking performance.
// You can create one instance of it to use across an application.
const openRouterManagement = new OpenRouterManagementCore({
  bearerAuth: "<YOUR_BEARER_TOKEN_HERE>",
});

async function run() {
  const res = await guardrailsUpdate(openRouterManagement, {
    id: "550e8400-e29b-41d4-a716-446655440000",
    body: {
      name: "Updated Guardrail Name",
      description: "Updated description",
      limitUsd: 75,
      resetInterval: "weekly",
    },
  });
  if (res.ok) {
    const { value: result } = res;
    console.log(result);
  } else {
    console.log("guardrailsUpdate failed:", res.error);
  }
}

run();
```

### Parameters

| Parameter                                                                                                                                                                      | Type                                                                                                                                                                           | Required                                                                                                                                                                       | Description                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `request`                                                                                                                                                                      | [operations.UpdateGuardrailRequest](../../models/operations/update-guardrail-request.md)                                                                                       | :heavy_check_mark:                                                                                                                                                             | The request object to use for the request.                                                                                                                                     |
| `options`                                                                                                                                                                      | RequestOptions                                                                                                                                                                 | :heavy_minus_sign:                                                                                                                                                             | Used to set various options for making HTTP requests.                                                                                                                          |
| `options.fetchOptions`                                                                                                                                                         | [RequestInit](https://developer.mozilla.org/en-US/docs/Web/API/Request/Request#options)                                                                                        | :heavy_minus_sign:                                                                                                                                                             | Options that are passed to the underlying HTTP request. This can be used to inject extra headers for examples. All `Request` options, except `method` and `body`, are allowed. |
| `options.retries`                                                                                                                                                              | [RetryConfig](../../lib/utils/retryconfig.md)                                                                                                                                  | :heavy_minus_sign:                                                                                                                                                             | Enables retrying HTTP requests under certain failure conditions.                                                                                                               |

### Response

**Promise\<[models.UpdateGuardrailResponse](../../models/update-guardrail-response.md)\>**

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

Delete an existing guardrail. [Management key](/docs/guides/overview/auth/management-api-keys) required.

### Example Usage

<!-- UsageSnippet language="typescript" operationID="deleteGuardrail" method="delete" path="/guardrails/{id}" -->
```typescript
import { OpenRouterManagement } from "@openrouter-monorepo/management-sdk-generated";

const openRouterManagement = new OpenRouterManagement({
  bearerAuth: "<YOUR_BEARER_TOKEN_HERE>",
});

async function run() {
  const result = await openRouterManagement.guardrails.delete({
    id: "550e8400-e29b-41d4-a716-446655440000",
  });

  console.log(result);
}

run();
```

### Standalone function

The standalone function version of this method:

```typescript
import { OpenRouterManagementCore } from "@openrouter-monorepo/management-sdk-generated/core.js";
import { guardrailsDelete } from "@openrouter-monorepo/management-sdk-generated/funcs/guardrails-delete.js";

// Use `OpenRouterManagementCore` for best tree-shaking performance.
// You can create one instance of it to use across an application.
const openRouterManagement = new OpenRouterManagementCore({
  bearerAuth: "<YOUR_BEARER_TOKEN_HERE>",
});

async function run() {
  const res = await guardrailsDelete(openRouterManagement, {
    id: "550e8400-e29b-41d4-a716-446655440000",
  });
  if (res.ok) {
    const { value: result } = res;
    console.log(result);
  } else {
    console.log("guardrailsDelete failed:", res.error);
  }
}

run();
```

### Parameters

| Parameter                                                                                                                                                                      | Type                                                                                                                                                                           | Required                                                                                                                                                                       | Description                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `request`                                                                                                                                                                      | [operations.DeleteGuardrailRequest](../../models/operations/delete-guardrail-request.md)                                                                                       | :heavy_check_mark:                                                                                                                                                             | The request object to use for the request.                                                                                                                                     |
| `options`                                                                                                                                                                      | RequestOptions                                                                                                                                                                 | :heavy_minus_sign:                                                                                                                                                             | Used to set various options for making HTTP requests.                                                                                                                          |
| `options.fetchOptions`                                                                                                                                                         | [RequestInit](https://developer.mozilla.org/en-US/docs/Web/API/Request/Request#options)                                                                                        | :heavy_minus_sign:                                                                                                                                                             | Options that are passed to the underlying HTTP request. This can be used to inject extra headers for examples. All `Request` options, except `method` and `body`, are allowed. |
| `options.retries`                                                                                                                                                              | [RetryConfig](../../lib/utils/retryconfig.md)                                                                                                                                  | :heavy_minus_sign:                                                                                                                                                             | Enables retrying HTTP requests under certain failure conditions.                                                                                                               |

### Response

**Promise\<[models.DeleteGuardrailResponse](../../models/delete-guardrail-response.md)\>**

### Errors

| Error Type                              | Status Code                             | Content Type                            |
| --------------------------------------- | --------------------------------------- | --------------------------------------- |
| errors.UnauthorizedResponseError        | 401                                     | application/json                        |
| errors.NotFoundResponseError            | 404                                     | application/json                        |
| errors.InternalServerResponseError      | 500                                     | application/json                        |
| errors.OpenRouterManagementDefaultError | 4XX, 5XX                                | \*/\*                                   |

## listGuardrailKeyAssignments

List all API key assignments for a specific guardrail. [Management key](/docs/guides/overview/auth/management-api-keys) required.

### Example Usage

<!-- UsageSnippet language="typescript" operationID="listGuardrailKeyAssignments" method="get" path="/guardrails/{id}/assignments/keys" -->
```typescript
import { OpenRouterManagement } from "@openrouter-monorepo/management-sdk-generated";

const openRouterManagement = new OpenRouterManagement({
  bearerAuth: "<YOUR_BEARER_TOKEN_HERE>",
});

async function run() {
  const result = await openRouterManagement.guardrails.listGuardrailKeyAssignments({
    id: "550e8400-e29b-41d4-a716-446655440000",
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
import { guardrailsListGuardrailKeyAssignments } from "@openrouter-monorepo/management-sdk-generated/funcs/guardrails-list-guardrail-key-assignments.js";

// Use `OpenRouterManagementCore` for best tree-shaking performance.
// You can create one instance of it to use across an application.
const openRouterManagement = new OpenRouterManagementCore({
  bearerAuth: "<YOUR_BEARER_TOKEN_HERE>",
});

async function run() {
  const res = await guardrailsListGuardrailKeyAssignments(openRouterManagement, {
    id: "550e8400-e29b-41d4-a716-446655440000",
  });
  if (res.ok) {
    const { value: result } = res;
    for await (const page of result) {
    console.log(page);
  }
  } else {
    console.log("guardrailsListGuardrailKeyAssignments failed:", res.error);
  }
}

run();
```

### Parameters

| Parameter                                                                                                                                                                      | Type                                                                                                                                                                           | Required                                                                                                                                                                       | Description                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `request`                                                                                                                                                                      | [operations.ListGuardrailKeyAssignmentsRequest](../../models/operations/list-guardrail-key-assignments-request.md)                                                             | :heavy_check_mark:                                                                                                                                                             | The request object to use for the request.                                                                                                                                     |
| `options`                                                                                                                                                                      | RequestOptions                                                                                                                                                                 | :heavy_minus_sign:                                                                                                                                                             | Used to set various options for making HTTP requests.                                                                                                                          |
| `options.fetchOptions`                                                                                                                                                         | [RequestInit](https://developer.mozilla.org/en-US/docs/Web/API/Request/Request#options)                                                                                        | :heavy_minus_sign:                                                                                                                                                             | Options that are passed to the underlying HTTP request. This can be used to inject extra headers for examples. All `Request` options, except `method` and `body`, are allowed. |
| `options.retries`                                                                                                                                                              | [RetryConfig](../../lib/utils/retryconfig.md)                                                                                                                                  | :heavy_minus_sign:                                                                                                                                                             | Enables retrying HTTP requests under certain failure conditions.                                                                                                               |

### Response

**Promise\<[operations.ListGuardrailKeyAssignmentsResponse](../../models/operations/list-guardrail-key-assignments-response.md)\>**

### Errors

| Error Type                              | Status Code                             | Content Type                            |
| --------------------------------------- | --------------------------------------- | --------------------------------------- |
| errors.UnauthorizedResponseError        | 401                                     | application/json                        |
| errors.NotFoundResponseError            | 404                                     | application/json                        |
| errors.InternalServerResponseError      | 500                                     | application/json                        |
| errors.OpenRouterManagementDefaultError | 4XX, 5XX                                | \*/\*                                   |

## bulkAssignKeys

Assign multiple API keys to a specific guardrail. A key may hold at most one guardrail; assigning replaces any existing assignment. [Management key](/docs/guides/overview/auth/management-api-keys) required.

### Example Usage

<!-- UsageSnippet language="typescript" operationID="bulkAssignKeysToGuardrail" method="post" path="/guardrails/{id}/assignments/keys" -->
```typescript
import { OpenRouterManagement } from "@openrouter-monorepo/management-sdk-generated";

const openRouterManagement = new OpenRouterManagement({
  bearerAuth: "<YOUR_BEARER_TOKEN_HERE>",
});

async function run() {
  const result = await openRouterManagement.guardrails.bulkAssignKeys({
    id: "550e8400-e29b-41d4-a716-446655440000",
    body: {
      keyHashes: [
        "c56454edb818d6b14bc0d61c46025f1450b0f4012d12304ab40aacb519fcbc93",
      ],
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
import { guardrailsBulkAssignKeys } from "@openrouter-monorepo/management-sdk-generated/funcs/guardrails-bulk-assign-keys.js";

// Use `OpenRouterManagementCore` for best tree-shaking performance.
// You can create one instance of it to use across an application.
const openRouterManagement = new OpenRouterManagementCore({
  bearerAuth: "<YOUR_BEARER_TOKEN_HERE>",
});

async function run() {
  const res = await guardrailsBulkAssignKeys(openRouterManagement, {
    id: "550e8400-e29b-41d4-a716-446655440000",
    body: {
      keyHashes: [
        "c56454edb818d6b14bc0d61c46025f1450b0f4012d12304ab40aacb519fcbc93",
      ],
    },
  });
  if (res.ok) {
    const { value: result } = res;
    console.log(result);
  } else {
    console.log("guardrailsBulkAssignKeys failed:", res.error);
  }
}

run();
```

### Parameters

| Parameter                                                                                                                                                                      | Type                                                                                                                                                                           | Required                                                                                                                                                                       | Description                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `request`                                                                                                                                                                      | [operations.BulkAssignKeysToGuardrailRequest](../../models/operations/bulk-assign-keys-to-guardrail-request.md)                                                                | :heavy_check_mark:                                                                                                                                                             | The request object to use for the request.                                                                                                                                     |
| `options`                                                                                                                                                                      | RequestOptions                                                                                                                                                                 | :heavy_minus_sign:                                                                                                                                                             | Used to set various options for making HTTP requests.                                                                                                                          |
| `options.fetchOptions`                                                                                                                                                         | [RequestInit](https://developer.mozilla.org/en-US/docs/Web/API/Request/Request#options)                                                                                        | :heavy_minus_sign:                                                                                                                                                             | Options that are passed to the underlying HTTP request. This can be used to inject extra headers for examples. All `Request` options, except `method` and `body`, are allowed. |
| `options.retries`                                                                                                                                                              | [RetryConfig](../../lib/utils/retryconfig.md)                                                                                                                                  | :heavy_minus_sign:                                                                                                                                                             | Enables retrying HTTP requests under certain failure conditions.                                                                                                               |

### Response

**Promise\<[models.BulkAssignKeysResponse](../../models/bulk-assign-keys-response.md)\>**

### Errors

| Error Type                              | Status Code                             | Content Type                            |
| --------------------------------------- | --------------------------------------- | --------------------------------------- |
| errors.BadRequestResponseError          | 400                                     | application/json                        |
| errors.UnauthorizedResponseError        | 401                                     | application/json                        |
| errors.ForbiddenResponseError           | 403                                     | application/json                        |
| errors.NotFoundResponseError            | 404                                     | application/json                        |
| errors.InternalServerResponseError      | 500                                     | application/json                        |
| errors.OpenRouterManagementDefaultError | 4XX, 5XX                                | \*/\*                                   |

## bulkUnassignKeys

Unassign multiple API keys from a specific guardrail. [Management key](/docs/guides/overview/auth/management-api-keys) required.

### Example Usage

<!-- UsageSnippet language="typescript" operationID="bulkUnassignKeysFromGuardrail" method="post" path="/guardrails/{id}/assignments/keys/remove" -->
```typescript
import { OpenRouterManagement } from "@openrouter-monorepo/management-sdk-generated";

const openRouterManagement = new OpenRouterManagement({
  bearerAuth: "<YOUR_BEARER_TOKEN_HERE>",
});

async function run() {
  const result = await openRouterManagement.guardrails.bulkUnassignKeys({
    id: "550e8400-e29b-41d4-a716-446655440000",
    body: {
      keyHashes: [
        "c56454edb818d6b14bc0d61c46025f1450b0f4012d12304ab40aacb519fcbc93",
      ],
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
import { guardrailsBulkUnassignKeys } from "@openrouter-monorepo/management-sdk-generated/funcs/guardrails-bulk-unassign-keys.js";

// Use `OpenRouterManagementCore` for best tree-shaking performance.
// You can create one instance of it to use across an application.
const openRouterManagement = new OpenRouterManagementCore({
  bearerAuth: "<YOUR_BEARER_TOKEN_HERE>",
});

async function run() {
  const res = await guardrailsBulkUnassignKeys(openRouterManagement, {
    id: "550e8400-e29b-41d4-a716-446655440000",
    body: {
      keyHashes: [
        "c56454edb818d6b14bc0d61c46025f1450b0f4012d12304ab40aacb519fcbc93",
      ],
    },
  });
  if (res.ok) {
    const { value: result } = res;
    console.log(result);
  } else {
    console.log("guardrailsBulkUnassignKeys failed:", res.error);
  }
}

run();
```

### Parameters

| Parameter                                                                                                                                                                      | Type                                                                                                                                                                           | Required                                                                                                                                                                       | Description                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `request`                                                                                                                                                                      | [operations.BulkUnassignKeysFromGuardrailRequest](../../models/operations/bulk-unassign-keys-from-guardrail-request.md)                                                        | :heavy_check_mark:                                                                                                                                                             | The request object to use for the request.                                                                                                                                     |
| `options`                                                                                                                                                                      | RequestOptions                                                                                                                                                                 | :heavy_minus_sign:                                                                                                                                                             | Used to set various options for making HTTP requests.                                                                                                                          |
| `options.fetchOptions`                                                                                                                                                         | [RequestInit](https://developer.mozilla.org/en-US/docs/Web/API/Request/Request#options)                                                                                        | :heavy_minus_sign:                                                                                                                                                             | Options that are passed to the underlying HTTP request. This can be used to inject extra headers for examples. All `Request` options, except `method` and `body`, are allowed. |
| `options.retries`                                                                                                                                                              | [RetryConfig](../../lib/utils/retryconfig.md)                                                                                                                                  | :heavy_minus_sign:                                                                                                                                                             | Enables retrying HTTP requests under certain failure conditions.                                                                                                               |

### Response

**Promise\<[models.BulkUnassignKeysResponse](../../models/bulk-unassign-keys-response.md)\>**

### Errors

| Error Type                              | Status Code                             | Content Type                            |
| --------------------------------------- | --------------------------------------- | --------------------------------------- |
| errors.BadRequestResponseError          | 400                                     | application/json                        |
| errors.UnauthorizedResponseError        | 401                                     | application/json                        |
| errors.NotFoundResponseError            | 404                                     | application/json                        |
| errors.InternalServerResponseError      | 500                                     | application/json                        |
| errors.OpenRouterManagementDefaultError | 4XX, 5XX                                | \*/\*                                   |

## listGuardrailMemberAssignments

List all organization member assignments for a specific guardrail. [Management key](/docs/guides/overview/auth/management-api-keys) required.

### Example Usage

<!-- UsageSnippet language="typescript" operationID="listGuardrailMemberAssignments" method="get" path="/guardrails/{id}/assignments/members" -->
```typescript
import { OpenRouterManagement } from "@openrouter-monorepo/management-sdk-generated";

const openRouterManagement = new OpenRouterManagement({
  bearerAuth: "<YOUR_BEARER_TOKEN_HERE>",
});

async function run() {
  const result = await openRouterManagement.guardrails.listGuardrailMemberAssignments({
    id: "550e8400-e29b-41d4-a716-446655440000",
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
import { guardrailsListGuardrailMemberAssignments } from "@openrouter-monorepo/management-sdk-generated/funcs/guardrails-list-guardrail-member-assignments.js";

// Use `OpenRouterManagementCore` for best tree-shaking performance.
// You can create one instance of it to use across an application.
const openRouterManagement = new OpenRouterManagementCore({
  bearerAuth: "<YOUR_BEARER_TOKEN_HERE>",
});

async function run() {
  const res = await guardrailsListGuardrailMemberAssignments(openRouterManagement, {
    id: "550e8400-e29b-41d4-a716-446655440000",
  });
  if (res.ok) {
    const { value: result } = res;
    for await (const page of result) {
    console.log(page);
  }
  } else {
    console.log("guardrailsListGuardrailMemberAssignments failed:", res.error);
  }
}

run();
```

### Parameters

| Parameter                                                                                                                                                                      | Type                                                                                                                                                                           | Required                                                                                                                                                                       | Description                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `request`                                                                                                                                                                      | [operations.ListGuardrailMemberAssignmentsRequest](../../models/operations/list-guardrail-member-assignments-request.md)                                                       | :heavy_check_mark:                                                                                                                                                             | The request object to use for the request.                                                                                                                                     |
| `options`                                                                                                                                                                      | RequestOptions                                                                                                                                                                 | :heavy_minus_sign:                                                                                                                                                             | Used to set various options for making HTTP requests.                                                                                                                          |
| `options.fetchOptions`                                                                                                                                                         | [RequestInit](https://developer.mozilla.org/en-US/docs/Web/API/Request/Request#options)                                                                                        | :heavy_minus_sign:                                                                                                                                                             | Options that are passed to the underlying HTTP request. This can be used to inject extra headers for examples. All `Request` options, except `method` and `body`, are allowed. |
| `options.retries`                                                                                                                                                              | [RetryConfig](../../lib/utils/retryconfig.md)                                                                                                                                  | :heavy_minus_sign:                                                                                                                                                             | Enables retrying HTTP requests under certain failure conditions.                                                                                                               |

### Response

**Promise\<[operations.ListGuardrailMemberAssignmentsResponse](../../models/operations/list-guardrail-member-assignments-response.md)\>**

### Errors

| Error Type                              | Status Code                             | Content Type                            |
| --------------------------------------- | --------------------------------------- | --------------------------------------- |
| errors.UnauthorizedResponseError        | 401                                     | application/json                        |
| errors.NotFoundResponseError            | 404                                     | application/json                        |
| errors.InternalServerResponseError      | 500                                     | application/json                        |
| errors.OpenRouterManagementDefaultError | 4XX, 5XX                                | \*/\*                                   |

## bulkAssignMembers

Assign multiple organization members to a specific guardrail. [Management key](/docs/guides/overview/auth/management-api-keys) required.

### Example Usage

<!-- UsageSnippet language="typescript" operationID="bulkAssignMembersToGuardrail" method="post" path="/guardrails/{id}/assignments/members" -->
```typescript
import { OpenRouterManagement } from "@openrouter-monorepo/management-sdk-generated";

const openRouterManagement = new OpenRouterManagement({
  bearerAuth: "<YOUR_BEARER_TOKEN_HERE>",
});

async function run() {
  const result = await openRouterManagement.guardrails.bulkAssignMembers({
    id: "550e8400-e29b-41d4-a716-446655440000",
    body: {
      memberUserIds: [
        "user_abc123",
        "user_def456",
      ],
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
import { guardrailsBulkAssignMembers } from "@openrouter-monorepo/management-sdk-generated/funcs/guardrails-bulk-assign-members.js";

// Use `OpenRouterManagementCore` for best tree-shaking performance.
// You can create one instance of it to use across an application.
const openRouterManagement = new OpenRouterManagementCore({
  bearerAuth: "<YOUR_BEARER_TOKEN_HERE>",
});

async function run() {
  const res = await guardrailsBulkAssignMembers(openRouterManagement, {
    id: "550e8400-e29b-41d4-a716-446655440000",
    body: {
      memberUserIds: [
        "user_abc123",
        "user_def456",
      ],
    },
  });
  if (res.ok) {
    const { value: result } = res;
    console.log(result);
  } else {
    console.log("guardrailsBulkAssignMembers failed:", res.error);
  }
}

run();
```

### Parameters

| Parameter                                                                                                                                                                      | Type                                                                                                                                                                           | Required                                                                                                                                                                       | Description                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `request`                                                                                                                                                                      | [operations.BulkAssignMembersToGuardrailRequest](../../models/operations/bulk-assign-members-to-guardrail-request.md)                                                          | :heavy_check_mark:                                                                                                                                                             | The request object to use for the request.                                                                                                                                     |
| `options`                                                                                                                                                                      | RequestOptions                                                                                                                                                                 | :heavy_minus_sign:                                                                                                                                                             | Used to set various options for making HTTP requests.                                                                                                                          |
| `options.fetchOptions`                                                                                                                                                         | [RequestInit](https://developer.mozilla.org/en-US/docs/Web/API/Request/Request#options)                                                                                        | :heavy_minus_sign:                                                                                                                                                             | Options that are passed to the underlying HTTP request. This can be used to inject extra headers for examples. All `Request` options, except `method` and `body`, are allowed. |
| `options.retries`                                                                                                                                                              | [RetryConfig](../../lib/utils/retryconfig.md)                                                                                                                                  | :heavy_minus_sign:                                                                                                                                                             | Enables retrying HTTP requests under certain failure conditions.                                                                                                               |

### Response

**Promise\<[models.BulkAssignMembersResponse](../../models/bulk-assign-members-response.md)\>**

### Errors

| Error Type                              | Status Code                             | Content Type                            |
| --------------------------------------- | --------------------------------------- | --------------------------------------- |
| errors.BadRequestResponseError          | 400                                     | application/json                        |
| errors.UnauthorizedResponseError        | 401                                     | application/json                        |
| errors.NotFoundResponseError            | 404                                     | application/json                        |
| errors.InternalServerResponseError      | 500                                     | application/json                        |
| errors.OpenRouterManagementDefaultError | 4XX, 5XX                                | \*/\*                                   |

## bulkUnassignMembers

Unassign multiple organization members from a specific guardrail. [Management key](/docs/guides/overview/auth/management-api-keys) required.

### Example Usage

<!-- UsageSnippet language="typescript" operationID="bulkUnassignMembersFromGuardrail" method="post" path="/guardrails/{id}/assignments/members/remove" -->
```typescript
import { OpenRouterManagement } from "@openrouter-monorepo/management-sdk-generated";

const openRouterManagement = new OpenRouterManagement({
  bearerAuth: "<YOUR_BEARER_TOKEN_HERE>",
});

async function run() {
  const result = await openRouterManagement.guardrails.bulkUnassignMembers({
    id: "550e8400-e29b-41d4-a716-446655440000",
    body: {
      memberUserIds: [
        "user_abc123",
        "user_def456",
      ],
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
import { guardrailsBulkUnassignMembers } from "@openrouter-monorepo/management-sdk-generated/funcs/guardrails-bulk-unassign-members.js";

// Use `OpenRouterManagementCore` for best tree-shaking performance.
// You can create one instance of it to use across an application.
const openRouterManagement = new OpenRouterManagementCore({
  bearerAuth: "<YOUR_BEARER_TOKEN_HERE>",
});

async function run() {
  const res = await guardrailsBulkUnassignMembers(openRouterManagement, {
    id: "550e8400-e29b-41d4-a716-446655440000",
    body: {
      memberUserIds: [
        "user_abc123",
        "user_def456",
      ],
    },
  });
  if (res.ok) {
    const { value: result } = res;
    console.log(result);
  } else {
    console.log("guardrailsBulkUnassignMembers failed:", res.error);
  }
}

run();
```

### Parameters

| Parameter                                                                                                                                                                      | Type                                                                                                                                                                           | Required                                                                                                                                                                       | Description                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `request`                                                                                                                                                                      | [operations.BulkUnassignMembersFromGuardrailRequest](../../models/operations/bulk-unassign-members-from-guardrail-request.md)                                                  | :heavy_check_mark:                                                                                                                                                             | The request object to use for the request.                                                                                                                                     |
| `options`                                                                                                                                                                      | RequestOptions                                                                                                                                                                 | :heavy_minus_sign:                                                                                                                                                             | Used to set various options for making HTTP requests.                                                                                                                          |
| `options.fetchOptions`                                                                                                                                                         | [RequestInit](https://developer.mozilla.org/en-US/docs/Web/API/Request/Request#options)                                                                                        | :heavy_minus_sign:                                                                                                                                                             | Options that are passed to the underlying HTTP request. This can be used to inject extra headers for examples. All `Request` options, except `method` and `body`, are allowed. |
| `options.retries`                                                                                                                                                              | [RetryConfig](../../lib/utils/retryconfig.md)                                                                                                                                  | :heavy_minus_sign:                                                                                                                                                             | Enables retrying HTTP requests under certain failure conditions.                                                                                                               |

### Response

**Promise\<[models.BulkUnassignMembersResponse](../../models/bulk-unassign-members-response.md)\>**

### Errors

| Error Type                              | Status Code                             | Content Type                            |
| --------------------------------------- | --------------------------------------- | --------------------------------------- |
| errors.BadRequestResponseError          | 400                                     | application/json                        |
| errors.UnauthorizedResponseError        | 401                                     | application/json                        |
| errors.NotFoundResponseError            | 404                                     | application/json                        |
| errors.InternalServerResponseError      | 500                                     | application/json                        |
| errors.OpenRouterManagementDefaultError | 4XX, 5XX                                | \*/\*                                   |