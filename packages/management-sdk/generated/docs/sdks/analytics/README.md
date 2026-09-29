# Analytics

## Overview

### Available Operations

* [getUserActivity](#getuseractivity) - Get user activity grouped by endpoint
* [getAnalyticsMeta](#getanalyticsmeta) - Get available analytics metrics and dimensions
* [queryAnalytics](#queryanalytics) - Query analytics data

## getUserActivity

Returns user activity data grouped by endpoint for the last 30 (completed) UTC days. Pass `workspace_id` to scope the response to a single workspace. Pass `group_by=workspace` to split each row per workspace and include `workspace_id` on every item; by default rows are aggregated across workspaces and `workspace_id` is not returned. Activity recorded before workspace resolution existed is permanently attributed to the account default workspace (no backfill is possible). [Management key](/docs/guides/overview/auth/management-api-keys) required.

### Example Usage

<!-- UsageSnippet language="typescript" operationID="getUserActivity" method="get" path="/activity" -->
```typescript
import { OpenRouterManagement } from "@openrouter-monorepo/management-sdk-generated";

const openRouterManagement = new OpenRouterManagement({
  bearerAuth: "<YOUR_BEARER_TOKEN_HERE>",
});

async function run() {
  const result = await openRouterManagement.analytics.getUserActivity("2025-08-24T00:00:00Z", "abc123def456...", "user_abc123", "workspace", "550e8400-e29b-41d4-a716-446655440000");

  console.log(result);
}

run();
```

### Standalone function

The standalone function version of this method:

```typescript
import { OpenRouterManagementCore } from "@openrouter-monorepo/management-sdk-generated/core.js";
import { analyticsGetUserActivity } from "@openrouter-monorepo/management-sdk-generated/funcs/analytics-get-user-activity.js";

// Use `OpenRouterManagementCore` for best tree-shaking performance.
// You can create one instance of it to use across an application.
const openRouterManagement = new OpenRouterManagementCore({
  bearerAuth: "<YOUR_BEARER_TOKEN_HERE>",
});

async function run() {
  const res = await analyticsGetUserActivity(openRouterManagement, "2025-08-24T00:00:00Z", "abc123def456...", "user_abc123", "workspace", "550e8400-e29b-41d4-a716-446655440000");
  if (res.ok) {
    const { value: result } = res;
    console.log(result);
  } else {
    console.log("analyticsGetUserActivity failed:", res.error);
  }
}

run();
```

### Parameters

| Parameter                                                                                                                                                                                                                                                                          | Type                                                                                                                                                                                                                                                                               | Required                                                                                                                                                                                                                                                                           | Description                                                                                                                                                                                                                                                                        | Example                                                                                                                                                                                                                                                                            |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `date`                                                                                                                                                                                                                                                                             | *string*                                                                                                                                                                                                                                                                           | :heavy_minus_sign:                                                                                                                                                                                                                                                                 | Filter by a single UTC date in the last 30 days (YYYY-MM-DD format).                                                                                                                                                                                                               | 2025-08-24 00:00:00 +0000 UTC                                                                                                                                                                                                                                                      |
| `apiKeyHash`                                                                                                                                                                                                                                                                       | *string*                                                                                                                                                                                                                                                                           | :heavy_minus_sign:                                                                                                                                                                                                                                                                 | Filter by API key hash (SHA-256 hex string, as returned by the keys API).                                                                                                                                                                                                          | abc123def456...                                                                                                                                                                                                                                                                    |
| `userId`                                                                                                                                                                                                                                                                           | *string*                                                                                                                                                                                                                                                                           | :heavy_minus_sign:                                                                                                                                                                                                                                                                 | Filter by org member user ID. Only applicable for organization accounts.                                                                                                                                                                                                           | user_abc123                                                                                                                                                                                                                                                                        |
| `groupBy`                                                                                                                                                                                                                                                                          | [operations.GroupBy](../../models/operations/group-by.md)                                                                                                                                                                                                                          | :heavy_minus_sign:                                                                                                                                                                                                                                                                 | Set to 'workspace' to split each row per workspace and include `workspace_id` on every item. Omitted by default, in which case rows are aggregated across workspaces (by date, model, and endpoint) and `workspace_id` is not returned — preserving the historical response shape. | workspace                                                                                                                                                                                                                                                                          |
| `workspaceId`                                                                                                                                                                                                                                                                      | *string*                                                                                                                                                                                                                                                                           | :heavy_minus_sign:                                                                                                                                                                                                                                                                 | Filter by workspace ID (UUID). Returns only activity attributed to that workspace. The workspace must belong to the authenticated account.                                                                                                                                         | 550e8400-e29b-41d4-a716-446655440000                                                                                                                                                                                                                                               |
| `options`                                                                                                                                                                                                                                                                          | RequestOptions                                                                                                                                                                                                                                                                     | :heavy_minus_sign:                                                                                                                                                                                                                                                                 | Used to set various options for making HTTP requests.                                                                                                                                                                                                                              |                                                                                                                                                                                                                                                                                    |
| `options.fetchOptions`                                                                                                                                                                                                                                                             | [RequestInit](https://developer.mozilla.org/en-US/docs/Web/API/Request/Request#options)                                                                                                                                                                                            | :heavy_minus_sign:                                                                                                                                                                                                                                                                 | Options that are passed to the underlying HTTP request. This can be used to inject extra headers for examples. All `Request` options, except `method` and `body`, are allowed.                                                                                                     |                                                                                                                                                                                                                                                                                    |
| `options.retries`                                                                                                                                                                                                                                                                  | [RetryConfig](../../lib/utils/retryconfig.md)                                                                                                                                                                                                                                      | :heavy_minus_sign:                                                                                                                                                                                                                                                                 | Enables retrying HTTP requests under certain failure conditions.                                                                                                                                                                                                                   |                                                                                                                                                                                                                                                                                    |

### Response

**Promise\<[models.ActivityResponse](../../models/activity-response.md)\>**

### Errors

| Error Type                              | Status Code                             | Content Type                            |
| --------------------------------------- | --------------------------------------- | --------------------------------------- |
| errors.BadRequestResponseError          | 400                                     | application/json                        |
| errors.UnauthorizedResponseError        | 401                                     | application/json                        |
| errors.ForbiddenResponseError           | 403                                     | application/json                        |
| errors.NotFoundResponseError            | 404                                     | application/json                        |
| errors.InternalServerResponseError      | 500                                     | application/json                        |
| errors.OpenRouterManagementDefaultError | 4XX, 5XX                                | \*/\*                                   |

## getAnalyticsMeta

Returns the available metrics, dimensions, filter operators, and granularities for the analytics query endpoint. [Management key](/docs/guides/overview/auth/management-api-keys) required.

### Example Usage

<!-- UsageSnippet language="typescript" operationID="getAnalyticsMeta" method="get" path="/analytics/meta" -->
```typescript
import { OpenRouterManagement } from "@openrouter-monorepo/management-sdk-generated";

const openRouterManagement = new OpenRouterManagement({
  bearerAuth: "<YOUR_BEARER_TOKEN_HERE>",
});

async function run() {
  const result = await openRouterManagement.analytics.getAnalyticsMeta();

  console.log(result);
}

run();
```

### Standalone function

The standalone function version of this method:

```typescript
import { OpenRouterManagementCore } from "@openrouter-monorepo/management-sdk-generated/core.js";
import { analyticsGetAnalyticsMeta } from "@openrouter-monorepo/management-sdk-generated/funcs/analytics-get-analytics-meta.js";

// Use `OpenRouterManagementCore` for best tree-shaking performance.
// You can create one instance of it to use across an application.
const openRouterManagement = new OpenRouterManagementCore({
  bearerAuth: "<YOUR_BEARER_TOKEN_HERE>",
});

async function run() {
  const res = await analyticsGetAnalyticsMeta(openRouterManagement);
  if (res.ok) {
    const { value: result } = res;
    console.log(result);
  } else {
    console.log("analyticsGetAnalyticsMeta failed:", res.error);
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

**Promise\<[operations.GetAnalyticsMetaResponse](../../models/operations/get-analytics-meta-response.md)\>**

### Errors

| Error Type                              | Status Code                             | Content Type                            |
| --------------------------------------- | --------------------------------------- | --------------------------------------- |
| errors.UnauthorizedResponseError        | 401                                     | application/json                        |
| errors.ForbiddenResponseError           | 403                                     | application/json                        |
| errors.InternalServerResponseError      | 500                                     | application/json                        |
| errors.OpenRouterManagementDefaultError | 4XX, 5XX                                | \*/\*                                   |

## queryAnalytics

Execute an analytics query with specified metrics, dimensions, filters, and time range. [Management key](/docs/guides/overview/auth/management-api-keys) required.

### Example Usage

<!-- UsageSnippet language="typescript" operationID="queryAnalytics" method="post" path="/analytics/query" -->
```typescript
import { OpenRouterManagement } from "@openrouter-monorepo/management-sdk-generated";

const openRouterManagement = new OpenRouterManagement({
  bearerAuth: "<YOUR_BEARER_TOKEN_HERE>",
});

async function run() {
  const result = await openRouterManagement.analytics.queryAnalytics({
    metrics: [
      "request_count",
    ],
    dimensions: [
      "model",
    ],
    granularity: "day",
    timeRange: {
      start: new Date("2025-01-01T00:00:00Z"),
      end: new Date("2025-01-08T00:00:00Z"),
    },
    limit: 100,
  });

  console.log(result);
}

run();
```

### Standalone function

The standalone function version of this method:

```typescript
import { OpenRouterManagementCore } from "@openrouter-monorepo/management-sdk-generated/core.js";
import { analyticsQueryAnalytics } from "@openrouter-monorepo/management-sdk-generated/funcs/analytics-query-analytics.js";

// Use `OpenRouterManagementCore` for best tree-shaking performance.
// You can create one instance of it to use across an application.
const openRouterManagement = new OpenRouterManagementCore({
  bearerAuth: "<YOUR_BEARER_TOKEN_HERE>",
});

async function run() {
  const res = await analyticsQueryAnalytics(openRouterManagement, {
    metrics: [
      "request_count",
    ],
    dimensions: [
      "model",
    ],
    granularity: "day",
    timeRange: {
      start: new Date("2025-01-01T00:00:00Z"),
      end: new Date("2025-01-08T00:00:00Z"),
    },
    limit: 100,
  });
  if (res.ok) {
    const { value: result } = res;
    console.log(result);
  } else {
    console.log("analyticsQueryAnalytics failed:", res.error);
  }
}

run();
```

### Parameters

| Parameter                                                                                                                                                                      | Type                                                                                                                                                                           | Required                                                                                                                                                                       | Description                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `request`                                                                                                                                                                      | [operations.QueryAnalyticsRequest](../../models/operations/query-analytics-request.md)                                                                                         | :heavy_check_mark:                                                                                                                                                             | The request object to use for the request.                                                                                                                                     |
| `options`                                                                                                                                                                      | RequestOptions                                                                                                                                                                 | :heavy_minus_sign:                                                                                                                                                             | Used to set various options for making HTTP requests.                                                                                                                          |
| `options.fetchOptions`                                                                                                                                                         | [RequestInit](https://developer.mozilla.org/en-US/docs/Web/API/Request/Request#options)                                                                                        | :heavy_minus_sign:                                                                                                                                                             | Options that are passed to the underlying HTTP request. This can be used to inject extra headers for examples. All `Request` options, except `method` and `body`, are allowed. |
| `options.retries`                                                                                                                                                              | [RetryConfig](../../lib/utils/retryconfig.md)                                                                                                                                  | :heavy_minus_sign:                                                                                                                                                             | Enables retrying HTTP requests under certain failure conditions.                                                                                                               |

### Response

**Promise\<[operations.QueryAnalyticsResponse](../../models/operations/query-analytics-response.md)\>**

### Errors

| Error Type                              | Status Code                             | Content Type                            |
| --------------------------------------- | --------------------------------------- | --------------------------------------- |
| errors.BadRequestResponseError          | 400                                     | application/json                        |
| errors.UnauthorizedResponseError        | 401                                     | application/json                        |
| errors.ForbiddenResponseError           | 403                                     | application/json                        |
| errors.RequestTimeoutResponseError      | 408                                     | application/json                        |
| errors.InternalServerResponseError      | 500                                     | application/json                        |
| errors.OpenRouterManagementDefaultError | 4XX, 5XX                                | \*/\*                                   |