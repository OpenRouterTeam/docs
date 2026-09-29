# DEV-887: sandbox whiteout round-trip through rsync/s3fs

**Question.** `services/cfw-sandbox` merges a read-only s3fs documents mount
(overlay lower) with a local ext4 upper via fuse-overlayfs, and persists the
upper to a read-write s3fs session mount with `rsync -a --delete` after each
command (`mount-manager.ts` `flushUpper`); hydration on mount is the reverse
rsync. Does deleting a file that came from `documents/` survive container
sleep (upper wiped) + remount + rehydration — i.e. does the overlay whiteout
round-trip through rsync and s3fs?

**Verdict: GREEN.** Deletions survive. The ticket's premise — that
fuse-overlayfs encodes whiteouts as 0/0 character devices, which s3fs cannot
represent — is wrong for fuse-overlayfs. Kernel overlayfs uses char devices;
**fuse-overlayfs (1.10-1, the bookworm apt package the prod image installs)
encodes whiteouts as zero-length regular files named `.wh.<name>`**, and
opaque (deleted-and-recreated) directories as a `.wh..wh..opq` marker file
*plus* a `trusted.overlay.opaque` xattr. Regular marker files copy through
rsync and s3fs unremarkably. The xattr is dropped by the round-trip
(`rsync -a` carries no `-X`, and the s3fs copy shows no xattrs), but
fuse-overlayfs honors the `.wh..wh..opq` marker file alone — proven by the
recreated-directory case below.

## What the harness does

`run.sh` starts MinIO (S3 stand-in for R2) and a **privileged**
`debian:bookworm` container with `/dev/fuse`, then `container-roundtrip.sh`
reproduces the exact prod layout (`/var/openrouter/{documents,session,upper,work}`,
merged home at `/home/sandbox`) using the same bookworm apt packages as
`services/cfw-sandbox/Dockerfile` (fuse-overlayfs 1.10-1, rsync 3.2.7,
s3fs 1.90) and the **verbatim flush/hydrate commands from
`mount-manager.ts`**, across three container lives separated by simulated
sleeps (unmount overlay, wipe upper/work, keep the s3fs session):

- life 1: delete a top-level, a nested, and a whole-directory lower entry;
  delete+recreate a file and a directory (opaque case); copy-up-edit a lower
  file; create a new file; flush.
- life 2: assert every life-1 deletion held after rehydration; then delete the
  copied-up file (its real bytes exist in the session prefix — `--delete` must
  remove them and the `.wh.` marker must land) and recreate a file deleted in
  life 1 (the stale `.wh.` marker must be cleared from the session by
  `--delete`); flush.
- life 3: assert the cross-life mutations held.

Run it (needs Docker, no credentials):

```bash
bash tests/manual/sandbox/08-23-2026-whiteout-rsync-s3fs-roundtrip/run.sh
# or through vitest:
cd tests/manual && bunx vitest run sandbox/08-23-2026-whiteout-rsync-s3fs-roundtrip
```

## Captured evidence (2026-08-23 run)

What a fuse-overlayfs whiteout actually is (upper after `rm` of lower files):

```text
-rwx------ 1 root root 0 /var/openrouter/upper/.wh.plain.txt
-rwx------ 1 root root 0 /var/openrouter/upper/subdir/.wh.nested.txt
-rwx------ 1 root root 0 /var/openrouter/upper/.wh.dropdir
-rwx------ 1 root root 0 /var/openrouter/upper/recreatedir/.wh..wh..opq
# xattr on the recreated dir (dropped by the flush, marker file suffices):
/var/openrouter/upper/recreatedir => trusted.overlay.opaque="y"
```

Session (s3fs) after flush — markers persisted as plain objects:

```text
-rwx------ 1 root root 0 /var/openrouter/session/.wh.plain.txt
-rwx------ 1 root root 0 /var/openrouter/session/recreatedir/.wh..wh..opq
```

Merged view after sleep + rehydration + remount — every check green,
including `recreatedir/old.txt absent` (opaque held without the xattr),
`edit.txt` deletion in life 2 (real session bytes replaced by a marker), and
`plain.txt` resurrection (stale marker cleared by `--delete`):

```text
ROUNDTRIP VERDICT: GREEN — every deletion case survived sleep/remount
```

## Finding: every flush exits 23 on s3fs

`rsync -a` tries to set times on the transfer root, and the s3fs mount root
has no backing object, so utimes fails:

```text
rsync: [generator] failed to set times on "/var/openrouter/session/.": Input/output error (5)
rsync error: some files/attrs were not transferred (code 23)
```

The payload transfers fine (all assertions above pass), but if prod s3fs
behaves the same way, `flushUpper` logs `cfw-sandbox:flush-failed` on **every
command**, which buries real flush failures. `--omit-dir-times` brings the
exit code to 0 (verified in the harness development runs). Not fixed here to
stay out of the way of the DEV-865 stack, which already rewrites the flush
flags to `rsync -rlpgoD --delete` (no `-t`) and incidentally resolves this.

## What this proves vs. what remains unproven

Proven locally, with the exact prod distro + package versions and verbatim
commands: fuse-overlayfs whiteout/opaque markers are regular files that
survive `rsync -a --delete` onto s3fs and hydrate back, across repeated
sleeps, for all deletion shapes tested.

Unproven (requires a live Cloudflare container + R2):

- Real R2 vs MinIO behind s3fs, and whatever s3fs version/options the
  `@cloudflare/sandbox` r2-egress `mountBucket` uses (vs plain s3fs 1.90
  here). Markers are plain zero-length objects, so the residual risk is low.
- The `@cloudflare/sandbox` SDK exec path itself (this harness drives the
  same commands via bash).

## Caveats inherent to the design (not regressions)

- `.wh.*` names are reserved by fuse-overlayfs itself: the merged view never
  shows them and creating one is rejected with `EINVAL` (verified on 1.10-1),
  so the flush needs no escaping and a model cannot forge a deletion marker.
- A deletion performed in the same life as a crash before `flushUpper` runs is
  lost, like any other unflushed edit — unchanged by this ticket.
