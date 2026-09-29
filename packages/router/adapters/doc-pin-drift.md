# Doc-pin drift register

Adapter constraints that already disagree with the provider's current public
documentation at the time a `doc-pin` was added. Entries are flagged only. No
entry here changes runtime behavior until it gets its own exposure-measured PR
(ClickHouse `generations` for affected request counts, native probe where a
provider key exists). This is a to-do list, not a record: a row is deleted by
the PR that resolves it, and the evidence lives in that PR and in the
`doc-pin` comment at the site.

Classification, relative to the provider document:

- **stricter**: the adapter narrows a range or cap the provider documents wider.
- **looser**: the adapter forwards values the provider documents as invalid.
- **unpublished**: the adapter hard-codes a limit the provider does not document.
- **scope**: the adapter applies a documented rule to models the document excludes.

Any newly discovered drift is logged here as one row: a new `doc-pin` whose code already disagrees with the document, or a pin the weekly sweep finds falsified and hands to the `doc-pin-drift-remediation` skill. An empty table means no known drift is waiting on a decision. A pin's commentary says `see drift register` only while its row exists here, since the sweep skips validation of pins that carry it.

| # | Adapter site | Code behavior | Provider document says | Class | Checked | Status |
| - | - | - | - | - | - | - |
