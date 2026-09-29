# ContentFilterEntry

A custom regex content filter that scans request messages for matching patterns.

## Example Usage

```typescript
import { ContentFilterEntry } from "@openrouter-monorepo/management-sdk-generated/models";

let value: ContentFilterEntry = {
  pattern: "\\b(sk-[a-zA-Z0-9]{48})\\b",
  action: "redact",
  label: "[API_KEY]",
};
```

## Fields

| Field                                                            | Type                                                             | Required                                                         | Description                                                      | Example                                                          |
| ---------------------------------------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------- |
| `pattern`                                                        | *string*                                                         | :heavy_check_mark:                                               | A regex pattern to match against request content                 | \b(sk-[a-zA-Z0-9]{48})\b                                         |
| `action`                                                         | [models.ContentFilterAction](../models/content-filter-action.md) | :heavy_check_mark:                                               | Action taken when the pattern matches                            | block                                                            |
| `label`                                                          | *string*                                                         | :heavy_minus_sign:                                               | Optional label used in redaction placeholders or error messages  | [API_KEY]                                                        |