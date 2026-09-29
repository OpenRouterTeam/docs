---
name: dead-weight-scan
description: Periodic scan for tracked large files that no code path references, verified against dynamic-path, R2-backed, and fixture false positives. Reports findings; deletions go through a human-reviewed PR.
user-invocable: true
---

# Dead-Weight Large File Scan

Find tracked files that add working-tree/CI-checkout weight but are referenced by nothing. Origin: PR #24442 (~25 MB removed).

## 1. Enumerate candidates

```bash
# Tracked files >= 1 MB, largest first. Output: "<bytes> <path>"
# macOS/BSD:
git ls-files -z | xargs -0 stat -f '%z %N' 2>/dev/null \
  | awk '$1 >= 1048576' | sort -rn
# Linux/GNU:
git ls-files -z | xargs -0 stat -c '%s %n' 2>/dev/null \
  | awk '$1 >= 1048576' | sort -rn
```

Do not use `du -b` — it is GNU-only. On macOS BSD `du` rejects it, the `2>/dev/null` swallows the usage error, `awk` receives nothing, and the scan silently reports zero candidates. Sanity-check every run: if the count is 0, verify the enumerator itself before concluding the tree is clean.

Paths may contain spaces. Iterate with `while IFS= read -r line` and take the path as `${line#* }` — never `for f in $(...)`, which word-splits.

## 2. Reference check (per candidate)

A candidate is dead only if ALL of these come back empty/negative. Substring grep alone gives false negatives for dynamically-built paths — check each explicitly:

1. **Exact-name grep**: use `git grep`, not `rg`. `rg` over this tree walks `node_modules` and times out (>2 min per candidate). Check the basename and the served-URL form in one predicate — a shorter sibling filename is often a substring of the candidate's, so basename-only grep on the sibling can mask an orphan:

   ```bash
   b=$(basename "$f"); url=${f#*/public}
   git grep -q --fixed-strings "$b" || git grep -q --fixed-strings "$url"
   ```

   Any hit → keep. Blog/docs images are authored in `content/**/*.md` and reference the URL path (`/images/foo.png`), so the `$url` half of that predicate is what actually resolves them — do not drop it.
2. **Dynamic path construction**: inspect loaders near the file's domain (e.g. `scripts/seed/shared.ts` builds CSV paths dynamically; blog/docs images are referenced by URL path like `/images/...` or `/assets/...`, not repo path). Grep for the parent directory name too. Seed CSVs are the canonical trap: `scripts/seed/shared.ts` interpolates `${file}_rows.csv`, so a live seed file can show zero basename hits. Resolve them via the `importCsvToPostgresTable(db, '<table>')` call sites in `scripts/seed/`, not by grepping the filename.
3. **Public asset URL mapping**: for anything under `*/public/`, derive the served URL (strip `public/`) and grep for that.
4. **R2-backed test assets**: files under `packages/llm-interfaces/test-data/` are fetched at runtime from the R2 test-assets bucket (`get-base64-data-url.ts`), not read from disk. A local copy is dead only if the R2 copy exists — verify: `curl -sI https://pub-f4e98e240dd242e4a04ede2ca2176f20.r2.dev/test-data/<name>` → 200. Caveat: `get-prompt.ts` in that same directory reads from disk via `readFile`, not R2. An R2 200 alone does not make a local copy dead if a `get-prompt.ts` accessor still points at it — that is class 7 below.
5. **Fixture convention (hard keep)**: per `fixtures/AGENTS.md`, the script-generated `.json` companion is committed alongside each `.sse.txt` under `fixtures/<provider>/`. Never propose deleting fixture companions or gitignoring `fixtures/**/*.json`, even if nothing reads them (this reversed part of #24442).
6. **Convention freshness**: before proposing a deletion class, re-read the nearest `AGENTS.md`/`REVIEW.md` — conventions may have changed since the last scan.
7. **Dead accessor (not a dead file)**: the file is reachable from an exported accessor, but that accessor has no callers. Check with `git grep -n "<accessorName>"` excluding its own definition file. This is a distinct class with a distinct remedy — deleting the file alone breaks the build, so the file and its export must go together. Report it separately from "safe to delete"; it is a two-line change, not a pure deletion.

## 3. Report / act

- **Manual invocation**: report a table (size, path, evidence per check above) to the user, split into "safe to delete", "dead accessor (file + export)", and "kept (reason)".
- Always state how many candidates were enumerated and how many audited clean, so a broken enumerator is visible as 0 candidates rather than no findings.
- **Scheduled runs**: post the same summary to the configured Slack channel; only open a deletion PR when findings exist, one PR per run.
- Deletion PRs: include the per-file evidence table and an "explicitly kept" section (audited, in use) so reviewers see what was checked. Add `.gitignore` guards only for regenerable/remote-backed files, with exact filenames — no broad globs.
- Note in the PR: deleting tracked files shrinks working-tree/CI-checkout size, **not** `.git`/clone size (blobs stay in history; no rewrite).
