# cfw-inference-caches

This worker provides entity-scoped cached data for users and organizations
through the Workers Cache API. It is reachable only through service bindings.

A bounded in-memory layer in front of the Workers Cache API is allowed, but do
not use unbounded module-level Maps of entity-scoped payloads. Any such layer
adds a staleness window on top of the Workers Cache window and must be bounded
in both entries and lifetime. A marker containing only entity IDs for refresh
coordination is allowed.
