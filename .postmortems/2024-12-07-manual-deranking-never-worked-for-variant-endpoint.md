## Manual Deranking never worked for variant endpoint

Root cause:
1. The initial implementation did not handle variant: https://github.com/OpenRouterTeam/openrouter-web/pull/909
2. The typing did not use StandardModel on the provided model type -> no error was thrown when adding a model ID to the list
3. There was no documentation (nor notes) about this behavior -> lack internal docs
Impact:
1. This DeepInfra de-ranking commits never worked: https://github.com/OpenRouterTeam/openrouter-web/commit/232c1a09ac23345fc255326d33aa5d47212ae3ca
Resolution:
1. Removing DeepInfra from serving the free endpoints, since we already have SambaNova serving it
Actions items:
1. Move all "deranking" to endpoint in DB, purging the local manual derank: https://openrouter.slack.com/archives/C05UP07FZB4/p1733527526984489
2. Add more internal docs on our new workflows
