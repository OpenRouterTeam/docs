# @openrouter-monorepo/management-sdk-generated

Developer-friendly & type-safe Typescript SDK specifically catered to leverage *@openrouter-monorepo/management-sdk-generated* API.

[![Built by Speakeasy](https://img.shields.io/badge/Built_by-SPEAKEASY-374151?style=for-the-badge&labelColor=f3f4f6)](https://www.speakeasy.com/?utm_source=@openrouter-monorepo/management-sdk-generated&utm_campaign=typescript)
[![License: MIT](https://img.shields.io/badge/LICENSE_//_MIT-3b5bdb?style=for-the-badge&labelColor=eff6ff)](https://opensource.org/licenses/MIT)


<br /><br />
> [!IMPORTANT]
> This SDK is not yet ready for production use. To complete setup please follow the steps outlined in your [workspace](https://app.speakeasy.com/org/openrouter/sdk). Delete this section before > publishing to a package manager.

<!-- Start Summary [summary] -->
## Summary

OpenRouter Management API: Management/provisioning surface for OpenRouter (keys, BYOK, workspaces, guardrails, observability destinations, presets, and related read endpoints). Generated from the cfw-api and cfw-public-api Hono route schemas by filtering to operations tagged with the `x-or-specs`: `['management']` route extension. Regenerate via `bun run generate:management-openapi`.
<!-- End Summary [summary] -->

<!-- Start Table of Contents [toc] -->
## Table of Contents
<!-- $toc-max-depth=2 -->
* [@openrouter-monorepo/management-sdk-generated](#openrouter-monorepomanagement-sdk-generated)
  * [SDK Installation](#sdk-installation)
  * [Requirements](#requirements)
  * [SDK Example Usage](#sdk-example-usage)
  * [Authentication](#authentication)
  * [Available Resources and Operations](#available-resources-and-operations)
  * [Standalone functions](#standalone-functions)
  * [Pagination](#pagination)
  * [Retries](#retries)
  * [Error Handling](#error-handling)
  * [Server Selection](#server-selection)
  * [Custom HTTP Client](#custom-http-client)
  * [Debugging](#debugging)
* [Development](#development)
  * [Maturity](#maturity)
  * [Contributions](#contributions)

<!-- End Table of Contents [toc] -->

<!-- Start SDK Installation [installation] -->
## SDK Installation

> [!TIP]
> To finish publishing your SDK to npm and others you must [run your first generation action](https://www.speakeasy.com/docs/github-setup#step-by-step-guide).


The SDK can be installed with either [npm](https://www.npmjs.com/), [pnpm](https://pnpm.io/), [bun](https://bun.sh/) or [yarn](https://classic.yarnpkg.com/en/) package managers.

### NPM

```bash
npm add <UNSET>
```

### PNPM

```bash
pnpm add <UNSET>
```

### Bun

```bash
bun add <UNSET>
```

### Yarn

```bash
yarn add <UNSET>
```

> [!NOTE]
> This package is published as an ES Module (ESM) only. For applications using
> CommonJS, use `await import()` to import and use this package.
<!-- End SDK Installation [installation] -->

<!-- Start Requirements [requirements] -->
## Requirements

For supported JavaScript runtimes, please consult [RUNTIMES.md](RUNTIMES.md).
<!-- End Requirements [requirements] -->

<!-- Start SDK Example Usage [usage] -->
## SDK Example Usage

### Example

```typescript
import { OpenRouterManagement } from "@openrouter-monorepo/management-sdk-generated";

const openRouterManagement = new OpenRouterManagement({
  bearerAuth: "<YOUR_BEARER_TOKEN_HERE>",
});

async function run() {
  const result = await openRouterManagement.analytics.getUserActivity(
    "2025-08-24T00:00:00Z",
    "abc123def456...",
    "user_abc123",
    "workspace",
    "550e8400-e29b-41d4-a716-446655440000",
  );

  console.log(result);
}

run();

```
<!-- End SDK Example Usage [usage] -->

<!-- Start Authentication [security] -->
## Authentication

### Per-Client Security Schemes

This SDK supports the following security scheme globally:

| Name         | Type | Scheme      |
| ------------ | ---- | ----------- |
| `bearerAuth` | http | HTTP Bearer |

To authenticate with the API the `bearerAuth` parameter must be set when initializing the SDK client instance. For example:
```typescript
import { OpenRouterManagement } from "@openrouter-monorepo/management-sdk-generated";

const openRouterManagement = new OpenRouterManagement({
  bearerAuth: "<YOUR_BEARER_TOKEN_HERE>",
});

async function run() {
  const result = await openRouterManagement.analytics.getUserActivity(
    "2025-08-24T00:00:00Z",
    "abc123def456...",
    "user_abc123",
    "workspace",
    "550e8400-e29b-41d4-a716-446655440000",
  );

  console.log(result);
}

run();

```

### Per-Operation Security Schemes

Some operations in this SDK require the security scheme to be specified at the request level. For example:
```typescript
import { OpenRouterManagement } from "@openrouter-monorepo/management-sdk-generated";

const openRouterManagement = new OpenRouterManagement();

async function run() {
  const result = await openRouterManagement.presets.list({
    apiKey: "<YOUR_API_KEY_HERE>",
  }, {});

  for await (const page of result) {
    console.log(page);
  }
}

run();

```
<!-- End Authentication [security] -->

<!-- Start Available Resources and Operations [operations] -->
## Available Resources and Operations

<details open>
<summary>Available methods</summary>

### [Analytics](docs/sdks/analytics/README.md)

* [getUserActivity](docs/sdks/analytics/README.md#getuseractivity) - Get user activity grouped by endpoint
* [getAnalyticsMeta](docs/sdks/analytics/README.md#getanalyticsmeta) - Get available analytics metrics and dimensions
* [queryAnalytics](docs/sdks/analytics/README.md#queryanalytics) - Query analytics data

### [APIKeys](docs/sdks/apikeys/README.md)

* [getCurrentKeyMetadata](docs/sdks/apikeys/README.md#getcurrentkeymetadata) - Get current API key
* [list](docs/sdks/apikeys/README.md#list) - List API keys
* [create](docs/sdks/apikeys/README.md#create) - Create a new API key
* [update](docs/sdks/apikeys/README.md#update) - Update an API key
* [delete](docs/sdks/apikeys/README.md#delete) - Delete an API key
* [get](docs/sdks/apikeys/README.md#get) - Get a single API key

### [Byok](docs/sdks/byok/README.md)

* [list](docs/sdks/byok/README.md#list) - List BYOK provider credentials
* [create](docs/sdks/byok/README.md#create) - Create a BYOK provider credential
* [get](docs/sdks/byok/README.md#get) - Get a BYOK provider credential
* [update](docs/sdks/byok/README.md#update) - Update a BYOK provider credential
* [delete](docs/sdks/byok/README.md#delete) - Delete a BYOK provider credential

### [Credits](docs/sdks/credits/README.md)

* [getCredits](docs/sdks/credits/README.md#getcredits) - Get remaining credits

### [Generations](docs/sdks/generations/README.md)

* [getGeneration](docs/sdks/generations/README.md#getgeneration) - Get request & usage metadata for a generation
* [submitFeedback](docs/sdks/generations/README.md#submitfeedback) - Submit feedback for a generation

### [Guardrails](docs/sdks/guardrails/README.md)

* [list](docs/sdks/guardrails/README.md#list) - List guardrails
* [create](docs/sdks/guardrails/README.md#create) - Create a guardrail
* [listKeyAssignments](docs/sdks/guardrails/README.md#listkeyassignments) - List all key assignments
* [listMemberAssignments](docs/sdks/guardrails/README.md#listmemberassignments) - List all member assignments
* [get](docs/sdks/guardrails/README.md#get) - Get a guardrail
* [update](docs/sdks/guardrails/README.md#update) - Update a guardrail
* [delete](docs/sdks/guardrails/README.md#delete) - Delete a guardrail
* [listGuardrailKeyAssignments](docs/sdks/guardrails/README.md#listguardrailkeyassignments) - List key assignments for a guardrail
* [bulkAssignKeys](docs/sdks/guardrails/README.md#bulkassignkeys) - Bulk assign keys to a guardrail
* [bulkUnassignKeys](docs/sdks/guardrails/README.md#bulkunassignkeys) - Bulk unassign keys from a guardrail
* [listGuardrailMemberAssignments](docs/sdks/guardrails/README.md#listguardrailmemberassignments) - List member assignments for a guardrail
* [bulkAssignMembers](docs/sdks/guardrails/README.md#bulkassignmembers) - Bulk assign members to a guardrail
* [bulkUnassignMembers](docs/sdks/guardrails/README.md#bulkunassignmembers) - Bulk unassign members from a guardrail

### [Models](docs/sdks/models/README.md)

* [list](docs/sdks/models/README.md#list) - List all models and their properties

### [Observability](docs/sdks/observability/README.md)

* [list](docs/sdks/observability/README.md#list) - List observability destinations
* [create](docs/sdks/observability/README.md#create) - Create an observability destination
* [get](docs/sdks/observability/README.md#get) - Get an observability destination
* [update](docs/sdks/observability/README.md#update) - Update an observability destination
* [delete](docs/sdks/observability/README.md#delete) - Delete an observability destination

### [Organization](docs/sdks/organization/README.md)

* [listMembers](docs/sdks/organization/README.md#listmembers) - List organization members

### [Presets](docs/sdks/presets/README.md)

* [list](docs/sdks/presets/README.md#list) - List presets
* [get](docs/sdks/presets/README.md#get) - Get a preset
* [listVersions](docs/sdks/presets/README.md#listversions) - List versions of a preset
* [getVersion](docs/sdks/presets/README.md#getversion) - Get a specific version of a preset

### [PrivateEndpoints](docs/sdks/privateendpoints/README.md)

* [list](docs/sdks/privateendpoints/README.md#list) - List private endpoints
* [create](docs/sdks/privateendpoints/README.md#create) - Create a private endpoint
* [get](docs/sdks/privateendpoints/README.md#get) - Get a private endpoint
* [update](docs/sdks/privateendpoints/README.md#update) - Update a draft private endpoint
* [delete](docs/sdks/privateendpoints/README.md#delete) - Delete a private endpoint
* [activate](docs/sdks/privateendpoints/README.md#activate) - Activate a validated private endpoint
* [disable](docs/sdks/privateendpoints/README.md#disable) - Disable a private endpoint
* [enable](docs/sdks/privateendpoints/README.md#enable) - Enable a private endpoint
* [updatePricing](docs/sdks/privateendpoints/README.md#updatepricing) - Set private endpoint pricing
* [validate](docs/sdks/privateendpoints/README.md#validate) - Validate a draft private endpoint

### [Providers](docs/sdks/providers/README.md)

* [list](docs/sdks/providers/README.md#list) - List all providers

### [Scim](docs/sdks/scim/README.md)

* [listMappings](docs/sdks/scim/README.md#listmappings) - List SCIM group mappings
* [create](docs/sdks/scim/README.md#create) - Create a SCIM group mapping
* [read](docs/sdks/scim/README.md#read) - Get a SCIM group mapping
* [update](docs/sdks/scim/README.md#update) - Update a SCIM group mapping
* [delete](docs/sdks/scim/README.md#delete) - Delete a SCIM group mapping
* [listGroups](docs/sdks/scim/README.md#listgroups) - List SCIM groups
* [createSyncJob](docs/sdks/scim/README.md#createsyncjob) - Start a SCIM directory sync
* [getSyncJob](docs/sdks/scim/README.md#getsyncjob) - Get SCIM directory sync status

### [Workspaces](docs/sdks/workspaces/README.md)

* [list](docs/sdks/workspaces/README.md#list) - List workspaces
* [create](docs/sdks/workspaces/README.md#create) - Create a workspace
* [get](docs/sdks/workspaces/README.md#get) - Get a workspace
* [update](docs/sdks/workspaces/README.md#update) - Update a workspace
* [delete](docs/sdks/workspaces/README.md#delete) - Delete a workspace
* [listMembers](docs/sdks/workspaces/README.md#listmembers) - List workspace members
* [bulkAddMembers](docs/sdks/workspaces/README.md#bulkaddmembers) - Bulk add members to a workspace
* [bulkRemoveMembers](docs/sdks/workspaces/README.md#bulkremovemembers) - Bulk remove members from a workspace
* [listBudgets](docs/sdks/workspaces/README.md#listbudgets) - List workspace budgets
* [getBudget](docs/sdks/workspaces/README.md#getbudget) - Get a workspace budget
* [setBudget](docs/sdks/workspaces/README.md#setbudget) - Create or update a workspace budget
* [deleteBudget](docs/sdks/workspaces/README.md#deletebudget) - Delete a workspace budget

</details>
<!-- End Available Resources and Operations [operations] -->

<!-- Start Standalone functions [standalone-funcs] -->
## Standalone functions

All the methods listed above are available as standalone functions. These
functions are ideal for use in applications running in the browser, serverless
runtimes or other environments where application bundle size is a primary
concern. When using a bundler to build your application, all unused
functionality will be either excluded from the final bundle or tree-shaken away.

To read more about standalone functions, check [FUNCTIONS.md](./FUNCTIONS.md).

<details>

<summary>Available standalone functions</summary>

- [`analyticsGetAnalyticsMeta`](docs/sdks/analytics/README.md#getanalyticsmeta) - Get available analytics metrics and dimensions
- [`analyticsGetUserActivity`](docs/sdks/analytics/README.md#getuseractivity) - Get user activity grouped by endpoint
- [`analyticsQueryAnalytics`](docs/sdks/analytics/README.md#queryanalytics) - Query analytics data
- [`apiKeysCreate`](docs/sdks/apikeys/README.md#create) - Create a new API key
- [`apiKeysDelete`](docs/sdks/apikeys/README.md#delete) - Delete an API key
- [`apiKeysGet`](docs/sdks/apikeys/README.md#get) - Get a single API key
- [`apiKeysGetCurrentKeyMetadata`](docs/sdks/apikeys/README.md#getcurrentkeymetadata) - Get current API key
- [`apiKeysList`](docs/sdks/apikeys/README.md#list) - List API keys
- [`apiKeysUpdate`](docs/sdks/apikeys/README.md#update) - Update an API key
- [`byokCreate`](docs/sdks/byok/README.md#create) - Create a BYOK provider credential
- [`byokDelete`](docs/sdks/byok/README.md#delete) - Delete a BYOK provider credential
- [`byokGet`](docs/sdks/byok/README.md#get) - Get a BYOK provider credential
- [`byokList`](docs/sdks/byok/README.md#list) - List BYOK provider credentials
- [`byokUpdate`](docs/sdks/byok/README.md#update) - Update a BYOK provider credential
- [`creditsGetCredits`](docs/sdks/credits/README.md#getcredits) - Get remaining credits
- [`generationsGetGeneration`](docs/sdks/generations/README.md#getgeneration) - Get request & usage metadata for a generation
- [`generationsSubmitFeedback`](docs/sdks/generations/README.md#submitfeedback) - Submit feedback for a generation
- [`guardrailsBulkAssignKeys`](docs/sdks/guardrails/README.md#bulkassignkeys) - Bulk assign keys to a guardrail
- [`guardrailsBulkAssignMembers`](docs/sdks/guardrails/README.md#bulkassignmembers) - Bulk assign members to a guardrail
- [`guardrailsBulkUnassignKeys`](docs/sdks/guardrails/README.md#bulkunassignkeys) - Bulk unassign keys from a guardrail
- [`guardrailsBulkUnassignMembers`](docs/sdks/guardrails/README.md#bulkunassignmembers) - Bulk unassign members from a guardrail
- [`guardrailsCreate`](docs/sdks/guardrails/README.md#create) - Create a guardrail
- [`guardrailsDelete`](docs/sdks/guardrails/README.md#delete) - Delete a guardrail
- [`guardrailsGet`](docs/sdks/guardrails/README.md#get) - Get a guardrail
- [`guardrailsList`](docs/sdks/guardrails/README.md#list) - List guardrails
- [`guardrailsListGuardrailKeyAssignments`](docs/sdks/guardrails/README.md#listguardrailkeyassignments) - List key assignments for a guardrail
- [`guardrailsListGuardrailMemberAssignments`](docs/sdks/guardrails/README.md#listguardrailmemberassignments) - List member assignments for a guardrail
- [`guardrailsListKeyAssignments`](docs/sdks/guardrails/README.md#listkeyassignments) - List all key assignments
- [`guardrailsListMemberAssignments`](docs/sdks/guardrails/README.md#listmemberassignments) - List all member assignments
- [`guardrailsUpdate`](docs/sdks/guardrails/README.md#update) - Update a guardrail
- [`modelsList`](docs/sdks/models/README.md#list) - List all models and their properties
- [`observabilityCreate`](docs/sdks/observability/README.md#create) - Create an observability destination
- [`observabilityDelete`](docs/sdks/observability/README.md#delete) - Delete an observability destination
- [`observabilityGet`](docs/sdks/observability/README.md#get) - Get an observability destination
- [`observabilityList`](docs/sdks/observability/README.md#list) - List observability destinations
- [`observabilityUpdate`](docs/sdks/observability/README.md#update) - Update an observability destination
- [`organizationListMembers`](docs/sdks/organization/README.md#listmembers) - List organization members
- [`presetsGet`](docs/sdks/presets/README.md#get) - Get a preset
- [`presetsGetVersion`](docs/sdks/presets/README.md#getversion) - Get a specific version of a preset
- [`presetsList`](docs/sdks/presets/README.md#list) - List presets
- [`presetsListVersions`](docs/sdks/presets/README.md#listversions) - List versions of a preset
- [`privateEndpointsActivate`](docs/sdks/privateendpoints/README.md#activate) - Activate a validated private endpoint
- [`privateEndpointsCreate`](docs/sdks/privateendpoints/README.md#create) - Create a private endpoint
- [`privateEndpointsDelete`](docs/sdks/privateendpoints/README.md#delete) - Delete a private endpoint
- [`privateEndpointsDisable`](docs/sdks/privateendpoints/README.md#disable) - Disable a private endpoint
- [`privateEndpointsEnable`](docs/sdks/privateendpoints/README.md#enable) - Enable a private endpoint
- [`privateEndpointsGet`](docs/sdks/privateendpoints/README.md#get) - Get a private endpoint
- [`privateEndpointsList`](docs/sdks/privateendpoints/README.md#list) - List private endpoints
- [`privateEndpointsUpdate`](docs/sdks/privateendpoints/README.md#update) - Update a draft private endpoint
- [`privateEndpointsUpdatePricing`](docs/sdks/privateendpoints/README.md#updatepricing) - Set private endpoint pricing
- [`privateEndpointsValidate`](docs/sdks/privateendpoints/README.md#validate) - Validate a draft private endpoint
- [`providersList`](docs/sdks/providers/README.md#list) - List all providers
- [`scimCreate`](docs/sdks/scim/README.md#create) - Create a SCIM group mapping
- [`scimCreateSyncJob`](docs/sdks/scim/README.md#createsyncjob) - Start a SCIM directory sync
- [`scimDelete`](docs/sdks/scim/README.md#delete) - Delete a SCIM group mapping
- [`scimGetSyncJob`](docs/sdks/scim/README.md#getsyncjob) - Get SCIM directory sync status
- [`scimListGroups`](docs/sdks/scim/README.md#listgroups) - List SCIM groups
- [`scimListMappings`](docs/sdks/scim/README.md#listmappings) - List SCIM group mappings
- [`scimRead`](docs/sdks/scim/README.md#read) - Get a SCIM group mapping
- [`scimUpdate`](docs/sdks/scim/README.md#update) - Update a SCIM group mapping
- [`workspacesBulkAddMembers`](docs/sdks/workspaces/README.md#bulkaddmembers) - Bulk add members to a workspace
- [`workspacesBulkRemoveMembers`](docs/sdks/workspaces/README.md#bulkremovemembers) - Bulk remove members from a workspace
- [`workspacesCreate`](docs/sdks/workspaces/README.md#create) - Create a workspace
- [`workspacesDelete`](docs/sdks/workspaces/README.md#delete) - Delete a workspace
- [`workspacesDeleteBudget`](docs/sdks/workspaces/README.md#deletebudget) - Delete a workspace budget
- [`workspacesGet`](docs/sdks/workspaces/README.md#get) - Get a workspace
- [`workspacesGetBudget`](docs/sdks/workspaces/README.md#getbudget) - Get a workspace budget
- [`workspacesList`](docs/sdks/workspaces/README.md#list) - List workspaces
- [`workspacesListBudgets`](docs/sdks/workspaces/README.md#listbudgets) - List workspace budgets
- [`workspacesListMembers`](docs/sdks/workspaces/README.md#listmembers) - List workspace members
- [`workspacesSetBudget`](docs/sdks/workspaces/README.md#setbudget) - Create or update a workspace budget
- [`workspacesUpdate`](docs/sdks/workspaces/README.md#update) - Update a workspace

</details>
<!-- End Standalone functions [standalone-funcs] -->

<!-- Start Pagination [pagination] -->
## Pagination

Some of the endpoints in this SDK support pagination. To use pagination, you
make your SDK calls as usual, but the returned response object will also be an
async iterable that can be consumed using the [`for await...of`][for-await-of]
syntax.

[for-await-of]: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/for-await...of

Here's an example of one such pagination call:

```typescript
import { OpenRouterManagement } from "@openrouter-monorepo/management-sdk-generated";

const openRouterManagement = new OpenRouterManagement({
  bearerAuth: "<YOUR_BEARER_TOKEN_HERE>",
});

async function run() {
  const result = await openRouterManagement.byok.list({
    workspaceId: "550e8400-e29b-41d4-a716-446655440000",
    provider: "openai",
  });

  for await (const page of result) {
    console.log(page);
  }
}

run();

```
<!-- End Pagination [pagination] -->

<!-- Start Retries [retries] -->
## Retries

Some of the endpoints in this SDK support retries.  If you use the SDK without any configuration, it will fall back to the default retry strategy provided by the API.  However, the default retry strategy can be overridden on a per-operation basis, or across the entire SDK.

To change the default retry strategy for a single API call, simply provide a retryConfig object to the call:
```typescript
import { OpenRouterManagement } from "@openrouter-monorepo/management-sdk-generated";

const openRouterManagement = new OpenRouterManagement({
  bearerAuth: "<YOUR_BEARER_TOKEN_HERE>",
});

async function run() {
  const result = await openRouterManagement.analytics.getUserActivity(
    "2025-08-24T00:00:00Z",
    "abc123def456...",
    "user_abc123",
    "workspace",
    "550e8400-e29b-41d4-a716-446655440000",
    {
      retries: {
        strategy: "backoff",
        backoff: {
          initialInterval: 1,
          maxInterval: 50,
          exponent: 1.1,
          maxElapsedTime: 100,
        },
        retryConnectionErrors: false,
      },
    },
  );

  console.log(result);
}

run();

```

If you'd like to override the default retry strategy for all operations that support retries, you can provide a retryConfig at SDK initialization:
```typescript
import { OpenRouterManagement } from "@openrouter-monorepo/management-sdk-generated";

const openRouterManagement = new OpenRouterManagement({
  retryConfig: {
    strategy: "backoff",
    backoff: {
      initialInterval: 1,
      maxInterval: 50,
      exponent: 1.1,
      maxElapsedTime: 100,
    },
    retryConnectionErrors: false,
  },
  bearerAuth: "<YOUR_BEARER_TOKEN_HERE>",
});

async function run() {
  const result = await openRouterManagement.analytics.getUserActivity(
    "2025-08-24T00:00:00Z",
    "abc123def456...",
    "user_abc123",
    "workspace",
    "550e8400-e29b-41d4-a716-446655440000",
  );

  console.log(result);
}

run();

```
<!-- End Retries [retries] -->

<!-- Start Error Handling [errors] -->
## Error Handling

[`OpenRouterManagementError`](./src/models/errors/open-router-management-error.ts) is the base class for all HTTP error responses. It has the following properties:

| Property            | Type       | Description                                                                             |
| ------------------- | ---------- | --------------------------------------------------------------------------------------- |
| `error.message`     | `string`   | Error message                                                                           |
| `error.statusCode`  | `number`   | HTTP response status code eg `404`                                                      |
| `error.headers`     | `Headers`  | HTTP response headers                                                                   |
| `error.body`        | `string`   | HTTP body. Can be empty string if no body is returned.                                  |
| `error.rawResponse` | `Response` | Raw HTTP response                                                                       |
| `error.data$`       |            | Optional. Some errors may contain structured data. [See Error Classes](#error-classes). |

### Example
```typescript
import { OpenRouterManagement } from "@openrouter-monorepo/management-sdk-generated";
import * as errors from "@openrouter-monorepo/management-sdk-generated/models/errors";

const openRouterManagement = new OpenRouterManagement({
  bearerAuth: "<YOUR_BEARER_TOKEN_HERE>",
});

async function run() {
  try {
    const result = await openRouterManagement.analytics.getUserActivity(
      "2025-08-24T00:00:00Z",
      "abc123def456...",
      "user_abc123",
      "workspace",
      "550e8400-e29b-41d4-a716-446655440000",
    );

    console.log(result);
  } catch (error) {
    // The base class for HTTP error responses
    if (error instanceof errors.OpenRouterManagementError) {
      console.log(error.message);
      console.log(error.statusCode);
      console.log(error.body);
      console.log(error.headers);

      // Depending on the method different errors may be thrown
      if (error instanceof errors.BadRequestResponseError) {
        console.log(error.data$.error); // models.BadRequestResponseErrorData
        console.log(error.data$.userId); // string
        console.log(error.data$.openrouterMetadata); // { [k: string]: any }
      }
    }
  }
}

run();

```

### Error Classes
**Primary errors:**
* [`OpenRouterManagementError`](./src/models/errors/open-router-management-error.ts): The base class for HTTP error responses.
  * [`InternalServerResponseError`](./src/models/errors/internal-server-response-error.ts): Internal Server Error - Unexpected server error. Status code `500`.
  * [`UnauthorizedResponseError`](./src/models/errors/unauthorized-response-error.ts): Unauthorized - Authentication required or invalid credentials. Status code `401`. *

<details><summary>Less common errors (18)</summary>

<br />

**Network errors:**
* [`ConnectionError`](./src/models/errors/http-client-errors.ts): HTTP client was unable to make a request to a server.
* [`RequestTimeoutError`](./src/models/errors/http-client-errors.ts): HTTP request timed out due to an AbortSignal signal.
* [`RequestAbortedError`](./src/models/errors/http-client-errors.ts): HTTP request was aborted by the client.
* [`InvalidRequestError`](./src/models/errors/http-client-errors.ts): Any input used to create a request is invalid.
* [`UnexpectedClientError`](./src/models/errors/http-client-errors.ts): Unrecognised or unexpected error.


**Inherit from [`OpenRouterManagementError`](./src/models/errors/open-router-management-error.ts)**:
* [`NotFoundResponseError`](./src/models/errors/not-found-response-error.ts): Not Found - Resource does not exist. Status code `404`. Applicable to 52 of 72 methods.*
* [`BadRequestResponseError`](./src/models/errors/bad-request-response-error.ts): Bad Request - Invalid request parameters or malformed input. Status code `400`. Applicable to 43 of 72 methods.*
* [`ForbiddenResponseError`](./src/models/errors/forbidden-response-error.ts): Forbidden - Authentication successful but insufficient permissions. Status code `403`. Applicable to 29 of 72 methods.*
* [`ConflictResponseError`](./src/models/errors/conflict-response-error.ts): Conflict - Resource conflict or concurrent modification. Status code `409`. Applicable to 12 of 72 methods.*
* [`RequestTimeoutResponseError`](./src/models/errors/request-timeout-response-error.ts): Request Timeout - Operation exceeded time limit. Status code `408`. Applicable to 11 of 72 methods.*
* [`BadGatewayResponseError`](./src/models/errors/bad-gateway-response-error.ts): Bad Gateway - Provider/upstream API failure. Status code `502`. Applicable to 9 of 72 methods.*
* [`UnprocessableEntityResponseError`](./src/models/errors/unprocessable-entity-response-error.ts): Unprocessable Entity - Semantic validation failure. Status code `422`. Applicable to 8 of 72 methods.*
* [`TooManyRequestsResponseError`](./src/models/errors/too-many-requests-response-error.ts): Too Many Requests - Rate limit exceeded. Status code `429`. Applicable to 7 of 72 methods.*
* [`PaymentRequiredResponseError`](./src/models/errors/payment-required-response-error.ts): Payment Required - Insufficient credits or quota to complete request. Status code `402`. Applicable to 1 of 72 methods.*
* [`CreatePrivateEndpointValidationFailedResponseError`](./src/models/errors/create-private-endpoint-validation-failed-response-error.ts): Applicable to 1 of 72 methods.*
* [`EdgeNetworkTimeoutResponseError`](./src/models/errors/edge-network-timeout-response-error.ts): Infrastructure Timeout - Provider request timed out at edge network. Status code `524`. Applicable to 1 of 72 methods.*
* [`ProviderOverloadedResponseError`](./src/models/errors/provider-overloaded-response-error.ts): Provider Overloaded - Provider is temporarily overloaded. Status code `529`. Applicable to 1 of 72 methods.*
* [`ResponseValidationError`](./src/models/errors/response-validation-error.ts): Type mismatch between the data returned from the server and the structure expected by the SDK. See `error.rawValue` for the raw value and `error.pretty()` for a nicely formatted multi-line string.

</details>

\* Check [the method documentation](#available-resources-and-operations) to see if the error is applicable.
<!-- End Error Handling [errors] -->

<!-- Start Server Selection [server] -->
## Server Selection

### Override Server URL Per-Client

The default server can be overridden globally by passing a URL to the `serverURL: string` optional parameter when initializing the SDK client instance. For example:
```typescript
import { OpenRouterManagement } from "@openrouter-monorepo/management-sdk-generated";

const openRouterManagement = new OpenRouterManagement({
  serverURL: "https://openrouter.ai/api/v1",
  bearerAuth: "<YOUR_BEARER_TOKEN_HERE>",
});

async function run() {
  const result = await openRouterManagement.analytics.getUserActivity(
    "2025-08-24T00:00:00Z",
    "abc123def456...",
    "user_abc123",
    "workspace",
    "550e8400-e29b-41d4-a716-446655440000",
  );

  console.log(result);
}

run();

```
<!-- End Server Selection [server] -->

<!-- Start Custom HTTP Client [http-client] -->
## Custom HTTP Client

The TypeScript SDK makes API calls using an `HTTPClient` that wraps the native
[Fetch API](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API). This
client is a thin wrapper around `fetch` and provides the ability to attach hooks
around the request lifecycle that can be used to modify the request or handle
errors and response.

The `HTTPClient` constructor takes an optional `fetcher` argument that can be
used to integrate a third-party HTTP client or when writing tests to mock out
the HTTP client and feed in fixtures.

The following example shows how to:
- route requests through a proxy server using [undici](https://www.npmjs.com/package/undici)'s ProxyAgent
- use the `"beforeRequest"` hook to add a custom header and a timeout to requests
- use the `"requestError"` hook to log errors

```typescript
import { OpenRouterManagement } from "@openrouter-monorepo/management-sdk-generated";
import { ProxyAgent } from "undici";
import { HTTPClient } from "@openrouter-monorepo/management-sdk-generated/lib/http";

const dispatcher = new ProxyAgent("http://proxy.example.com:8080");

const httpClient = new HTTPClient({
  // 'fetcher' takes a function that has the same signature as native 'fetch'.
  fetcher: (input, init) =>
    // 'dispatcher' is specific to undici and not part of the standard Fetch API.
    fetch(input, { ...init, dispatcher } as RequestInit),
});

httpClient.addHook("beforeRequest", (request) => {
  const nextRequest = new Request(request, {
    signal: request.signal || AbortSignal.timeout(5000)
  });

  nextRequest.headers.set("x-custom-header", "custom value");

  return nextRequest;
});

httpClient.addHook("requestError", (error, request) => {
  console.group("Request Error");
  console.log("Reason:", `${error}`);
  console.log("Endpoint:", `${request.method} ${request.url}`);
  console.groupEnd();
});

const sdk = new OpenRouterManagement({ httpClient: httpClient });
```
<!-- End Custom HTTP Client [http-client] -->

<!-- Start Debugging [debug] -->
## Debugging

You can setup your SDK to emit debug logs for SDK requests and responses.

You can pass a logger that matches `console`'s interface as an SDK option.

> [!WARNING]
> Beware that debug logging will reveal secrets, like API tokens in headers, in log messages printed to a console or files. It's recommended to use this feature only during local development and not in production.

```typescript
import { OpenRouterManagement } from "@openrouter-monorepo/management-sdk-generated";

const sdk = new OpenRouterManagement({ debugLogger: console });
```
<!-- End Debugging [debug] -->

<!-- Placeholder for Future Speakeasy SDK Sections -->

# Development

## Maturity

This SDK is in beta, and there may be breaking changes between versions without a major version update. Therefore, we recommend pinning usage
to a specific package version. This way, you can install the same version each time without breaking changes unless you are intentionally
looking for the latest version.

## Contributions

While we value open-source contributions to this SDK, this library is generated programmatically. Any manual changes added to internal files will be overwritten on the next generation. 
We look forward to hearing your feedback. Feel free to open a PR or an issue with a proof of concept and we'll do our best to include it in a future release. 

### SDK Created by [Speakeasy](https://www.speakeasy.com/?utm_source=@openrouter-monorepo/management-sdk-generated&utm_campaign=typescript)
