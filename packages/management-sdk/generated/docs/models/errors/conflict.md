# Conflict

The request conflicts with the endpoint state, such as a stale validation. When `activate` was passed and the draft was created, `data` carries it and any validation checks.


## Supported Types

### `errors.CreatePrivateEndpointValidationFailedResponseError`

```typescript
const value: errors.CreatePrivateEndpointValidationFailedResponseError = {
  error: {
    code: 736672,
    message: "<value>",
  },
  data: {
    endpoint: {
      id: "5b1c4c4e-7d0a-4a8e-9f3a-2d6c1b0e8a11",
      status: "active",
      modelPermaslug: "openai/gpt-4o-2024-08-06",
      modelSlug: "openai/gpt-4o",
      modelName: "OpenAI: GPT-4o",
      providerName: "Azure",
      createdAt: "2026-09-24T10:30:00Z",
      declaredZdr: true,
      declaredRegion: "us",
    },
    validation: {
      passed: true,
      checks: [
        {
          name: "auth_ok",
          passed: true,
        },
      ],
    },
  },
};
```

### `errors.ConflictResponseError`

```typescript
const value: errors.ConflictResponseError = {
  error: {
    code: 409,
    message: "Resource conflict. Please try again later.",
  },
};
```

