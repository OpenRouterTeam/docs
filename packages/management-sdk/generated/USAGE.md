<!-- Start SDK Example Usage [usage] -->
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