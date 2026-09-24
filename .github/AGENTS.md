# GitHub Actions

Rules for every workflow and composite action under `.github/`. Runner selection, cache backends, and fallback operations are in `RUNNERS.md`.

- **Pin third-party actions to a full commit SHA.** Any `uses:` reference outside `actions/*` and this repo's own `./.github/actions/*` must name a 40-character commit SHA, never a tag or branch. Tags are mutable, so a tag-based reference lets an upstream maintainer — or an attacker who compromises that repo — change the code we execute without any change on our side (CVE-2025-30066).
- **Record the source tag in a trailing comment**, so the pin stays readable and Dependabot can bump it:

  ```yaml
  uses: astral-sh/setup-uv@fac544c07dec837d0ccb6301d7b5580bf5edae39 # v8.2.0
  ```

- **Resolve the SHA from the tag you intend to use**, with `gh api repos/<owner>/<repo>/commits/<tag> --jq .sha`. Do not hand-copy a SHA from another file, and do not bundle a version bump into a pinning change.
- **Pin the tool version too when an action installs one.** Actions like `setup-uv` resolve "latest" over the network at run time, which is both a moving target and a flake source, so pass an explicit version input.
