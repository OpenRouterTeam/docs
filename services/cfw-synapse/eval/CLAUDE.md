# Agent guidance — synapse eval harness

These conventions are enforced expectations for any agent touching the
review panel (prompts, models, tools, roster) or this harness. The
human-facing walkthrough lives in [README.md](./README.md).

- **The eval corpus is the promotion gate for agent-behavior changes.**
  A change to prompts, models, tools (workspace, memory), or the roster
  is unproven until `bun eval/run.ts` has been run against it and the
  scores are reported in the PR.
- **Every production miss or human-dismissed finding becomes a case.**
  Minimize and anonymize the PR if needed; the corpus's job is to make
  past failures permanent regression tests (same philosophy as
  `tests/manual/`).
- **Scoring reads rendered output, not internal submissions.** Findings
  are recovered via the `<!-- synapse:fp=agent:id -->` markers that the
  renderer embeds in BOTH line comments and the consolidated comment.
  If you change the renderer's marker format, update `extractFindings`
  in `extract-findings.ts` (it parses markers via the shared
  `src/uses/review/markers.ts`) in the same PR.
- **Matchers are case-insensitive substring tests.** A `mustNotFind`
  keyword like `cache` trips on ANY finding that merely mentions caching,
  not just the planted trap. When authoring cases: scope every trap with
  the narrowest `pathFragment` that identifies the trap's file, pick the
  most specific keyword substrings that still match the planted text
  (`lru cache` over `cache`), and for `mustFind` list any-of synonyms
  (`inject`, `concatenat`, `parameteriz`) rather than one generic word.
- **Anchorless findings fail the run.** A finding rendered without a
  parseable `path[:line]` anchor gets `where: ''`; it can never satisfy
  `mustFind` nor trip `mustNotFind`, so the runner exits non-zero rather
  than silently under-measuring when rendering drifts.
- **Never run the eval per-PR in CI** — it spends real model tokens.
  Manual/nightly only.
