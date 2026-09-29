# Private Endpoint Testing — customer validation

The customer runs this test after publishing. They must use their own provider key and the same OpenRouter organization that received access.

## What this test proves

A successful customer call proves that all three identities line up:

1. The endpoint access list includes the organization making the request.
2. The OpenRouter API key belongs to that organization.
3. The saved provider key belongs to that organization and matches the endpoint provider.

Neither Buddy nor Devin can prove this route with an internal test. OpenRouter does not have the customer's provider key, and an internal platform credential does not test the customer's organization or saved-key selection.

## Copy-paste customer instructions

Replace the capitalized values before sending this message:

> Please test MODEL from the OpenRouter organization that received access.
> 1. Select that organization in OpenRouter.
> 2. In Settings → Integrations, save your PROVIDER API key for that same
>    organization. Enabling the provider alone does not save a key.
> 3. Create or use an OpenRouter API key for that organization.
> 4. Make one small request to `/api/v1/chat/completions` with
>    `model: "MODEL"`.
> 5. Send us the response status and body, or the exact error text. Also send the
>    requested evidence for SPECIAL_REQUIREMENT, if applicable.
> The first call to an idle dedicated deployment can take one or two minutes.

Never ask the customer to send their provider key. If they need help saving it, point them to `https://openrouter.ai/integrations` after they select the correct organization.

## Before the customer tests

Confirm these facts without requesting secret values:

- The endpoint is published, private, and BYOK-only.
- Its access list contains the intended organization ID.
- The customer selected that same organization in OpenRouter.
- The customer saved a key for the endpoint provider under that organization.
- The OpenRouter API key used for the call belongs to that organization.
- Any restrictions on the saved provider key allow this model and API key.
- The customer is using the OpenRouter model name, not the provider's upstream deployment name.

Mission Control shows a masked **Provider API Keys** entry on the organization page. It can confirm that a provider key record exists. It cannot reveal or validate the secret.

## Ask for exact evidence

For a basic test, request:

- response status
- response body or exact error text
- request ID, if returned
- provider-side request or log reference, if available

For a promised feature, request evidence specific to that feature. Examples:

| Requirement | Evidence |
|---|---|
| Prompt-cache key passthrough | Provider log or request trace showing the field arrived |
| Cached-token usage | OpenRouter usage response and provider usage showing cached tokens |
| Tool calling | Response containing the expected tool call |
| Structured output | Response matching the required schema |
| Custom rate limit | Provider or OpenRouter evidence at the agreed limit |

A normal text response proves only the basic route. It does not prove a special feature.

## Interpret common failures

| Customer result | Likely cause | Check next |
|---|---|---|
| `No endpoints found for MODEL` | The endpoint was filtered out because it is hidden, the organization does not match, the provider key is missing, or key restrictions reject the request | Confirm publish state, organization ID, provider-key record, and saved-key restrictions |
| `MODEL is not a valid model ID` or similar | The request uses the wrong model name or the requesting organization lacks model access | Confirm the exact OpenRouter model name and organization context |
| Missing or rejected provider-key error | No key is saved for this provider, the key belongs to another organization, or the provider rejected it | Save or replace the key under the granted organization; do not send it to OpenRouter staff |
| Provider-worded model, deployment, region, or permission error | OpenRouter reached the provider, but the upstream deployment or account rejected the request | Ask provider ops or engineering to compare the deployment configuration and provider logs |
| First call appears slow | An idle dedicated deployment may be starting | Allow one or two minutes, then retry once |
| Basic call works but a promised feature does not | The route works, but the provider, adapter, or configuration does not support the feature as expected | Escalate with feature-specific evidence and the endpoint reference ID |

Do not paraphrase an error before diagnosis. Exact wording helps distinguish access, key selection, and upstream failures. Remove tokens, keys, personal data, and prompt content before sharing logs.

## Reporting back to the GTM user

Use a short result summary:

> Customer validation result:
> - Basic request — passed or failed
> - Organization access — confirmed or unresolved
> - Provider-key route — confirmed or unresolved
> - PROMISED_FEATURE — passed, failed, or not tested
> - Follow-up — owner and action

If a basic call fails, do not call the onboarding complete. Offer to hide the endpoint while engineering investigates. Any endpoint change still requires the normal preview, Mission Control link, and explicit approval.

**Next step:** obtain the customer's exact result and verify each promised feature before closing the onboarding.
