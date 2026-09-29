# Fixtures

Raw upstream provider responses captured for testing. Each provider
directory (`fixtures/<provider>/`) holds real API payloads — SSE streams
or JSON bodies — in the exact wire format the adapter receives. Fixtures
pair with snapshot tests: the fixture is the pipeline input, the
snapshot is the recorded output.

See [AGENTS.md](./AGENTS.md) for conventions (format, naming,
collection, and when a PR must include fixtures).
