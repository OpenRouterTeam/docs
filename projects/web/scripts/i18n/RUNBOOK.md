# i18n operations runbook

This runbook is for an engineer who has to operate web localization without the original author. Every command below was run on `origin/main` when this file was written. Unless a section says otherwise, run commands from `projects/web`. `AGENTS.md` in this directory explains why the tooling behaves the way it does. This file only says what to do.

The `bun run i18n:*` scripts go through `bun run x`, which loads the development environment from Infisical. Only translation and the eval need a key. Every other command has a credential-free direct entrypoint, `bun scripts/i18n/extract.ts [--check]`, `bun scripts/i18n/translate.ts --check`, `bun scripts/i18n/translate.ts --dry-run`, and `bun scripts/i18n/check-msg-render.ts`, which run the same code without the wrapper.

## English-first interim rule

Feature PRs add wrapped English copy and never generate translations. A missing translation renders the English source at runtime, so an untranslated locale is never a broken page.

- Wrap every new display string at the source with `<T>`, `useGT()`, `getGT()`, or an exhaustive `msg()` map. Read the user-facing copy rules in `projects/web/AGENTS.md` for which one to use.
- Run `bun run i18n:extract` so `i18n/gt/messages/en-US.json` and `i18n/gt/messages/en-US.meta.json` pick up the new source, and commit only those two files.
- Do not run `bun run i18n:translate` in a feature PR and do not hand-edit any non-English file under `i18n/gt/messages/`.
- Translation generation is a separate job that runs against `main`. It is not part of the web build and not required for a feature PR to pass. No PR-level CI job checks the catalogs; the job that runs translation is expected to run `i18n:extract` and the strict check itself.
- Every supported locale is routable in every environment (`i18n/config.ts`, `LOCALES`). The account-menu Language row stays behind the `language-picker` Statsig gate outside preview, so locale routes and the `NEXT_LOCALE` cookie work for everyone while the picker is exposed per audience. Translated pages stay `noindex` until the SEO rollout changes that separately.

## Add or change copy

1. Write or change the English string inside a supported wrapper. Keep the source static and put dynamic values in placeholders.
2. Run `bun run i18n:extract` from `projects/web`. It scans the frontend source in scratch space and rewrites only `en-US.json` and `en-US.meta.json`.
3. Run `git diff -- i18n/gt/messages/en-US.json i18n/gt/messages/en-US.meta.json` and confirm the new or changed entries are the ones you expected.
4. Run `bun run i18n:check`. It re-extracts and fails on source drift, so it must pass on the committed catalogs before you push.
5. Commit the wrapped source plus the two `en-US` files. Leave every other catalog untouched. The next translation job on `main` translates the new entries.

Changing an English string changes its GT hash, so the old translation is orphaned and the new entry is missing in every locale until the translation job runs. That is expected and renders English in the meantime.

## Add a locale

Adding a locale touches configuration, runtime, prompt guidance, and eval data, and two tests pin them together. `i18n/gt/load-translations.test.ts` fails if `gt.config.json` and the runtime loader disagree, and `scripts/i18n/translation-eval-dataset.test.ts` fails if the targeted eval set does not cover every configured locale.

1. Add the BCP 47 tag to `SUPPORTED_LOCALES` and a native-language label to `LOCALE_LABELS` in `packages/i18n/locale.ts`.
2. Add the tag to `locales` in `projects/web/gt.config.json`.
3. Add a `TRANSLATION_FILES` loader for `@/i18n/gt/messages/<locale>.json` in `projects/web/i18n/gt/load-translations.ts`.
4. Create `i18n/gt/context/<locale>.md` with the locale guidance (see the locale guidance section). A glossary file is optional, a missing `i18n/gt/glossary/<locale>.json` is an empty glossary.
5. Add a `targets.<locale>` entry for every `product` term in `i18n/gt/terms/terms.json` that needs a curated form, and for any `protected` term that this locale transliterates instead of keeping verbatim (a protected term with no locale target stays verbatim), and add at least one targeted eval case with that `targetLocale` in `scripts/i18n/translation-eval-targeted.json`.
6. Generate the catalog with `bun run i18n:translate --locale <locale>` (see the translation section). Commit `messages/<locale>.json` and `messages/<locale>.source-hashes.json` together.
7. Run `bun test scripts/i18n i18n/gt/load-translations.test.ts` and `bun run i18n:validate`.

Until the catalog exists, `i18n:validate` fails for that locale because `--check` requires complete catalogs. Land the configuration and the generated catalog in the same PR.

## Add a term to `terms.json`

`i18n/gt/terms/terms.json` maps an English term to `{kind, note?, variants?, exempt?, unless?, exclusive?, targets?}`. It is a policy the translation prompt states and the eval enforces. It is not an exact-string override, see the glossary section for that.

- **kind** is `protected` (kept verbatim in every locale, for example `OpenRouter`, `BYOK`), `product` (a feature name with a curated form per locale, for example `Guardrail`), or `marketing` (copy that needs native review, any target is still enforced).
- **note** is shown to the model verbatim. State the grammatical role, for example that a term is a noun in every position.
- **variants** lists English surface forms that denote the same term, such as plurals and lowercase.
- **exempt** lists English phrases that contain the term but do not mean it, such as `Google Workspace` for `Workspace`.
- **unless** lists English words that mark the whole entry as being about a different sense of the term, such as `GitHub`, `rotate` or `scope` for a credential `token`. When one occurs as a whole word anywhere in the entry, the rule is neither prompted nor enforced for that entry, whereas `exempt` only blanks the listed phrase and still applies the rule to any other mention.
- **exclusive** makes the accepted forms appear only where the source uses the term. A translation of an entry that never mentions the term is rejected when it contains an accepted form as a whole word in its exact letter case, so a common noun such as `agent` cannot be rendered as the `Interns` product. A lowercase homograph (`EU-intern`) is not the product name.
- **targets.<locale>** gives `form`, optional accepted `variants`, and optional `forbid` forms for that locale.

1. Edit `terms.json`. Keep the schema strict, unknown keys abort the run.
2. Run `bun test scripts/i18n/terminology.test.ts scripts/i18n/catalog-terminology.test.ts` to confirm the file still parses.
3. Run `bun run i18n:validate`. A committed translation that now violates the new policy is reported here.
4. If existing translations violate the policy, regenerate the affected locale with `bun run i18n:translate --locale <locale> --force` and review the diff, or fix single entries through a glossary override.

## Add locale guidance in `context/`

`i18n/gt/context/global.md` is loaded for every locale and `i18n/gt/context/<locale>.md` is loaded for its locale. Both are prompt guidance, not enforced rules. Use them for register, punctuation, capitalization, and regional vocabulary. Use `terms.json` when a specific form must be enforced.

1. Edit the relevant Markdown file. Keep bullets short and concrete, the model reads them verbatim.
2. Guidance only affects entries that are translated after the change. Existing translations are retained while their source fingerprint matches. The next `bun run i18n:translate --locale <locale>` logs the changed policy components (`prompt`, `globalContext`, `localeContext`), keeps every source-fresh translation and records the new policy in `messages/<locale>.source-hashes.json`. Commit that sidecar, `i18n:check` fails on an unrecorded policy change.
3. To apply new guidance to an existing catalog, run `bun run i18n:translate --locale <locale> --force` and review the diff before committing.
4. For a one-off run, pass `--context-file PATH` to add one extra guidance file without committing it. `i18n/gt/translation-context.md` is an example of such a file.

## Add an exact glossary override

`i18n/gt/glossary/<locale>.json` maps an exact English plain-string source to its exact target. Entries covered by the glossary never go to the model, and an existing catalog value that disagrees with the glossary fails `i18n:validate`. Context-free string entries can be overridden, including ICU entries when the key and target preserve their placeholders. Rich-text and context-bearing entries (a different meaning of the same string) stay with the model.

1. Add `"English source": "target text"` to `i18n/gt/glossary/<locale>.json`. The key must match the source catalog string exactly, including punctuation.
2. Run `bun run i18n:translate --locale <locale>`. The glossary value is written into `messages/<locale>.json` and no model request is made for that entry.
3. Run `bun run i18n:validate`. An override longer than the entry's `maxChars` is reported as an error rather than retranslated.
4. Commit the glossary file and the catalog together.

## Run extraction

```bash
bun run i18n:extract
git diff --stat -- i18n/gt/messages/en-US.json i18n/gt/messages/en-US.meta.json
```

Extraction runs the pinned `gt generate` into temporary files and writes back only the source catalog and its metadata sidecar. On `origin/main` it reported `entries: 11706` and took about 14 seconds. Never run bare `gt generate` against `i18n/gt/messages/`, it seeds untranslated target entries with English text that the validator cannot tell from an intentional source-equal translation.

## Run translation locally

Translation needs `OPENROUTER_API_KEY` with balance. Always dry-run first.

```bash
bun run i18n:translate --locale es --dry-run
bun run i18n:translate --locale es
bun run i18n:validate
git diff --stat -- i18n/gt/messages
```

- `--dry-run` reports `missing_entries` and `requests` per locale without a model call or a file write. On `origin/main` it reported `missing_entries: 0` for `es`.
- Omitting `--locale` runs every configured locale in order. Each locale is written as soon as it finishes.
- `--force` sweeps the whole catalog: every committed entry is translated again with the current prompt, context and terms, and Jev keeps the committed translation unless it scores below the pass threshold (0.8) and the fresh candidate beats it by at least 0.1 on its weakest criterion. Use it after a guidance, terms or policy change. The diff holds only the entries that improved, so a second sweep changes little. It needs `OPENROUTER_API_KEY`. `--force --judge off` regenerates blind and rewrites every entry.
- `--max-requests N` caps spend for a first run. Entries the cap leaves unsent are reported as deferred and stay pending for a rerun.
- To use a key you exported yourself instead of the Infisical development key, run `bun projects/web/scripts/i18n/translate.ts --locale es` from the repository root.
- HTTP 401 means the key is invalid, 402 means no balance, and 404 with required parameters means the selected model or provider cannot serve the request shape. Never print the key to diagnose this.

Review the diff before committing. The catalog and its `source-hashes.json` sidecar are committed together.

## Run checks

```bash
bun run i18n:check
bun run i18n:validate
bun run i18n:check-msg-render
bun run i18n:consistency
```

- `i18n:check` re-extracts in scratch space and compares against the committed `en-US` catalog and every target catalog. It fails on source drift, missing or stale keys, changed GT structure, invalid placeholders, and glossary disagreement. It took about 14 seconds on `origin/main`.
- `i18n:validate` checks the committed target catalogs against the committed source without re-extracting. It took about 2 seconds on `origin/main`. It requires complete catalogs, so a locale that is still missing entries fails it.
- `i18n:check-msg-render` type-checks the project and reports `msg()` values rendered directly instead of through `m()` from `useMessages()` or `getMessages()`, which would render English in every locale. It took about 79 seconds on `origin/main`. It also runs as a task of `bun run lint`, so the PR lint job fails on a new finding. Findings already accepted are listed in `scripts/i18n/msg-render-baseline.ts`, and a stale baseline entry is reported so the list only shrinks.
- `i18n:consistency` is advisory and no finding fails it. It reads the committed catalogs without re-extracting and prints one Markdown report (or JSON with `--json`, one locale with `--locale es`) of English labels rendered several ways in a locale, target renderings reused for unrelated English labels, and locale convention hits such as half-width punctuation in Japanese or a missing space before `:` in French. Rich-text entries are skipped. Use it to pick glossary pins and guidance rules before a `--force` regeneration.
- The unit suite for the tooling is `bun test scripts/i18n i18n/gt/load-translations.test.ts`.

Apart from the semantic-safety tables on risk-tagged entries, none of these checks judge meaning. Git review owns whether prose is translated correctly.

## Run the eval and read its report

The eval is paid. It sends every case through the production request builder to each candidate model and grades with a second judge model. It needs `OPENROUTER_API_KEY`.

```bash
bun run i18n:eval --pilot 2
bun run i18n:eval --suite targeted --models openai/gpt-6-luna --report /tmp/eval.md
bun scripts/i18n/translation-eval.ts --help
```

Usage on `origin/main` is `i18n:eval [--models a,b] [--judge ID] [--suite sampled|targeted|all] [--pilot N] [--concurrency 2] [--min-score 0.8] [--timeout-seconds 300] [--report PATH]`.

Each case follows the retry ladder the translate CLI uses. A structurally invalid reply or a term-policy miss is re-requested with the strict placeholder prompt, then with the segments joined when the entry has two or more text leaves in one rendered sequence, exactly as `translate-batches.ts` treats an invalid reply. An authored-check miss, which only the eval enforces, is re-requested once with the failed check in the prompt. A cross-case `agreeWith` disagreement re-requests the minority cases once with the majority form named. Request failures, judge failures, and quality misses are never retried. The final outcome decides the gates; every earlier rejection is kept on the case record.

The report opens with one row per model with the columns `model`, `cases`, `request failures`, `structure valid`, `gate failures`, `first-pass failures`, `retries`, `judge failures`, `quality pass`, `mean s/case`, and `cost USD`. Each rate carries its own denominator so an unequal denominator is visible.

- **request failures** counts cases the provider never answered. Denominator is `cases`. A request failure proves nothing about quality and makes the exit status non-zero.
- **structure valid** is shown as `passes/graded`, where `graded` is `cases` minus request failures. It covers JSON shape, IDs, ICU placeholders, whitespace, and the production validator, after any retry.
- **gate failures** counts deterministic failures that survived the retry ladder. These are term policy, authored `contains` and `forbids` checks, and cross-case `agreeWith` consistency. Any gate failure makes the exit status non-zero and the case is never judged.
- **first-pass failures** counts cases whose first reply was rejected for any reason, whatever the final outcome. **retries** counts the retry requests sent. Both are measurements of model compliance, not gates.
- **judge failures** counts cases the judge request itself failed on. They are removed from the quality denominator rather than counted as misses.
- **quality pass** is shown as `passes/judged`, where `judged` is structure passes minus gate failures minus judge failures. Quality is a measurement, not a gate, and does not affect exit status.

Below the table each model gets a per-locale table with the same denominators, a `Retry reasons` tally of why earlier replies were rejected, and a bullet per non-passing case in the form `caseId/locale (stratum): kind: reason`. Read a locale row on its own before calling a regression locale-wide. A rising first-pass failure count with a flat final table means the model needs more retries to produce the same catalog, which costs requests but not correctness.

Read the limits before calling a winner. A candidate that shares a model family with the judge is graded generously. A pilot size is a smoke test, not a comparison. Unequal `graded` denominators mean provider rejections, not quality.

Semantic-safety checks on generated translations are not part of this eval.

## Handle failed or partial translation runs

A translation run exits non-zero whenever any entry is still missing. The catalog is the only checkpoint, so the recovery is always to inspect the diff and rerun.

1. Run `git status --short -- i18n/gt/messages` and `git diff --stat -- i18n/gt/messages`. Locales that finished are written. Later locales that failed are unchanged.
2. Read the summary lines. `missing_entries` is what still needs translation. `deferred_entries` were never sent because of a request cap, a cancellation, or an earlier authentication or balance failure. Per-entry failures list the locale, entry hash, and reason.
3. If the reason is 401 or 402, fix the key or balance. If it is 404 with required parameters, change `--model` or the reasoning and temperature options. If it is repeated invalid output on the same entries, look at their source for unusual markup and consider a glossary override.
4. Rerun the same command. Valid entries from the previous run are retained, only missing and stale entries are sent, so the run converges.
5. If the process was killed, confirm no translate process is still running and then remove `i18n/gt/.translation.lock` by hand. Never remove another running process's lock.
6. Do not commit a partially translated catalog. It is safe to leave in the working tree until the rerun completes, and `bun run i18n:validate` reports the missing entries until then.

A catalog is written before its source fingerprints, so a crash between the two cannot mark a stale catalog fresh. Missing provenance is treated as needing translation on the next run.

A recurring sync job that reruns translation on `main` is in progress. No PR was open for it when this file was written, so a rerun today is a manual run by an engineer with a key.

## Handle tier-1 legal, privacy, retention, billing, and irreversible copy

The web legal-document tree under `app/[locale]/(static)/(legal)/` is excluded from extraction in `gt.config.json` and stays English. Everything else that states a legal, privacy, retention, billing, or irreversible consequence still flows through the normal pipeline and needs a human gate.

- Examples are consent checkboxes, data processing statements, retention periods, invoice and refund wording, spend limits, and any confirm dialog whose action cannot be undone.
- The LLM judge in the eval is never legal sign-off. It measures fluency against the source and the guidance, not legal meaning.
- A bilingual human who can read the target locale approves the translated entry before it ships. Record the approval on the PR that lands the catalog change.
- When approval is not available in time, keep the entry English with an `i18n-exempt: legal -- <reason>` comment at the source, or delete the target entry so the source renders (see the revert section).
- Pin approved wording with an exact glossary override so a future `--force` run cannot change it.

## Review a translation PR

A translation PR changes `messages/<locale>.json` and `messages/<locale>.source-hashes.json`, sometimes with `terms.json`, `context/`, or `glossary/` changes.

1. Confirm the diff touches only files under `i18n/gt/`. A translation PR does not change source code.
2. Confirm `i18n:check` and `i18n:validate` passed in CI. They prove structure, placeholders, and glossary agreement, nothing else.
3. Run `git diff origin/main -- i18n/gt/messages/<locale>.json | grep '^[+-]  "' | wc -l` per locale to size the review, and read the diff of any locale you can.
4. Look for protected names transliterated or translated, product terms in a forbidden form, punctuation and register drift, and entries that are still English when the locale normally translates them. `source_equal_entries` in the run summary is the count of intentional source-equal entries.
5. Any entry in the tier-1 category above needs the bilingual approval recorded on the PR.
6. Do not hand-edit a translation in the PR. Fix it with a glossary override or a locale guidance change and rerun the locale.

## Revert a translation to English

Runtime falls back to the English source when a target entry is absent, so a revert is a deletion.

1. Find the GT hash of the entry. Search `i18n/gt/messages/en-US.json` for the English text, the key is the hash.
2. Delete that key from `i18n/gt/messages/<locale>.json` and from `i18n/gt/messages/<locale>.source-hashes.json`.
3. Run `bun run i18n:validate`. It fails for that locale because the entry is now missing, and it stays failing on `main` until the next translation run retranslates the entry. Say so in the PR. Use this path only when a fresh machine translation is an acceptable replacement.
4. If the entry must stay English until a human approves new wording, add a glossary override that maps the source to itself instead of deleting the entry. `i18n:validate` passes and no run will overwrite it. This is the default for tier-1 copy.
5. Commit and open a PR with the reason for the revert.

## Handle a support report of a bad translation

1. Get the exact rendered text, the locale, and the page from the report. Find the entry by searching `i18n/gt/messages/<locale>.json` for the rendered text, then read the English source under the same hash in `en-US.json`.
2. Decide the class of the problem.
   - **Wrong meaning or tier-1 copy** is urgent. Revert to English (see the revert section) in a small PR today, then fix properly.
   - **Wrong term** for a product or brand name means `terms.json` is missing the term or the locale target. Add the term, then regenerate the locale with `--force` or override the single entry in the glossary.
   - **Wrong register, tone, or punctuation** means the locale guidance in `context/<locale>.md` is missing the rule. Add the rule, then regenerate the affected entries.
   - **One-off bad string** with correct policy and guidance is a glossary override for that exact source.
3. After the fix, run `bun run i18n:validate` and review the diff.
4. Reply to the reporter with the PR link. If the copy is tier-1, get a bilingual approval before merging (see the escalation section).

## Escalate to bilingual or third-party review

Escalate when the entry is tier-1, when the reporter and the engineer disagree on meaning, or when no one on the team reads the locale.

1. Post the English source, the current translation, the proposed translation, and the page in the team channel and ask for a reader of that locale.
2. If no internal reader exists, send the same four items to a third-party reviewer. Send text only, never the catalog file or a key.
3. Record the reviewer and their verdict on the PR that lands the change, then pin the approved wording with a glossary override as in the tier-1 section.

## On-call checklist

- A translation run failed. Read the summary for `missing_entries` and `deferred_entries`, fix the key, balance, or model, and rerun. Nothing is broken in production while a locale is incomplete because the runtime renders English.
- `i18n:check` fails on a PR. Someone changed wrapped copy without running `bun run i18n:extract`. Run it and commit the two `en-US` files.
- `i18n:validate` fails on `main`. A catalog is missing entries or disagrees with its glossary. Run the translation for that locale, or delete the offending glossary key, and open a PR.
- `i18n:check-msg-render` fails. A `msg()` value is rendered without `m()`. Fix the call site, do not add to the baseline.
- A stale `i18n/gt/.translation.lock` blocks a run. Confirm no translate process is running, then remove that exact file.
- A support report names a bad translation. Follow the support report section. Tier-1 copy is reverted to English first.
- `bun run i18n:coverage` from the repository root reports unwrapped copy across the frontend. It is a migration aid and not a CI gate. A coverage report published by CI is in progress and no PR was open for it when this file was written.
