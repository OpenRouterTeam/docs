# file_id message references (OpenRouter Files API)

Manual verification that `or_file_`-prefixed `file_id` references in message content are resolved from the OpenRouter Files API, across all three skins. No request header is involved — the id prefix is the only switch.

Not run in CI: it needs the manual-trigger `files-api` Tilt resource and a
live upload.

## Prerequisites

1. `tilt up` with the `files-api` resource triggered (port 8799 by default)
   plus the usual `api` stack.
2. `FILES_CONTENT_SIGNING_KEY` set for both cfw-api and cfw-files-api (repo
   root `.env.development.local` works: same value for both workers locally).
3. Env vars for the test: `OPENROUTER_API_BASE` (e.g. `http://localhost:8788/api`)
   and `OPENROUTER_API_KEY`.

## Upload fixtures

```bash
export FILES_API_BASE=http://localhost:8799/api/v1

# Text file → expect inline text resolution
TEXT_FILE_ID=$(curl -s -X POST "$FILES_API_BASE/files" \
  -H "Authorization: Bearer $OPENROUTER_API_KEY" \
  -F "file=@./fixtures/notes.txt;type=text/plain" | jq -r .id)

# PDF → expect base64 document resolution (OCR or native downstream)
PDF_FILE_ID=$(curl -s -X POST "$FILES_API_BASE/files" \
  -H "Authorization: Bearer $OPENROUTER_API_KEY" \
  -F "file=@./fixtures/doc.pdf;type=application/pdf" | jq -r .id)

# docx → expect 400 "not yet supported"
DOCX_FILE_ID=$(curl -s -X POST "$FILES_API_BASE/files" \
  -H "Authorization: Bearer $OPENROUTER_API_KEY" \
  -F "file=@./fixtures/doc.docx;type=application/vnd.openxmlformats-officedocument.wordprocessingml.document" | jq -r .id)

export TEXT_FILE_ID PDF_FILE_ID DOCX_FILE_ID
```

## Run

```bash
cd tests/manual
bunx vitest run launches/06-10-2026-file-id-references
```

## What to verify

- Chat Completions / Responses / Messages requests resolve the text file: the model's answer references the file content.
- A non-`or_` id (e.g. an Anthropic `file_...`) still falls through to provider passthrough → 400 from the adapter for non-BYOK.
- docx reference → 400 mentioning "not yet supported".
- `dev-fs-logs`: `router/transaction-attempt.trim.log` shows the
  `file-resolver` plugin entry with `resolved_file_count`.
