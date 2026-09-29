# DEV-909: per-file visibility scoping round-trip through rsync/s3fs

Proves the `file_ids` attach mechanism behaves correctly across the sandbox's
full persistence cycle under per-file visibility scoping: there is **no
documents mount** and **no overlay filesystem** (the home is a plain
container-local directory), so a workspace document becomes visible inside a
container only through the R2-side attach copy `documents/<file_id>` →
`sandboxes/<sessionKey>/<filename>` performed by `cfw-files-api`
(`copyDocumentToSession`, `src/files/attach-copy.ts`).

Attach names are **flat and id-prefixed** (OpenAI container parity): every
file attaches as `{last 8 chars of the file id}-{base filename}`, so a file
stored as `data/2026/report.csv` with id `or_file_…00000001` attaches to
`~/00000001-report.csv`. Virtual folder paths never reach the container, and
two same-named workspace files coexist under distinct prefixes.

Modeled on the DEV-887 whiteout harness
(`../08-23-2026-whiteout-rsync-s3fs-roundtrip/`, now historical — it proved
overlay whiteout round-tripping for the removed fuse-overlayfs layer): MinIO
stands in for R2, s3fs + rsync are the exact Debian bookworm apt packages the
prod image installs, and the flush/hydrate commands are copied verbatim from
`services/cfw-sandbox/src/mount-manager.ts` / `mount-paths.ts`. The R2-side
copy is simulated with `mc` (with the head-before-copy refusal), matching
the real R2 put. The warm attach command is the verbatim per-file shape from
`buildAttachCommand()` in `services/cfw-sandbox/src/file-attacher.ts`:

```bash
cp -- '/var/openrouter/session/<name>' '/workspace/home/<name>'
```

## What it proves

- **Life 1 (cold)**: two documents sharing the base filename `report.csv`
  are R2-copied under their distinct id-prefixed names and are both visible
  in the home after the ordinary session→home hydrate, with **zero**
  in-container attach commands; a legacy fuse-overlayfs `.wh.*` marker seeded
  in the prefix never surfaces in the home and is purged from the prefix by
  the first flush; an unattached document is invisible everywhere in the
  container (home, session mount) — the core visibility-scoping promise; an
  edit flushes to the session prefix.
- **Life 2 (warm reuse)**: after sleep + hydrate, the life-1 edit survives; a
  third file is attached warm — R2 copy, then the verbatim in-container
  `cp` resolving the id-prefixed source through the s3fs session mount. A
  collision case shows the R2-side head-before-copy refusing to overwrite a
  user-created session file at the same name (the `preexisting` outcome that
  becomes the sandbox's `session_object_conflict` error): the user's bytes
  survive both in the session prefix and in the home.
- **Life 3**: all attached files, the edit, and the user's collision file
  survive a second sleep; the unattached document is still invisible.
- **Throughout**: the bucket-side source objects under `documents/` are
  byte-identical to what was seeded.

## What it does not prove

- Real R2 + the Cloudflare r2-egress mount (same gap as the whiteout
  harness).
- The Durable Object record-keeping and `copyOutcome` arbitration — those are
  unit-tested in `services/cfw-sandbox/src/file-attacher.test.ts` and
  `services/cfw-files-api/src/files/attach-copy.test.ts`; this harness only
  demonstrates the filesystem consequences.
- The attach-marker idempotence metadata (`attach_source_file_id`) — s3fs
  does not surface custom metadata; covered by the attach-copy unit tests.

## `created_at` note

Under DEV-909 the attached copy is a real session object at copy time, so its
R2 timestamp reflects the attach — the last-flush-time quirk noted on DEV-905
no longer applies to freshly attached files. A later flush still rewrites the
object (and its timestamp). No assertion covers timestamps.

## Run

```bash
bash tests/manual/sandbox/08-23-2026-file-attach-roundtrip/run.sh
# or through vitest:
cd tests/manual && bunx vitest run sandbox/08-23-2026-file-attach-roundtrip
```

Requires a running Docker daemon and internet access (the container downloads
the `mc` binary from the pinned `minio/mc` GitHub release); ~2 min, no credentials.
