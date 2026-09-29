# Private Endpoint Intake — how to find the information

Everything here is written so you can paste it straight to the person you are helping. It assumes they have Mission Control access and nothing else.

Mission Control is the internal admin site: `https://internal.openrouter.ai`

> Note for you, not for them: the Mission Control search box (Cmd+K) only finds
> admin pages. It does **not** find customers. Do not tell them to use it to look
> up an organization.

## Finding the customer's organization ID

This is the single most common blocker. Paste this:

> 1. Open `https://internal.openrouter.ai/organization` — the page is titled
>    **Org Search**.
> 2. In the search box, type any one of these:
>    - the customer's work email, for example `jane@acme.com`
>    - just their email domain, for example `acme.com`
>    - the company name as it appears in OpenRouter
> 3. Press search. You need at least 3 characters.
> 4. In the results table, find the row for the right company and look at the
>    **Org ID** column. It starts with `org_`.
> 5. Click the Org ID to copy it, and paste it back to me.

If they get several results and are not sure which is right, tell them to click a row. That opens the organization page, where they can check the members and usage to confirm it is the right company.

If they get no results, the company probably has no OpenRouter organization yet. That is a real blocker: a private endpoint needs an organization to grant access to. Their next step is to get the customer to create an organization in OpenRouter and invite their team, then come back with the ID.

### Do not accept these instead of an organization ID

| They give you | Why it is not enough |
|---|---|
| An email address | Access is granted to an organization, not an inbox |
| A company name | Two companies can have similar names |
| An ID starting with `user_` | That is one person's personal account, not the company. Their teammates would be locked out |
| "Just use whatever you find" | Guessing here means either nobody can use the endpoint, or the wrong company can |

## Finding the model name

You can usually do this yourself with `find-endpoint`. If you need them to check:

> Open `https://openrouter.ai/models`, search for the model, and open its page.
> The name in the URL after `openrouter.ai/` is the model's name on OpenRouter, for
> example `anthropic/claude-sonnet-4.5`. Send me that.

The model page also lists every provider that serves it, which answers the "which provider" question at the same time.

## Checking whether the customer has already added their own provider key

Worth checking before you publish, because a missing key is the most common reason a customer says "it does not work".

> 1. Open `https://internal.openrouter.ai/organization` and search for the
>    customer, then click their row to open their organization page.
> 2. Scroll to the **Provider API Keys** card.
> 3. Check whether there is a key listed for the provider we are using.

The card only shows masked labels and status — it never shows the secret, and nobody at OpenRouter can read or enter the customer's key. Adding the key is something the customer does themselves, at:

`https://openrouter.ai/integrations`

If they need to send the customer instructions, this works:

> To use this endpoint, add your own PROVIDER_NAME API key at
> `https://openrouter.ai/integrations`, under your organization (not a
> personal account). OpenRouter routes your requests; PROVIDER_NAME bills you
> directly.

## Checking the access list after the endpoint is set up

Use this to prove to the person you are helping that the right company, and only the right company, has access.

> 1. Open the customer's organization page (search for them at
>    `https://internal.openrouter.ai/organization`, then click their row).
> 2. Open the **Private Access Grants** card.
> 3. Under **Endpoint Grants**, they should see the endpoint listed.

## Other Mission Control pages worth knowing

| Page | What it is for |
|---|---|
| `https://internal.openrouter.ai/endpoint/edit/ENDPOINT_ID` | The endpoint itself. The access list is edited here, under **Private Access** |
| `https://internal.openrouter.ai/endpoints/private` | Every private endpoint. Useful for confirming a new one exists. It does not show who has access |
| `https://internal.openrouter.ai/organization/ORG_ID` | One customer: usage, credits, provider keys, private access grants |
| `https://internal.openrouter.ai/accounts` | The enterprise customer dashboard. Searches by account name only |

## If they do not have Mission Control access

Do not walk them through a workaround and do not ask them to get a colleague's screenshot. Their next step is to request Mission Control access. In the meantime, you can look up the model and the provider yourself — the only item that genuinely needs a human decision is which organization gets access.
