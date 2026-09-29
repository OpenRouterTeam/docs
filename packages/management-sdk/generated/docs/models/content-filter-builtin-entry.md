# ContentFilterBuiltinEntry

A builtin content filter entry. Builtin filters include PII detectors, API-key and secret detectors, and the regex-based prompt injection detector.

## Example Usage

```typescript
import { ContentFilterBuiltinEntry } from "@openrouter-monorepo/management-sdk-generated/models";

let value: ContentFilterBuiltinEntry = {
  slug: "email",
  action: "redact",
  label: "[EMAIL]",
};
```

## Fields

| Field                                                                                                                           | Type                                                                                                                            | Required                                                                                                                        | Description                                                                                                                     | Example                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `slug`                                                                                                                          | [models.ContentFilterBuiltinSlug](../models/content-filter-builtin-slug.md)                                                     | :heavy_check_mark:                                                                                                              | The builtin filter identifier                                                                                                   | regex-prompt-injection                                                                                                          |
| `action`                                                                                                                        | [models.ContentFilterBuiltinAction](../models/content-filter-builtin-action.md)                                                 | :heavy_check_mark:                                                                                                              | Action taken when the builtin filter triggers                                                                                   | block                                                                                                                           |
| `label`                                                                                                                         | *string*                                                                                                                        | :heavy_minus_sign:                                                                                                              | Read-only, system-assigned redaction placeholder derived from the slug (e.g. "[EMAIL]", "[PHONE]"). Not settable by the caller. | [EMAIL]                                                                                                                         |
| `scanScope`                                                                                                                     | [models.PromptInjectionScanScope](../models/prompt-injection-scan-scope.md)                                                     | :heavy_minus_sign:                                                                                                              | Which message roles to scan for prompt injection. Only applies to the regex-prompt-injection builtin. Defaults to all_messages. | user_only                                                                                                                       |