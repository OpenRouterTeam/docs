# toolcall_formats

Serving-stack check, not a capability benchmark: 21 single-turn tool-call scenarios × 5 encodings of optional fields (`omitted`, `anyof_null`, `anyof_null_strict`, `type_array_null`, `type_array_null_strict`) = 105 samples. Pin `providerOnly` or `endpointId` to compare stacks serving the same model.

- Cases are synthetic and live in `cases.ts`; no external dataset. Sample IDs (`toolcall_formats-<scenario>-<variant>`) are stable; never rename one, add new scenarios instead, and bump `datasetSize` in `../options.ts`.
- The nullable encodings mark optional fields required, reproducing coding-agent strict-mode rewrites (for example pi's `anyOf [number, null]`), which is where broken grammars/parsers show up.
- `scorer.ts` validates each returned call against the exact schema sent (`json-schema.ts`), then against the expected values. Failure classes: `no_tool_call`, `unknown_tool`, `invalid_json`, `schema_violation`, `call_count`, `null_string`, `wrong_value`. Format classes indicate the stack; `wrong_value` usually indicates the model.
- Keep prompts unambiguous so a healthy stack scores near 100%; temperature is fixed at 0.
