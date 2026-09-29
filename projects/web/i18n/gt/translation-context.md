Terminology for OpenRouter web copy. Pass with `bun run i18n:translate --context-file i18n/gt/translation-context.md`.

Keep these product and brand names in Latin script, untranslated and untransliterated, in every locale: OpenRouter, Ori, Fusion, Spawn, BYOK, Interns, Vault, Auto Router, Chatroom, Chat Completions, ZDR, SSO. "Fusion" and "Spawn" are product names even when the English reads like a verb or common noun ("New Fusion", "Fusion Settings", "Spawn agents on any cloud"). Translate the words around them, not the names. "Intern" and "Interns" name the OpenRouter agents product (Ori is an intern), never a trainee. "Auto Router" is the routing product (openrouter/auto), not a description of automatic routing.

Model, provider, and company names stay as written (Claude, Gemini, GPT, Llama, DeepSeek, Anthropic, OpenAI, Google, Mistral, Groq, Together, Fireworks, and similar).

Technical identifiers stay as written: API, JSON, MCP, SDK, URL, HTTP status codes, header names, code fragments, file paths, CLI flags, and environment variable names.

Product nouns with a fixed rendering per locale are listed in `i18n/gt/terms/terms.json` and passed as `terminology`: Credits, Provider, Rate limit, Endpoint, API key, Organization, Activity, Logs, Web search, Data policy, Platform fee, Auto top-up, Zero Data Retention. Use the exact form the locale gives, and never a form it forbids. Sense-dependent words keep the product sense: Credits is the prepaid balance, Activity is the usage analytics page, Logs is the request log, Provider is an inference provider, Fallback is the routing fallback.

Controlled phrases carry legal or guarantee weight and are translated literally and completely: "This action cannot be undone" keeps its absolute irreversibility, "We do not train on your data" keeps its scope and negation exactly, and "Business Associate Agreement" keeps the English name and the BAA abbreviation.
