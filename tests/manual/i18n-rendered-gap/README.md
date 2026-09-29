# i18n rendered-gap scan

Manual report of English text that actually renders on public pages when a non-English locale is selected. It complements `bun run --cwd projects/web i18n:catalog-coverage`, which only compares catalog files: a complete catalog can still render English when a string bypasses the translation layer.

The scan never fails. Navigation errors and scan errors are recorded in the report, and the process exits 0 in every case, so it must not be wired into CI.

## Run

Start the web app locally (see `.agents/skills/local-dev-env/SKILL.md`), then:

```bash
bun tests/manual/i18n-rendered-gap/scan.ts
bun tests/manual/i18n-rendered-gap/scan.ts --locale ja-JP --route home --route models
bun tests/manual/i18n-rendered-gap/scan.ts --base-url https://openrouter.ai --out /tmp/rendered-gap
```

Reports land in `tests/manual/i18n-rendered-gap/reports/` by default (gitignored): `<locale>.json`, `<locale>.md`, and `summary.md`.

## What it does

For each target locale in `projects/web/gt.config.json` and each route in `scan-config.ts`, the scan opens the locale-free URL with the `NEXT_LOCALE` cookie set (the same cookie `projects/web/i18n/locale-rewrite.ts` reads), collects visible text grouped by block element, and reports Latin-script runs longer than three words.

Allowlisted and never reported: every spelling of a term in `projects/web/i18n/gt/terms/terms.json` for that locale, `owner/model` and `provider-name` style slugs, text inside `code`, `pre`, `kbd`, `samp`, elements with `data-i18n-exempt` or `translate="no"`, and hidden elements.

Playwright comes from the `tests/web-e2e` install, so run `bun run --cwd tests/web-e2e e2e:setup` once if Chromium is missing.
