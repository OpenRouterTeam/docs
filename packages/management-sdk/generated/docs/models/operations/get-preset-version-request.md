# GetPresetVersionRequest

## Example Usage

```typescript
import { GetPresetVersionRequest } from "@openrouter-monorepo/management-sdk-generated/models/operations";

let value: GetPresetVersionRequest = {
  slug: "my-preset",
  version: "1",
};
```

## Fields

| Field                                 | Type                                  | Required                              | Description                           | Example                               |
| ------------------------------------- | ------------------------------------- | ------------------------------------- | ------------------------------------- | ------------------------------------- |
| `slug`                                | *string*                              | :heavy_check_mark:                    | URL-safe slug identifying the preset. | my-preset                             |
| `version`                             | *string*                              | :heavy_check_mark:                    | Version number of the preset.         | 1                                     |