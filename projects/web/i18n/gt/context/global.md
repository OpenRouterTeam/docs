OpenRouter is a developer product: a marketplace and API that routes requests to many LLM providers. Readers are software engineers and technical buyers.

Meaning and role

- Read each entry in the role its hints give it. A navigation, tab, menu, or button label is a noun phrase or a fixed UI verb, never a sentence. "Guardrails" as a nav label names the feature; "New Guardrail" is a create button.
- English nouns used attributively stay nouns. "Preset as Model" means "use the preset in place of a model"; it is not an instruction to preset anything. "Fusion Settings" are the settings of Fusion. "Spawn Agents" is the feature name plus its object, not a command to the reader.
- Keep the level of detail the source has. Do not add explanations, hedges, or marketing adjectives that are not in the source, and do not drop a qualifier the source has.
- Numbers, code, model IDs, HTTP status codes, and API field names stay as written.
- Keep the sentence count of the source. Each English sentence becomes exactly one target sentence, including a sentence joined with a semicolon or a colon, so every number and qualifier stays in the sentence that carries it in English.
- Write a number only where the English sentence writes one. "per day", "a week", "an hour" and "once" use the target locale's word forms, never a digit the source does not show.
- An option label named inside a sentence ("select No limit", "select No expiration") is translated inline as plain words in the same case the target uses for that label, without quotation marks or brackets.
- "which X send traces to this destination" makes X the sender. In a broadcast destination, the OpenRouter data region URLs the reader picks are the origins that send traces, and the destination receives them. Keep that direction: the reader chooses the sending regions, never the region the destination lives in.
- Keep each placeholder in the role the English gives it. When two placeholders carry different values (an amount and a threshold, an eligible amount and a balance, remaining and total), each stays attached to the word the English attaches it to, so the sentence never reports the other value.
- Keep conditions, limits, and absolutes exactly. "Where required" is a condition, never "on request". "Never" as a setting or status value (an expiry, a last-used date) means the event does not or did not happen. Render it as a status, which may be the locale's usual word for "none" or "no expiry", never as a refusal such as "will never do". A lifetime or spending limit is a cap, never "unlimited". "Key creators in {workspace}" names the people, never the workspace.
- A number the reader types into a field or that code parses, such as the range in a validation message, keeps the English digits and the dot decimal. Numbers that are only displayed follow the locale format.

Terminology

- `terminology` in the request is binding. Use the exact target form it gives, in labels and in running text, so a feature reads the same in a menu, a button, a heading, and a sentence. Never use a form it forbids.
- Protected names (OpenRouter, Ori, Fusion, Spawn, BYOK, provider names, model names) stay in Latin script as written, with no transliteration and no translation.
- When a product term is not in `terminology`, pick one rendering and reuse it for every entry in the batch.
- Interns is the OpenRouter agents product and Ori is an intern. Keep "Intern" and "Interns" in Latin script in every sentence about Ori, the intern page, or building interns. Never translate it as a trainee or apprentice. Only the source words "intern" and "interns" become Intern and Interns. The common noun "agent" (an AI agent, agent loop, coding agent, agent products, agent leaderboards) is an ordinary word and gets the target language's usual word for it, never Intern or Interns, even on the Ori, Spawn, and long-horizon pages.
- Auto Router, Chatroom, Chat Completions, ZDR, and SSO are product or API names. Keep them in Latin script. "Auto Router" is never described as an automatic router in the target language.
- Credits is the prepaid balance a user buys and spends. Never render it as acknowledgements, film credits, course credit, or a credit card. Rate limit, Endpoint, Provider, Fallback, and Uptime carry their inference-routing sense: a provider serves models, an endpoint is one provider's serving of one model, a fallback is the next model or provider tried.
- Activity is the usage analytics surface (Activity page, activity data), Logs is the request log. Neither is recreation, exercise, a diary, or a history of logins.
- Standard, Business, Pro and Enterprise are the named plan tiers. Keep each plan name in Latin script in every locale, including in "the Business plan", "Upgrade to Enterprise" and "5.5% on Standard". Translate the common word where the sentence is not about the plan: "business days", "standard deviation", "Gemini 2.5 Pro", the lowercase adjective in "enterprise adoption" when the sentence is about the audience, and the HIPAA status value "Standard", which means the default setting.
- Zero Data Retention (ZDR) is a data-policy commitment: the provider keeps no prompt or completion. Use the one locale form terminology gives for the full phrase and keep "ZDR" as the abbreviation. Do not restate it as "no data storage".
- Redact is a guardrail and log action that masks or removes the matching content ("Redact" as an action, "Redacted" and "Redacted & Flagged" as outcomes, "[Image Redacted]" as a placeholder). Render it with the target language's word for masking or removing sensitive content, never as editing, revising, or deleting a record. When a sentence names the outcomes ("classifier filters only apply to Redacted and Flagged"), render them with the same words the "Redacted" and "Flagged" chart labels use, not left in English.
- Startups is the section of the site for the startup program. Where the locale translates the standalone label "Startups", use the same word for the section in "Back to Startups", "Apply — Startups" and the "Startups — Partner" page titles. Program and partner names ("OpenRouter for Startups", "Google for Startups Cloud Program", "Stripe Atlas") stay in Latin script as written.
- Trains is the provider training-policy question: whether the provider trains on prompts. As a table header or status it means "trains on data", never a vehicle, a lane, or an exercise.

Controlled phrases

- "This action cannot be undone" is the only irreversibility notice the user sees. Translate it literally and completely, never softened to "may not" and never dropped.
- "We do not train on your data" is a privacy guarantee scoped to OpenRouter. Keep the subject, the absolute negation, and the object exactly. Do not extend it to providers or add qualifiers.
- "Business Associate Agreement" and "BAA" are a HIPAA legal instrument. Keep the English name and abbreviation. A locale may add a short gloss in parentheses but must not replace the name.

Register and mechanics

- Professional, neutral, concise. Address the user in the formal or standard-polite register of the locale unless the locale file says otherwise.
- Sentence case for labels and headings. Do not capitalize every word.
- Keep punctuation conventions of the target locale, including its quotation marks and its spacing rules around punctuation. Do not add a terminal period to a label the source leaves without one.
- Preserve ICU placeholders and layout order exactly; rephrase around a variable rather than moving it.
