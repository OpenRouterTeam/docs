# ListProvidersResponse

Returns a list of providers

## Example Usage

```typescript
import { ListProvidersResponse } from "@openrouter-monorepo/management-sdk-generated/models/operations";

let value: ListProvidersResponse = {
  data: [
    {
      name: "OpenAI",
      slug: "openai",
      privacyPolicyUrl: "https://openai.com/privacy",
      termsOfServiceUrl: "https://openai.com/terms",
      statusPageUrl: "https://status.openai.com",
      headquarters: "US",
      datacenters: [
        "US",
        "IE",
      ],
    },
  ],
};
```

## Fields

| Field                                                                            | Type                                                                             | Required                                                                         | Description                                                                      |
| -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `data`                                                                           | [operations.ListProvidersData](../../models/operations/list-providers-data.md)[] | :heavy_check_mark:                                                               | N/A                                                                              |