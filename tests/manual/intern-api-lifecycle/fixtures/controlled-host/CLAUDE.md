# Controlled-host acceptance fixture

This receiver checks synthetic secret substitution during the Tilt lifecycle acceptance run. It holds fixed expectations in memory and reports only labels, counts, and comparison results. Restart it for a new run.

## Start and observe

Use Bun 1.4.2 from the repository root. Write a temporary JSON file with 1 to 32 expectations:

```json
{
  "expectations": [{
    "correlation": "run-borrower-positive",
    "secretName": "ACCEPTANCE_BORROWED",
    "expectedValueSha256": "<64 lowercase hexadecimal characters>"
  }]
}
```

Use a fresh synthetic value for each test run. Compute its SHA256 digest for this file. Seed that value through the harness. Keep configuration and generated values out of commits and logs.

```sh
bun run tests/manual/intern-api-lifecycle/fixtures/controlled-host/cli.ts serve <config-file> <port>
```

The receiver binds to `127.0.0.1`. Port `0` selects a free port. A JSON line containing `origin` signals readiness. `GET /health` also reports readiness. SIGINT or SIGTERM closes the server.

```sh
bun run tests/manual/intern-api-lifecycle/fixtures/controlled-host/cli.ts observe <loopback-origin> <correlation>
```

The observation command accepts only a loopback HTTP origin. It refuses redirects, invalid responses, and mismatched correlations. Requests time out after five seconds.

## Harness integration

Use the existing local-api-tunnel launcher to expose the receiver port. Bind the test secret's allowed hosts to that tunnel hostname. Keep the observation command on loopback.

Send `GET /acceptance/<correlation>` through the existing Tilt sidecar path with `Authorization: Bearer __<test-secret-name>__`. The harness owns sidecar routing and borrower identity.

A valid receipt returns HTTP 204 even when the value is wrong. Assert the observation, not just the HTTP status:

```json
{
  "correlation": "run-borrower-positive",
  "received": true,
  "secretName": "ACCEPTANCE_BORROWED",
  "valueMatches": true,
  "requestCount": 1
}
```

Before receipt, booleans are false and count is zero. The last receipt determines `valueMatches`; a later mismatch clears an earlier match. Use separate correlations for each borrower and phase. Unknown correlations and rejected paths do not update observations. Each configured correlation accepts only GET requests. Raw values and expected digests are never returned.

For denied outbound requests, combine the sidecar refusal with `received: false`. Fixture tests alone do not prove Tilt routing, workspace isolation, or lifecycle behavior. Run those checks through the full harness.

## Tests

```sh
bun x vitest run --config tests/manual/intern-api-lifecycle/fixtures/controlled-host/vitest.config.ts
```

The dedicated config avoids the parent database setup. Tests use loopback HTTP and real subprocesses, with no database, cloud project, or model provider.
