---
name: design-scan
description: >-
  Scan the openrouter-web frontend for design system violations, non-Tailwind
  patterns, accessibility gaps, and inconsistent component usage. Posts findings
  to Slack on every run; manual invocations also report to the requester.
user-invocable: true
---

# Design System Scan

Audit the openrouter-web frontend for design system compliance. Runs on a
recurring schedule or on-demand.

The canonical design-language spec is the root [`DESIGN.md`](../../../DESIGN.md)
(brand palette, semantic tokens, light/dark accent swap, typography). When
triaging a finding or choosing a replacement token, defer to `DESIGN.md`;
its token values are implemented in `packages/theme/index.css`.

## Scope

Discover scan targets dynamically — do not hardcode directories:

```bash
find projects/ packages/ \( -name '*.tsx' -o -name '*.jsx' \) \
  -not -path '*/node_modules/*' -not -path '*/.next/*' \
  -not -path '*/coverage/*' \
  -not -path '*/.venv/*' \
  -not -name '*.test.*' -not -name '*.spec.*' \
  | sed 's|/[^/]*$||' | sort -u | head -40
```

Set shared variables before running any `rg` command:

```bash
GLOBS=(
  -g '*.{tsx,ts,jsx}'
  -g '!*.test.*'
  -g '!*.spec.*'
  -g '!*.d.ts'
  -g '!*.generated.*'
  -g '!**/.venv/**'
  -g '!*opengraph*'
  -g '!**/og/**'
)
SCOPE=(projects/web/ packages/frontend/)   # or a specific area
```

Preflight the scan inputs before running categories:

```bash
preflight_design_scan() {
  if ! rg --files "${GLOBS[@]}" "${SCOPE[@]}" | grep -q .; then
    echo 'design-scan preflight failed: globs matched no files' >&2
    return 1
  fi
  if printf 'pcre2\n' | rg -Pn 'pcre2' >/dev/null 2>&1; then
    echo 'design-scan preflight: ripgrep PCRE2 available'
  else
    echo 'design-scan preflight: ripgrep PCRE2 unavailable; use the grep fallback for lookahead checks' >&2
  fi
}
preflight_design_scan
```

The probe confirms PCRE2 presence, not compatibility with each a11y pattern.
If a pattern fails to compile, use the `grep -Pn` fallback documented in § 4.

**Inline suppression:** Lines preceded by `// ds-ignore` are dropped from
the report. Use `// ds-ignore` **sparingly** — only where git blame
confirms the color/pattern was an intentional design choice (see
§ Fix PR for the full triage workflow).

## Scan Categories

### 1. Color System

The codebase uses two layered color systems:

- **Radix 12-step scales** (`bg-red-3`, `text-red-11`, `text-green-10`,
  `bg-blue-9`, `text-slate-12`, …) for **status feedback,
  interactive/hover states, and any direct `bg-*`/`text-*`/`border-*`
  pairing**. This is the codebase's chosen convention for the kind of
  generic palette uses this scan flags — see `#20134 (style: enforce
  radix Tailwind colors)` for the bulk migration. Radix scales auto-
  switch in dark mode via `@radix-ui/colors/*-dark.css` imports in
  `packages/theme/index.css`.
- **Shadcn semantic tokens** (`text-destructive`, `bg-primary`,
  `text-muted-foreground`, `bg-card`, …) for **component-level
  theming** — Button variants, Alert/Card surfaces, foreground/
  background contrasts on shadcn primitives. These are CSS variables
  defined in each project's `styles/main.css`.

Hardcoded Tailwind palette colors (`text-red-500`, `bg-green-100`,
…) and raw hex/rgb bypass both systems and break dark mode.

```bash
# Tailwind palette (50/100-900/950) — NOT Radix 1-12
rg -n '\b(text|bg|border|ring|fill|stroke)-(red|blue|green|yellow|orange|purple|pink|cyan|violet|amber|emerald|teal|indigo|fuchsia|rose|sky|lime|stone|zinc|neutral|gray|warm)-(?:50|[1-9]00|950)\b' "${GLOBS[@]}" "${SCOPE[@]}"

# Hardcoded hex colors (3/4/6/8-digit only, so PR-number references like
# `#29583` in comments don't match; `&#8599;`-style HTML entities filtered)
rg -n '#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b' "${GLOBS[@]}" "${SCOPE[@]}" | rg -v '&#'

# Inline style color attributes (multiline: style objects usually span lines)
rg -nU 'style=\{[^}]*?\b(?:color|backgroundColor|background|borderColor|border)\s*:' "${GLOBS[@]}" "${SCOPE[@]}"

# Raw rgb/rgba/hsl/oklch — `hsl(var(--token))` is correct theme usage, not a finding
rg -n '(?:rgb|rgba|hsl|hsla|oklch|oklab)\(' "${GLOBS[@]}" "${SCOPE[@]}" | rg -v '(?:rgb|rgba|hsl|hsla|oklch|oklab)\(\s*var\('
```

**Confidence:** High

**Allow:** Radix scale classes (`text-slate-11`, `bg-red-3`,
`text-green-10`), Shadcn tokens (`text-primary`, `text-destructive`,
`text-success`, `text-warning`), CSS variable references, colors in
`main.css` / `tailwind.web.ts` / `safelist`, brand SVG colors,
`packages/frontend/components/viz/` chart arrays, and terminal/ANSI
emulation surfaces that define coordinated light and dark schemes.

### 2. Component Consistency & Reuse

UI primitives live in `packages/frontend/components/ui/` — must remain
generic and product-agnostic. Use shadcn/ui components; don't reimplement.

```bash
# Raw <a> tags (use Link or next/link); \b avoids <area>, <article>, etc.
# -U so `<a` followed by a newline (attributes on their own lines) matches.
rg -n -U '<a\b\s' "${GLOBS[@]}" "${SCOPE[@]}"

# Custom portal modals (use Dialog/Modal from ui/)
rg -n 'createPortal|ReactDOM\.createPortal' "${GLOBS[@]}" "${SCOPE[@]}"

# Non-standard icon imports (react-icons / fontawesome / phosphor are not adopted)
rg -n "from\s+['\"](?:react-icons|@fortawesome|@phosphor)" "${GLOBS[@]}" "${SCOPE[@]}"

# Icon-library check (report once as Low when both libraries are installed and in use)
if rg -q '"@heroicons/react"' projects/web/package.json packages/frontend/package.json &&
   rg -q '"lucide-react"' projects/web/package.json packages/frontend/package.json &&
   rg -q "from\s+['\"]@heroicons/react" projects/web packages/frontend -g '*.ts' -g '*.tsx' &&
   rg -q "from\s+['\"]lucide-react" projects/web packages/frontend -g '*.ts' -g '*.tsx'; then
  echo 'Low: two icon libraries are installed and in use'
fi

# Interactive div/span with onClick (should be <button>). Formatted JSX puts
# attributes on their own lines, so scan multiline — a single-line pattern
# misses nearly every real match. Do not pipe multiline output through
# `head`: rg prints every physical line of a match, so a line cap truncates
# matches mid-tag.
rg -n -U --multiline-dotall '<(?:div|span)\s[^>]*?onClick=' "${GLOBS[@]}" "${SCOPE[@]}"

# Nested interactive elements (use composition via render or asChild props)
rg -n '<button[^>]*>.*<button|<a\b[^>]*>.*<button|<button[^>]*>.*<a\b' \
  "${GLOBS[@]}" "${SCOPE[@]}" | head -20

# className string concatenation (use cn())
# The template-literal half needs single quotes: inside double quotes the
# shell eats the backslash in `\$`, leaving rg an end-of-line anchor that
# never matches.
rg -n -e "className=\{['\`].*\+" -e 'className=\{`[^`]*\$\{' \
  "${GLOBS[@]}" "${SCOPE[@]}" | head -20
```

**Component reuse checks:**

```bash
# 1. Inventory current DS components
ls packages/frontend/components/ui/

# 2. Find duplicate DS primitives outside ui/
rg -n 'export (?:default |)(?:function|const) (?:Custom|Local)?\b(Button|Dialog|Modal|Dropdown|Tooltip|Popover|Select|Tabs|Badge|Card|Alert|Banner|Drawer|Input|Textarea|Checkbox|Toggle|Accordion|Spinner|Skeleton)\b' \
  -g '*.tsx' -g '!*.test.*' \
  -g '!packages/frontend/components/ui/**' \
  "${SCOPE[@]}"

# 3. Flag components imported by 3+ files across features (promote to DS)
for f in $(find "${SCOPE[@]}" -path '*/components/*.tsx' -not -path '*/ui/*' -not -name '*.test.*'); do
  name=$(basename "$f" .tsx)
  count=$(rg -l "from.*['\"].*/$name['\"]" -g '*.tsx' "${SCOPE[@]}" | wc -l)
  if [ "$count" -ge 3 ]; then echo "$f imported by $count files"; fi
done

# 4. UI primitive purity — no data fetching or product imports in ui/
# Path is intentionally hardcoded — this rule applies ONLY to the DS
# primitive folder, not to product-shell `ui/` folders like
# `projects/web/components/ui/` (Footer, Navbar, NotificationBar, etc.).
# Stories are excluded: their sample code contains fetch() strings.
rg -n 'fetch\(|useSWR|useQuery|api\.' -g '*.tsx' -g '!*.test.*' -g '!*.stories.*' packages/frontend/components/ui/
rg -n "from.*['\"]@/features|from.*['\"]@/app" -g '*.tsx' -g '!*.test.*' -g '!*.stories.*' packages/frontend/components/ui/
```

**Confidence:** High for `<a>`, non-standard icon imports, nested
interactives, purity; Medium for portals, onClick, className concat,
duplication. The Heroicons/Lucide coexistence check is Low.

**Allow:** `<a target="_blank">` for external links, `<a>` for routes
served by external frameworks (e.g. `/docs` is proxied to Mintlify via
cfw-docs-proxy — using `<Link>` would trigger a failed RSC payload
fetch before falling back to full-page navigation), portals inside
existing ui components, provider-specific icons, `lucide-react` if
already adopted, feature "blocks" that compose (not reimplement)
primitives, files under `projects/<app>/components/ui/` for
product-shell components (Footer, Navbar, NotificationBar, etc.) —
these live next to product code on purpose and are not subject to
the DS primitive purity rule (see § Quick Reference for the canonical
DS primitive location).

### 3. Layout

```bash
# Child-controlled margins (prefer parent gap)
rg -n 'className=.*\b(mt-|mb-|ml-|mr-)\d' "${GLOBS[@]}" "${SCOPE[@]}" | head -40

# Inline style spacing
rg -n 'style=\{.*(?:margin|padding|gap)' "${GLOBS[@]}" "${SCOPE[@]}"
```

For container class checks: verify `layout.tsx` before flagging `page.tsx`.

**Confidence:** Medium

### 4. Accessibility

Use `-P` (PCRE2) for lookahead patterns. These are **Heuristic** confidence
— read 10+ lines of context before reporting.

```bash
rg -Pn '<img\s(?!.*?\balt=)' "${GLOBS[@]}" "${SCOPE[@]}"
rg -Pn '<Image\s(?!.*?\balt=)' "${GLOBS[@]}" "${SCOPE[@]}"
# If rg reports "PCRE2 is not available in this build of ripgrep", use grep:
GREPX="--include=*.tsx --include=*.jsx --exclude=*.test.* --exclude=*.spec.* \
  --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=coverage \
  --exclude-dir=.venv --exclude-dir=previews --exclude=*opengraph* \
  --exclude-dir=og"
grep -rPn $GREPX '<img\s(?!.*?\balt=)' "${SCOPE[@]}"
grep -rPn $GREPX '<Image\s(?!.*?\balt=)' "${SCOPE[@]}"
rg -n -U --multiline-dotall '<(?:div|span|li)\s[^>]*?onClick=' "${GLOBS[@]}" "${SCOPE[@]}"
rg -n '\b(text-red|text-green|text-yellow|bg-red|bg-green)\b' "${GLOBS[@]}" "${SCOPE[@]}" | head -30
```

**AST alternative (preferred — High confidence, not heuristic):** `oxlint.config.ts`
sets `categories.correctness: 'off'`, so a plain
`bunx oxlint --config oxlint.config.ts "${SCOPE[@]}"` reports **no** a11y
findings even where real ones exist. Enable the rules explicitly:

```bash
bunx oxlint --config oxlint.config.ts -A all \
  -D jsx-a11y/click-events-have-key-events \
  -D jsx-a11y/alt-text \
  "${SCOPE[@]}"
```

Findings from this invocation are AST-verified — report them as High severity
instead of dropping them under the Heuristic rule.

The command prints `NOT SUPPORTED: option missingRefs. Pass empty schema with $id that should be ignored to ajv.addSchema.` on stderr and exits 0 even on a clean scope. That line is config-schema noise, not a failed run: the same invocation reports `jsx-a11y/alt-text` on a temporary `<img src='x' />` probe file. Treat "only that line, exit 0" as a genuine zero.

**Allow:** `alt=""` on decorative images, Radix primitives (handle a11y
internally), onClick on divs inside parents that handle keyboard events.

### 5. Tailwind Class Hygiene

```bash
# @tw inside cn() or template literals (should only be on plain className strings)
rg -n 'cn\(.*@tw' "${GLOBS[@]}" "${SCOPE[@]}"

# Very long unsplit className strings (split into cn() groups)
rg -n "className=['\"][^'\"]{120,}" "${GLOBS[@]}" "${SCOPE[@]}" | head -20

# Arbitrary font sizes (should use theme tokens)
rg -n '\btext-\[\d+px\]' "${GLOBS[@]}" "${SCOPE[@]}"

# Arbitrary z-index values (use semantic z-index tokens instead)
rg -n '\bz-\[\d+\]' "${GLOBS[@]}" "${SCOPE[@]}"

# Deprecated z-50 usage (use z-overlay or other semantic tokens)
rg -n '\bz-50\b' "${GLOBS[@]}" "${SCOPE[@]}"
```

**Confidence:** Medium — arbitrary values may be intentional one-offs.

### Arbitrary font-size swaps

| Match | Token |
|-------|-------|
| `text-[9px]` | `text-3xs` |
| `text-[10px]` | `text-2xs` |

**Neither is a Swap on a surface that imports
`packages/frontend/components/ui/theme.css`** (today `projects/web/` and
`projects/mission-control/`, via their `styles/main.css`). That file floors
`.text-2xs` and `.text-3xs` to `12px` to hold the DESIGN.md sub-body floor, so
the swap silently enlarges the text. Check the floor before proposing one:

```bash
rg -n '\.text-2xs|\.text-3xs' packages/frontend/components/ui/theme.css
```

Where the floor applies, classify as **Flag**, not Swap. `text-[11px]` has no
token at all. If an arbitrary size has no matching theme token, leave it
flagged rather than suppressing it.

**Note:** `className='@tw ...'` is valid usage in this codebase. Only
flag `@tw` when it appears inside `cn()` calls or template literals.

## Execution Procedure

### 1. Scope Selection

Rotate through areas each run. Discover rotation targets:

```bash
find projects/ packages/ -name '*.tsx' -not -path '*/node_modules/*' \
  -not -path '*/.next/*' \
  -not -path '*/.venv/*' -not -name '*.test.*' \
  | awk -F/ '{print $1"/"$2"/"$3}' | sort -u
```

Pick an area not covered in recent `design-scan` branches.

### 2. Run & Triage

Run each scan category. For each match, check surrounding context against
the allow-lists. Classify findings:

| Severity | Confidence | Action |
|----------|------------|--------|
| High     | High/Medium | **Tier 1** — expand with file:line, violation, fix |
| Medium   | High/Medium | **Tier 2** — collapsed counts per category |
| Low      | any         | **Tier 3** — aggregate counts only |
| any      | Heuristic   | Drop unless High severity |

Cap repeated patterns at 5 examples + total count.

### 3. Report

Lead with: `Design scan of <scope>: X High, Y Medium, Z Low`

- **Every run:** Post to `#design-agents` Slack (`C0ATNEFH6E4`).
- **Manual (`!designscan`):** Also report to the requester.

### 4. Optional: Visual Inspection

If the dev server is running, test key pages at 375/768/1280/1920px widths.
Check for layout overflow, touch target size (≥44px), focus indicators,
and contrast (WCAG AA: 4.5:1 normal, 3:1 large text). Capture screenshots
as evidence.

### 5. Optional: Fix PR

Limited to **single-line token swaps** only (color class → semantic token,
hex → CSS variable when consumed by CSS, adding `alt=""` to decorative
images). No JSX restructuring, no layout changes. Keep diffs under ~100
lines.

#### Git blame before proposing any color fix

Before classifying a Tailwind palette finding as fixable, run
`git blame -L <line>,<line> <file>` on each match. Check the commit
message and PR title for the introducing commit to determine whether
the color was an intentional design decision or a generic grab.

**Intentional signals:** The commit or PR was explicitly about visual
design or styling; the color is part of a coordinated set (matched
`bg-*` + `text-*` + dark variants); the same deliberate pattern is
replicated across related components by the same author.

**Generic signals:** The color is incidental to a feature PR (error
states, status feedback, simple indicators); it uses a single color
without dark mode variants; it follows a common default pattern
rather than a considered design choice.

#### Triage each finding into one of three categories

| Category | Criteria | Action |
|----------|----------|--------|
| **Swap** | Generic palette use AND a Radix 12-step (or Shadcn semantic) replacement exists, with the value consumed by CSS | Replace with the Radix 12-step scale (e.g., `text-red-500` → `text-red-11`, `bg-green-100` → `bg-green-3`) — or, only on shadcn primitives, the matching Shadcn token (e.g., `bg-destructive` on a destructive Button variant) |
| **Suppress** | Git blame confirms intentional design choice | Add `// ds-ignore` above the line |
| **Flag** | Generic use BUT no Radix 12-step or Shadcn token cleanly fits yet, or a hex value is consumed by canvas/`ctx.*`, a chart renderer, or another non-CSS path | Leave as-is — scan will correctly keep surfacing it |

Do **not** add `// ds-ignore` to generic/unintentional uses. The scan
should keep flagging them until a proper semantic token is created.

#### Scope fix PRs

Keep **swap** changes and **suppress** changes in separate PRs when
possible. This makes review easier — reviewers for suppress PRs are
the original authors (tag them), while swap PRs need design review.

When adding `// ds-ignore`, tag the original authors (from git blame)
as PR reviewers so they can confirm the color was intentional.

### 6. Suggest Skill Updates

If a new anti-pattern appears, a pattern produces consistent false positives,
or the DS adopts new conventions, suggest a skill update in the report.
On schedule: open a PR. On manual: present to user for approval.

When narrowing or replacing a detection pattern, run both the old and new
commands and diff their match sets. Any matches dropped by the new pattern
must be deliberate and called out in the PR body.

## Quick Reference

| System | Use | Examples |
|--------|-----|---------|
| Radix 12-step | Status feedback, interactive states, generic `bg`/`text`/`border` colors | `text-red-11`, `bg-green-3`, `text-slate-11`, `bg-blue-9` |
| Shadcn | Component-level theming (variants on shadcn primitives) | `text-primary`, `bg-destructive`, `text-muted-foreground`, `bg-card` |

Radix scale: 1-2 bg · 3-5 component bg/states · 6-8 borders · 9-10 solids · 11-12 text

### Status-feedback patterns (preferred Radix 12-step)

`#20134` standardised these patterns across `projects/web/`,
`projects/mission-control/`, and `packages/frontend/`. Use them
when swapping generic Tailwind palette colors for status feedback:

| Pattern | Radix 12-step | Examples in main |
|---------|---------------|------------------|
| Error text / destructive icon | `text-red-11` (or `text-red-10` for icons and inline elements) | `<TrashIcon className='size-4 text-red-10' />`, hint text `text-red-10 dark:text-red-9` |
| Error / destructive container | `bg-red-1 p-3 text-red-11 dark:bg-red-12/20 dark:text-red-9` | Submit-error containers in benchmarks modals |
| Status pill (red / failed) | `bg-red-3 text-red-12` | `getStatusColor('FAILED')` in `status-utils.ts` |
| Success text / icon | `text-green-11` (or `text-green-10` for icons and inline elements) | `<PlayCircleIcon className='size-4 text-green-10' />` |
| Status pill (green / completed) | `bg-green-3 text-green-12` | `getStatusColor('COMPLETED')` |
| Warning text / icon | `text-yellow-11` or `text-amber-11` (or `text-yellow-10` for icons and inline elements) | `<PauseIcon className='size-4 text-yellow-10' />` |
| Warning / amber container | `bg-amber-1 p-3 text-amber-11 dark:bg-amber-12/20 dark:text-amber-9` | Warning banners in admin-utils and mission-control modals |
| Status pill (yellow / cancelled) | `bg-yellow-3 text-yellow-12` | `getStatusColor('CANCELLED')` |
| Status pill (blue / running) | `bg-blue-3 text-blue-12` | `getStatusColor('RUNNING')` |
| Status pill (gray / terminated) | `bg-gray-3 text-gray-12` | `getStatusColor('TERMINATED')` |
| Status pill (orange / timed out) | `bg-orange-3 text-orange-12` | `getStatusColor('TIMED_OUT')` |
| Inline link / muted body text | `text-blue-10 hover:text-blue-12` (or `text-slate-11` for muted) | `UserManagementContent.tsx`, `OrgSyncUtility.tsx` use `text-blue-10 hover:text-blue-12 underline` for inline links |
| Form input border | `border-input` (Shadcn) / `border-gray-7` (Radix) | `packages/frontend/components/ui/Input.tsx`, `DateRangePresetPicker.tsx` |
| Discount / positive % | `text-green-10` | Replaces generic `text-green-*` on discounts and growth |
| Decorative pulse / badge dot | `bg-red-10` (red), `bg-green-10` (green), … | Microphone recording dot |

### Shadcn semantic tokens (component-level theming)

Use these when the component **is** a shadcn primitive variant
(Button `variant="destructive"`, Alert `variant="destructive"`,
Card surfaces) — i.e. theming the primitive itself, not painting
status feedback inside a feature view:

| Pattern | Token |
|---------|-------|
| Destructive variant fg / bg | `text-destructive` / `bg-destructive` / `bg-destructive/10` |
| Success status fg / bg | `text-success` / `bg-success` / `bg-success/10` |
| Warning status fg / bg | `text-warning` / `bg-warning` / `bg-warning/10` |
| Muted secondary text | `text-muted-foreground` |
| Card / popover surface | `bg-card`, `bg-popover` |
| Primary action | `bg-primary text-primary-foreground` |
| Input / form border | `border-input` |

If you find yourself reaching for a Shadcn token to express status
feedback in a feature view (e.g. `text-destructive` on an error
message in a benchmarks modal), prefer the Radix 12-step equivalent
(`text-red-11`) for consistency with the rest of the migrated
codebase.

When no Radix scale or Shadcn token cleanly fits a pattern, do
**not** suppress it with `// ds-ignore`. Leave it unflagged so the
scan continues to surface it as a gap in the system.

### Z-index semantic tokens

Use semantic z-index tokens instead of arbitrary values or hardcoded numbers:

| Token | Value | Use case |
|-------|-------|----------|
| `z-above` | 1 | Just above siblings (e.g., NavigationMenu active indicator) |
| `z-sticky` | 49 | Sticky headers and sheet backdrops |
| `z-overlay` | 50 | Shadcn primitives (Dialog, Drawer, Popover, Tooltip, Select, DropdownMenu, ContextMenu) and overlay UI |
| `z-fixed` | 60 | Fixed floating buttons that must clear overlays (e.g., mobile FAB) |
| `z-modal` | 100 | Full-screen modals and fullscreen overlays |
| `z-alert` | 105 | Confirmation/alert dialogs — must stack above full-screen modals |
| `z-notification` | 110 | Toast/notification layer — must remain visible above fullscreen overlays |
| `z-popover` | 1000 | FloatingPopover — highest interactive layer |
| `z-popover-overlay` | 1001 | Overlays launched from within a FloatingPopover |
| `z-popover-tooltip` | 1002 | Tooltips inside FloatingPopover — must render above z-popover |

Defined in `packages/theme/index.css`.

| Container | Width |
|-----------|-------|
| `.main-content-container` | `max-w-screen-md` |
| `.main-content-container-lg` | `max-w-screen-lg` |
| `.main-content-container-xl` | `max-w-screen-xl` |

**Locations:** Design-language spec → root `DESIGN.md` ·
UI primitives → `packages/frontend/components/ui/` ·
Web components → `projects/web/components/`

**Rules:** Radix > Tailwind palette · lucide-react > custom icons · parent gap >
child margin · edge-to-edge (accept `className`) · `cn()` > string concat ·
`/** @tw */` only on standalone variables
