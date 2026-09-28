# Public Status Page Templates

For publishing steps, see [Publish a Status Page Notice](./publish-status-page.md).

## Template guidance

For issue and impact placeholders, describe what customers experience:

- **Services:**
  - use customer-facing functions, such as API requests, account sign-in, or credit purchases
  - not internal workers, databases, or routing services.
- **Models:**
  - use the public model name or model ID shown on OpenRouter,
  - only when impact to that model is confirmed.
  - Do not use internal deployment or endpoint IDs.
- **Scope unclear:** describe the known symptom without guessing which services or models are affected.

Examples: `increased errors on API requests`, `failed credit purchases`, or `delayed responses from [public model name]`.

## Investigating

```text
We are investigating [customer-visible issue].
```

## Identified — mitigation underway

```text
We have identified the issue and are working to restore normal operation. Customers may continue to experience [current impact].
```

## Monitoring — verifying recovery

```text
We have taken steps to address the issue and are seeing recovery. We are monitoring to confirm stability. [Any remaining customer impact].
```

## Resolved — recovery verified

```text
The issue has been resolved. Between [start time UTC] and [end time UTC], customers experienced [impact]. Normal operation has been restored.
```
