# TimeRange

## Example Usage

```typescript
import { TimeRange } from "@openrouter-monorepo/management-sdk-generated/models/operations";

let value: TimeRange = {
  start: new Date("2027-12-31T23:59:59Z"),
  end: new Date("2027-12-31T23:59:59Z"),
};
```

## Fields

| Field                                                                                                                                      | Type                                                                                                                                       | Required                                                                                                                                   | Description                                                                                                                                | Example                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `start`                                                                                                                                    | [Date](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Date)                                              | :heavy_check_mark:                                                                                                                         | ISO 8601 UTC timestamp. Must include seconds (YYYY-MM-DDTHH:MM:SSZ; fractional seconds allowed); minute-precision timestamps are rejected. | 2027-12-31 23:59:59 +0000 UTC                                                                                                              |
| `end`                                                                                                                                      | [Date](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Date)                                              | :heavy_check_mark:                                                                                                                         | ISO 8601 UTC timestamp. Must include seconds (YYYY-MM-DDTHH:MM:SSZ; fractional seconds allowed); minute-precision timestamps are rejected. | 2027-12-31 23:59:59 +0000 UTC                                                                                                              |