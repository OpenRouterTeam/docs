# Content Trust Review

This class applies when a change:

- Adds, reorders, or relaxes a pattern, fuzzy target, or evasion keyword under
  `packages/guardrails/use-cases/detect-prompt-injection/`.
- Changes how allowlisted text is masked before detection, or how the allowlist
  is compiled or scoped.
- Adds an origin, wildcard host, or wildcard port to a CSP directive in
  `projects/web/next.config.ts`.
- Adds or changes a public route that renders caller-supplied text into an
  image, embed, or other first-party-branded artifact.
- Compiles a caller-supplied pattern string with `new RegExp`, or changes the
  ReDoS detectors in `packages/lib/regex-safety/regex-safety.ts` or the validation in
  `packages/guardrails/helpers/validate-content-filter-pattern.ts`.

## Rule

**A control that blocks untrusted content must not admit more after the change
than before it, unless the diff bounds the new admission.** These controls fail
open and silently: nothing errors when a pattern stops matching or a directive
starts allowing, so the diff is the only place the widening is visible.

## Failure modes to reject

### The allowlist creates or hides a detection

Allowlisted text is tenant-supplied configuration that runs before detection,
so it can move the decision in both directions: a masked span can hide a
phrase the user did write, and a careless replacement can join the words around
it into a phrase the user never wrote contiguously.

The accepted remedy is length-preserving masking with a filler that is neither
whitespace nor a member of any pattern's alphabet, so masked spans cannot match
a dangerous pattern or bridge one. Evidence: `MASK_CHAR` and the comments
stating both directions in
`packages/guardrails/use-cases/detect-prompt-injection/mask-allowlist-patterns.ts:42`
and its `maskAllowlistPatterns` docblock, plus the documented residual edge for
`.`-based patterns. A masking change that does not say which direction it moves
the decision is the finding.

Allowlist regexes are compiled per request rather than cached for the isolate's
lifetime, which also keeps tenant-owned pattern text out of an isolate shared
by other tenants (PRs
[#34836](https://github.com/OpenRouterTeam/openrouter-web/pull/34836) and
[#34837](https://github.com/OpenRouterTeam/openrouter-web/pull/34837)).
Evidence: `createAllowlistPatternMasker` in the same file. A new module-level
cache holding tenant pattern text or compiled state is a finding, not an
optimization.

### The matcher is tuned without its corpus

Detection is a regex, fuzzy-distance, and encoding pipeline whose behavior is
defined by its corpus, not by its code. A change to `DANGEROUS_PATTERNS`,
`FUZZY_TARGETS`, `EVASION_KEYWORDS_RE`, or the distance thresholds moves both
false negatives and false positives, and a performance rewrite moves them
without meaning to (PRs
[#33119](https://github.com/OpenRouterTeam/openrouter-web/pull/33119) and
[#34454](https://github.com/OpenRouterTeam/openrouter-web/pull/34454)).

The accepted remedy is to extend
`packages/guardrails/use-cases/detect-prompt-injection/detection.test.ts` in
the same change with the phrases the new behavior is supposed to catch and the
benign phrases it must still pass, and to register pattern names in
`pattern-metadata.ts` so the published pattern list stays in sync.

### The CSP directive is widened to a wildcard

A CSP entry is an allowlist of destinations a compromised page may reach, so a
wildcard host or port widens the exfiltration surface for every future
vulnerability, not just the one being unblocked. `connect-src` carries
`https://*.protect.clerk.com:*` for the bot-detection probes; the wildcard port
is the vendor's requirement, and the host it applies to is pinned. Evidence:
`projects/web/next.config.ts:63-77` (PR
[#35039](https://github.com/OpenRouterTeam/openrouter-web/pull/35039)).

The accepted shape is one vendor-scoped constant per third party, wildcards on
the narrowest component the vendor forces, and a comment naming what the entry
buys. Reject a bare wildcard added to a shared directive list, and reject
`script-src` widening on the same evidence as `connect-src` widening.

### The ReDoS detector misses a syntactic variant of a caught shape

The detectors in `packages/lib/regex-safety/regex-safety.ts` are structural heuristics
over the pattern's source text, and their policy is fail-open: anything the
scanner does not recognize is treated as safe. So a dangerous shape the
detector catches directly can be re-admitted by wrapping it in a construct the
scanner skips. `(a|aa)+` was rejected while `(?:(a|aa))+` — the same
alternation behind one wrapper group — was accepted, because the scanner only
examined a quantified group's own top-level branches (PR
[#36778](https://github.com/OpenRouterTeam/openrouter-web/pull/36778)).

The accepted remedy is variant coverage in
`packages/lib/regex-safety/regex-safety.test.ts`: every dangerous shape the detector
rejects ships positive cases for its wrapped, nested, and split-branch
variants, and negative cases for the genuinely disambiguated forms. A detector
change that adds or moves a scanning shortcut without a test showing what the
shortcut now admits is the finding. A new site that compiles caller-supplied
patterns without routing them through `validateContentFilterPattern` (or an
equivalent length cap plus `isPatternUnsafe` gate) is also the finding.

### Untrusted text rendered into a first-party-branded artifact

A public route that renders caller-supplied text into branded output lends
the brand's credibility to whatever the caller wrote: the artifact looks like
we said it. The unauthenticated `/dynamic-og` route rendered caller-supplied
`title` and `description` into an OpenRouter-branded card with no control or
bidi stripping and no length cap (PR
[#35347](https://github.com/OpenRouterTeam/openrouter-web/pull/35347)).

The accepted remedy routes every caller-supplied field through one sanitizer
that strips C0/C1 control and bidi-control characters, caps at the shared max
lengths, and falls back per field to the trusted default when nothing
survives. Evidence: `sanitizeOgText` in
`projects/web/utils/og/sanitize-og-text.ts` and the per-field fallback in
`projects/web/utils/og/resolve-og-metadata.ts`. A second rendering site that
reimplements its own stripping, or skips the cap, is the finding.

## What the primitives do not give you

Prompt-injection detection is a heuristic. It bounds obvious instruction
override, encoding tricks, and near-miss spellings; it does not make untrusted
text safe to hand to a model, and a diff must not treat a detection call as an
authorization boundary.

CSP does not stop an attacker who reaches an already-allowed origin, and an
observe-only vendor entry grants network access without granting any blocking
behavior in return.

`isPatternUnsafe` is a heuristic bound on catastrophic backtracking, not a
proof of linear-time matching. It does not replace length caps or execution
timeouts on paths that run caller-supplied regexes.

## Test requirement

A detection or allowlist change ships positive and negative cases in
`detection.test.ts` or `mask-allowlist-patterns.test.ts`. A CSP change needs no
fixture; state in the PR which vendor requires the entry. Report a missing
detection proof as `TEST GAP`, never as a vulnerability finding.

## Calibration

These controls are edited far more often for performance and false-positive
relief than for security, and every such edit moves the boundary. Judge the
diff by what it now admits, not by its stated intent.
