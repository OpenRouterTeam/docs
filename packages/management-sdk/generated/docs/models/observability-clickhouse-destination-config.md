# ObservabilityClickhouseDestinationConfig

## Example Usage

```typescript
import { ObservabilityClickhouseDestinationConfig } from "@openrouter-monorepo/management-sdk-generated/models";

let value: ObservabilityClickhouseDestinationConfig = {
  host: "evil-airbus.net",
  database: "<value>",
  username: "Meaghan5",
  password: "WoWiZp9fa9CJos7",
};
```

## Fields

| Field                                                                                  | Type                                                                                   | Required                                                                               | Description                                                                            |
| -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `host`                                                                                 | *string*                                                                               | :heavy_check_mark:                                                                     | N/A                                                                                    |
| `database`                                                                             | *string*                                                                               | :heavy_check_mark:                                                                     | N/A                                                                                    |
| `table`                                                                                | *string*                                                                               | :heavy_minus_sign:                                                                     | N/A                                                                                    |
| `username`                                                                             | *string*                                                                               | :heavy_check_mark:                                                                     | If you have not set a specific username in ClickHouse, simply type in 'default' below. |
| `password`                                                                             | *string*                                                                               | :heavy_check_mark:                                                                     | N/A                                                                                    |
| `headers`                                                                              | Record<string, *string*>                                                               | :heavy_minus_sign:                                                                     | Custom HTTP headers to include in requests to this destination.                        |