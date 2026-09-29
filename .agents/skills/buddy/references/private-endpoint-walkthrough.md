# Walkthrough — Private Endpoint for an Enterprise Customer

Use this when a non-engineer (sales, solutions, support, partnerships) asks for a private endpoint for an enterprise customer.

You do the technical work. The person supplies customer facts and approves each write. They should not need to read code, run commands, or know internal terms.

## What you are building

A **private endpoint** is a provider deployment that only an approved customer can use. It does not appear as a public provider option. A request from anyone outside the access list cannot use it.

Every endpoint in this walkthrough is:

- **Private** — only the customer's organization can use it.
- **BYOK-only** — the customer supplies the provider API key. The provider bills the customer under their direct agreement. OpenRouter BYOK charges do not apply to this flow.
- **Hidden at first** — it stays switched off until a person explicitly approves publishing it.

## How to talk to the person

Assume they do not know the codebase.

- Use short sentences. Use one idea per sentence.
- Explain internal terms or replace them with plain language.
- Never make them read a raw request body. Show a short summary table. Show the exact request only if they ask.
- Never blame them for missing information. Tell them where to find it.

| Internal term | Plain language |
|---|---|
| permaslug / slug | the model name used on OpenRouter, such as `anthropic/claude-sonnet-4.5` |
| Clerk org ID / entity ID | the customer's organization ID, which starts with `org_` |
| private access grant / ACL | the access list |
| BYOK-only | the customer uses their own provider API key |
| hidden | switched off |
| unhide / publish | turn it on for the customer |
| staging the endpoint | setting it up |
| endpoint UUID | the setup reference ID |

## Rule: every reply ends with the next step

Every reply in this walkthrough must end with:

**Next step:** one clear action.

If the agent (Buddy or Devin) owns the action, say that no action is needed from the user. If another team owns it, name that team and state what to request.

## The four stages

Show the current stage at the top of every reply, such as `Stage 1 of 4 — Gathering Information`.

1. **Gathering Information** — collect and confirm the facts.
2. **Staging Endpoint** — create the endpoint, switched off.
3. **Publishing Endpoint** — get explicit approval, then turn it on.
4. **Testing Endpoint** — the customer tests with their provider key.

Do not skip a stage. Finish and report one stage before moving to the next.

## Stage 1 — Gathering Information

Ask for all facts in one short checklist.

| # | What you need | Why | Example |
|---|---|---|---|
| 1 | The model name used on OpenRouter | The model must already exist | `anthropic/claude-sonnet-4.5` |
| 2 | The provider whose key the customer will use | The saved key and endpoint provider must match | Anthropic, Azure, Amazon Bedrock, Google Vertex |
| 3 | The customer's organization ID | This controls access | starts with `org_` |
| 4 | The customer and purpose | This identifies the setup later | "Acme Corp, enterprise pilot" |
| 5 | Whether the provider and customer confirmed zero data retention (ZDR) | Never assume a retention promise | "Both confirmed" or "not confirmed" |
| 6 | Any promised feature that must be tested | A normal response does not prove a special feature | prompt caching, tool calling, usage reporting |

### Hard gate — the provider must already exist

Confirm that OpenRouter already has the named provider. Do not create a provider, substitute a generic provider, or map the request to a similar provider.

If the provider does not exist, stop and say:

> OpenRouter does not have PROVIDER yet. This walkthrough cannot add a provider or
> choose a substitute. Provider ops must decide how to onboard it.
>
> **Next step:** ask provider ops whether OpenRouter can onboard PROVIDER for this
> customer.

### Hard gate — the model must already exist for that provider

Confirm that the provider already serves the model, using the resolution recipe in [`find-endpoint.md`](find-endpoint.md).

If a matching endpoint exists, record its reference ID. The endpoint workflow will use it as the source configuration.

If no matching endpoint exists, stop. Tell the user to ask provider ops whether that model can be supported on the requested provider. Do not offer to create the model or use a close substitute unless the user asks for alternatives.

A request for a new private model identity is also outside this GTM walkthrough. After provider ops approves that work, the technical implementation must use [`private-models.md`](private-models.md) to create the model and [`private-endpoints.md`](private-endpoints.md) to attach the deployment. Do not duplicate either reference's model or endpoint logic here.

### Check the provider key match

The customer's key must belong to the endpoint provider. An Azure key cannot route to an Anthropic-direct endpoint. If the names differ, stop and ask which one is correct.

### Help find the organization ID

Use [`private-endpoint-intake.md`](private-endpoint-intake.md). The short version: open `https://internal.openrouter.ai/organization`, search for the customer's work email or domain, and copy the **Org ID** value.

Do not guess an ID or accept a company name as a substitute. An enterprise organization ID normally starts with `org_`. Confirm intent before accepting a `user_` ID because that grants access to one person, not the company.

### Finish Stage 1

Read back the model, provider, organization ID, customer, ZDR status, and special test requirements. Ask the user to confirm or correct the summary.

**Next step:** confirm the summary or state what needs correction.

## Stage 2 — Staging Endpoint

Start only after the Stage 1 summary is confirmed.

### Delegate the mechanics

Use the existing references instead of rebuilding their logic:

- [`private-models.md`](private-models.md) owns private model creation. This walkthrough normally does not need it because the model must already exist. Provider ops must approve any exception first.
- [`private-endpoints.md`](private-endpoints.md) owns provider resolution, source configuration, request construction, pricing-version creation, preview, creation, verification, and private-endpoint publishing.
- [`data-policies.md`](data-policies.md) owns live data-policy lookup. Never copy a policy ID into this file.
- [`../../onboard-private-byok-model/SKILL.md`](../../onboard-private-byok-model/SKILL.md) owns the underlying engineer-facing private BYOK onboarding rules.

This walkthrough owns only the conversation, GTM defaults, approval gates, escalation rules, and customer handoff. If an authority above changes, follow that authority instead of the duplicated prose here.

Pass these confirmed constraints into the private endpoint flow:

| Constraint | Required value |
|---|---|
| Privacy | private |
| Access | the confirmed customer organization ID |
| Authentication | BYOK-only for the confirmed provider |
| Initial visibility | hidden |
| Endpoint pricing | preserve the source SKU keys, priced at the public list rate for the same model on the same provider (or a supplied negotiated rate) |
| Pricing variant | `standard` |
| Discount | do not copy `discount_to_user` |
| Data-policy override | unset unless ZDR is explicitly confirmed |

Reference pricing is required even though the provider bills the customer directly: the values drive OpenRouter's cut, the customer's upstream cost reporting, spend budgets, and baseline auto-unhide, all of which break on zeros. See [`guardrails.md`](guardrails.md) → Private / BYOK staging invariants Rule 2. If the user asks for zeros, discounts, credits, or another commercial exception, stop and ask the account owner to define the intended setup.

### ZDR gate

BYOK does not imply ZDR. A customer-owned key changes authentication, not retention.

- Ask whether both the provider and customer confirmed ZDR for this deployment.
- If not confirmed, leave the endpoint override unset. Report the effective provider policy without calling it ZDR unless it is ZDR.
- If confirmed, use `data-policy` to find a live policy with `retains_prompts: false`. Do not hardcode its ID.
- Include the selected policy and effective retention state in the endpoint preview.
- After creation, verify the effective policy. Keep the endpoint hidden and escalate to engineering if it is wrong.
- Escalate video-output ZDR requests because current routing cannot represent them as ZDR.

### Approval before creation

Endpoint creation cannot be undone. Follow the preview and approval process in [`private-endpoints.md`](private-endpoints.md) and the preview gate.

Show a plain-language summary with:

- model and provider
- customer organization
- BYOK-only and hidden status
- the reference rate for each key in the complete source SKU set
- effective data policy and any confirmed ZDR override
- Mission Control link from the preview

Then ask for explicit approval. Approval to gather information is not approval to create. Do not write until the user chooses the explicit create option.

### Finish Stage 2

After creation, verify the endpoint per [`private-endpoints.md`](private-endpoints.md). Report its reference ID, Mission Control link, private status, access organization, BYOK-only status, hidden status, pricing, and effective data policy.

The customer cannot use it while it is hidden.

**Next step:** review the staged endpoint summary and decide whether to approve publishing it for customer testing.

## Stage 3 — Publishing Endpoint

Publishing makes the endpoint available to the granted organization. The customer still needs the matching provider key and organization context.

### Approval rules

- Never publish without new, explicit approval.
- Creation approval is not publishing approval.
- Do not treat silence, an unrelated reaction, or vague wording as approval.
- Before asking, show `hidden: true → false`, confirm privacy and the access list stay unchanged, and include the Mission Control link.
- State that formal end-to-end testing happens after publishing with the customer's key.

Ask with clear choices such as:

- `Yes — publish it for customer testing`
- `Not yet — leave it switched off`
- `I have a question first`

Stop after asking. Do not publish until the user selects the explicit approval.

### Delegate publishing

Use the direct-unhide procedure in [`private-endpoints.md`](private-endpoints.md). Do not use `baseline-unhide`, public activation logic, or a hand-written publish request. Preview the change, preserve privacy and grants, apply only after approval, then read the endpoint back to verify it is visible only to the granted customer.

### Customer test handoff

After publishing, include the model name and send this concise, copy-paste message:

> Please test MODEL from the OpenRouter organization that received access.
> 1. Select that organization in OpenRouter.
> 2. In Settings → Integrations, save your PROVIDER API key for that same
>    organization. Enabling the provider alone does not save a key.
> 3. Use an OpenRouter API key created for that organization and make one small
>    request with `model: "MODEL"`.
> 4. Send us the response status and body, or the exact error text. Also send the
>    evidence for SPECIAL_REQUIREMENT, if applicable.
> The first call to an idle dedicated deployment can take one or two minutes.

Do not ask the customer to share their provider key. Nobody at OpenRouter needs to see or enter it.

Report that the endpoint is live for customer testing. Include its Mission Control link and state that Buddy or Devin can hide it again if needed.

**Next step:** send the test instructions to the customer and bring back their exact result.

## Stage 4 — Testing Endpoint

The customer runs this stage because OpenRouter does not have their provider key. Neither Buddy nor Devin can prove the BYOK route with an internal platform credential.

Use [`private-endpoint-testing.md`](private-endpoint-testing.md) to guide the handoff, interpret the response, and request evidence for promised features.

### Report the result

- A successful basic response confirms organization access, provider-key matching, and the upstream deployment path.
- Test every promised feature separately. A normal chat response does not prove prompt-cache passthrough, cached-token usage, tool calling, or another special requirement.
- Ask for exact error text, status, and response body on failure. Do not ask for the provider key or other secrets.
- If the result shows an access or key mismatch, guide the customer through the checks in the testing reference.
- If the provider returns an upstream error, escalate with the endpoint reference ID and sanitized response details.
- If a basic call fails, do not call the setup complete. Offer to hide the endpoint while the team investigates.

When all required tests pass, summarize what was proven and any limitation that remains.

**Next step:** record the customer validation result and close the onboarding only when every promised requirement has passed.

## Never do these things

- Never create, publish, or change a provider, model, or endpoint without its exact preview, Mission Control link, and explicit human approval.
- Never guess an organization ID, model, provider, policy ID, or provider key.
- Never proceed with placeholder values.
- Never create or substitute a provider. Escalate a new provider to provider ops.
- Never improvise private-model or private-endpoint mechanics. Follow [`private-models.md`](private-models.md) and [`private-endpoints.md`](private-endpoints.md).
- Never publish with an empty access list.
- Never claim BYOK implies ZDR.
- Never change an existing public endpoint as a shortcut.
- Never request or display the customer's provider key.
- Never end a reply without a next step.

## Escalation table

| Situation | Owner | Request |
|---|---|---|
| Provider does not exist in OpenRouter | Provider ops | Decide whether and how to onboard the provider |
| Provider exists but does not serve the requested model | Provider ops | Decide whether that provider-model deployment can be supported |
| A new private model identity is required | Provider ops, then engineering | Approve the design; engineering follows the private model and private endpoint references |
| Zero pricing, a discount, or another commercial exception is requested | Account owner | Define the intended commercial setup |
| ZDR is requested but not confirmed | Provider ops and customer owner | Confirm retention for this deployment |
| Customer basic test fails after access and key checks | Engineering | Investigate using the endpoint reference ID and sanitized error |
| Endpoint must be switched off urgently | Engineering, Buddy, or Devin | Hide the endpoint using its reference ID |

## Reference

- [`private-endpoint-intake.md`](private-endpoint-intake.md) — find the customer organization and explain where the customer saves a provider key.
- [`private-endpoint-testing.md`](private-endpoint-testing.md) — post-publish customer test and failure guide.
- [`private-models.md`](private-models.md) — authority for creating a private model identity after provider-ops approval.
- [`private-endpoints.md`](private-endpoints.md) — authority for private endpoint staging and publishing.
- [`../../onboard-private-byok-model/SKILL.md`](../../onboard-private-byok-model/SKILL.md) — engineer-facing source for onboarding and failure diagnosis.
- [`data-policies.md`](data-policies.md) — live data-policy lookup.
- [`find-endpoint.md`](find-endpoint.md) — resolve the requested provider and model.
- [`guardrails.md`](guardrails.md) → Preview gate — mandatory preview, approval, and Mission Control link for every write.
