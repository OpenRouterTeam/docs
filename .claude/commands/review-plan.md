---
description: Review this plan thoroughly before making any code changes
argument-hint: <plan_file_path>
---

# Plan Review Workflow

**Plan File**: "$ARGUMENTS"

## Engineering Preferences

Use these to guide all recommendations:

- **DRY**: Flag repetition aggressively
- **Well-tested**: I'd rather have too many tests than too few
- **Engineered enough**: Not under-engineered (fragile, hacky) and not
  over-engineered (premature abstraction, unnecessary complexity)
- **Edge cases**: Err on the side of handling more, not fewer
- **Explicit over clever**: Bias toward readable, obvious code

---

## Review Sections

1. **Architecture** - System design, boundaries, coupling, data flow, scaling,
   security
2. **Code Quality** - Organization, DRY violations, error handling, edge cases,
   technical debt
3. **Tests** - Coverage gaps, test quality, edge case coverage, untested
   failure modes
4. **Performance** - N+1 queries, memory usage, caching opportunities,
   slow paths (see **React Performance Considerations** below for
   frontend-specific checks)

---

## Instructions for Claude

### Step 1: Read the Plan

Read the plan file provided by the user. If no path was given, ask for the plan
content or file location.

### Step 2: Ask Scope Question

Use AskUserQuestion with these options:

- **BIG CHANGE**: Work through interactively, 4 top issues per section
- **SMALL CHANGE**: Work through interactively, 1 issue per section

### Step 3: For Each Review Section

Process sections in order: Architecture → Code Quality → Tests → Performance

For each issue found, provide:

1. **Problem description** with file and line references
2. **2-3 options** (including "do nothing" where reasonable)
3. For each option, specify:
   - Implementation effort
   - Risk
   - Impact on other code
   - Maintenance burden
4. **Your recommended option** and why (mapped to preferences above)

### Step 4: Use AskUserQuestion for Input

After presenting each section's issues:

- Number issues (1, 2, 3, 4)
- Letter options for each (A, B, C)
- Make recommended option always FIRST (Option A)
- Label clearly: "Issue 1-A", "Issue 2-B", etc.
- Allow multi-select so user can respond to all issues at once

### Step 5: Continue to Next Section

After user responds, proceed to the next review section. Repeat until all
sections complete.

---

## Example AskUserQuestion Format

For Architecture section with 2 issues:

```text
Issue 1: Tight coupling between X and Y (src/x.ts:45, src/y.ts:120)

Options:
- 1-A (Recommended): Introduce interface abstraction
  Effort: Medium | Risk: Low | Impact: Y needs refactor | Maintenance: Lower
- 1-B: Do nothing
  Effort: None | Risk: Medium (scaling issues) | Impact: None | Maintenance: Same
- 1-C: Extract shared module
  Effort: High | Risk: Medium | Impact: Both need refactor | Maintenance: Lower

Issue 2: Missing auth boundary at API layer (src/api/handler.ts:200)

Options:
- 2-A (Recommended): Add middleware auth check
  Effort: Low | Risk: Low | Impact: All routes | Maintenance: Lower
- 2-B: Do nothing
  Effort: None | Risk: High (security) | Impact: None | Maintenance: Same
```

Then use AskUserQuestion with multiSelect=true and options like:

- "1-A: Interface abstraction (Recommended)"
- "1-B: Do nothing"
- "2-A: Add middleware auth (Recommended)"
- "2-B: Do nothing"

---

## Critical Rules

1. **Do not assume** my priorities on timeline or scale
2. **Pause after each section** and ask for feedback before moving on
3. **Number all issues** and **letter all options** clearly
4. **Recommended option is always first** (Option A)
5. **Be concrete** - always include file and line references
6. **Map recommendations** to the engineering preferences above

---

## React Performance Considerations

When reviewing React application code, flag these common performance issues:

### Re-render Prevention

Memoization has real costs (memory, code complexity, staleness bugs). Only flag
it when re-renders cause a **measurable** problem — not as a blanket rule.
React Compiler is enabled in `projects/web` and `projects/mission-control` via
`reactCompiler: true` in their Next.js configs. For these projects, most manual
memoization is unnecessary — focus only on patterns the compiler cannot handle
(e.g., expensive computations with non-primitive deps, third-party library
integration boundaries). For other projects, check the build config for evidence
of React Compiler before recommending memoization.

- **Premature memoization**: Adding `useMemo`, `useCallback`, or `React.memo`
  without evidence of a performance problem. Memoization adds complexity and
  can mask bugs; prefer simpler fixes first (state colocation, component
  splitting, moving constants outside render)
- **Expensive re-renders without mitigation**: Components doing heavy computation
  (large list transforms, complex formatting) or rendering large subtrees on
  every parent state change — where profiling shows wasted renders
- **Inline object/array literals in hot paths**: Props like `style={{}}` or
  `options={[]}` in frequently-rendered components (list rows, animation
  frames) that cause cascading child re-renders
- **State colocation opportunities**: State living higher than necessary in the
  tree, causing entire subtrees to re-render when only a small portion needs
  the value — move state closer to where it's used before reaching for memo

### State Management

- **State too high in the tree**: State lifted higher than necessary causes large
  subtree re-renders; colocate state with the components that use it
- **Single massive context**: A context that stores many values causes all consumers
  to re-render when any value changes; split into focused contexts
- **Derived state in `useState`**: Values computable from existing state/props stored
  in separate state rather than computed inline or with `useMemo`
- **Inefficient Zustand selectors**: Selecting entire store objects instead of
  individual properties causes unnecessary re-renders. Use atomic selectors
  (`const name = useStore((s) => s.name)`) or `useShallow` when multiple
  properties are needed

### Data Fetching & Effects

- **Fetching in effects without cleanup**: Missing abort controllers or cleanup
  functions leading to race conditions and memory leaks
- **Unnecessary effect dependencies**: Over-broad dependency arrays causing effects
  to re-run more often than needed
- **Missing Suspense boundaries**: Large data-fetching trees without Suspense
  boundaries cause all-or-nothing loading states

### List & Table Rendering

- **Missing `key` props or index keys**: Using array index as key for lists that
  reorder, filter, or mutate, causing DOM thrashing and stale state
- **Unvirtualized long lists**: Rendering hundreds/thousands of DOM nodes for lists
  or tables without windowing (e.g., `@tanstack/virtual`)
- **Expensive row components**: Table/list rows doing heavy computation on
  every render — prefer component splitting or moving static parts out before
  wrapping in `React.memo`

### Bundle & Load Performance

- **Missing code splitting**: Large page components or heavy libraries imported
  statically instead of using `next/dynamic` or `React.lazy`
- **Barrel file re-exports**: Importing from barrel `index.ts` files that pull in
  the entire module tree instead of direct path imports
- **Heavy dependencies in client components**: Large libraries (date-fns, lodash,
  chart libraries) imported in client bundles without tree-shaking or
  dynamic imports

### Next.js Specific

- **Unnecessary `"use client"` directives**: Components marked as client components
  when they could be server components, increasing bundle size
- **Client-side data fetching for static data**: Using `useEffect` + `fetch` for
  data that could be fetched at build time or server-side with RSC
- **Missing `loading.tsx` / `error.tsx`**: Route segments without loading or error
  boundaries causing poor UX during navigation
