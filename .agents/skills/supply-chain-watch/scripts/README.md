# Supply-Chain Watch scripts

These scripts are the sourcing recipes for the Supply-Chain Watch skill.
`scan-lifecycle-scripts.ts` emits one NDJSON finding per installed dependency
lifecycle script and reports whether Bun trusts the package.
`scan-actions-supply-chain.ts` emits one NDJSON finding per GitHub Actions
workflow hygiene issue.

Their colocated tests cover malformed manifests and workflows, mutable action
references, unsafe pull request target checkouts, run-context injection, and
broad permissions.
