# AGENT GUIDELINES — Frontend

These apply to `packages/frontend`, `projects/web`, and
`projects/mission-control`.

- Semantic tokens over legacy Radix or hardcoded Tailwind colors
  (`text-foreground` / `text-warning`, not `text-slate-12` or `text-green-11`)
- lucide-react icons over custom icons and over `@heroicons/react`, which is
  still present in much of the tree and is migrated out opportunistically
- Sentence case for every UI string ("Delete intern", not "Delete Intern"). Proper
  nouns, acronyms, and verbatim quotes of a third party's UI labels are the only
  exceptions, and ALL CAPS is never authored — see DESIGN.md → Typography →
  Capitalization.
- For the design system's tokens — colors, typography, spacing, radii, and
  component styles — consult the root [`DESIGN.md`](../../DESIGN.md). It follows
  the Google [`design.md`](https://github.com/google-labs-code/design.md) format
  (YAML token front matter + prose rationale) and documents the intended visual
  identity, so it is where the reason behind a token lives, not just its value.
- The runtime source of truth for these tokens is
  `packages/frontend/components/ui/theme.css` (scoped to `:root`), layered on
  top of the legacy tokens in `packages/theme/index.css`. Keep `DESIGN.md` and
  `theme.css` consistent — if you change one, update the other.
- Prefer semantic tokens (`text-foreground`, `text-muted-foreground`,
  `bg-card`, `border-border`) over raw palette values. Accent tokens are for
  interaction (buttons, active states, focus rings), never static content.
- `packages/frontend/components/ui/` is a single tree that holds both the
  current rebrand design system and the legacy components that have not been
  rebranded yet. Prefer a rebrand primitive whenever one covers the need. There
  is no separate gap tracker: the component source and its story in
  `.storybook-ui` are the record of what is rebranded.
- **Never hard-code a token's value into a calculation — reference the var.**
  `theme.css` overrides Tailwind's own scales with DESIGN.md values, so a
  Tailwind default is the wrong number here: `leading-snug` is `1.35`, not
  Tailwind's `1.375`. Writing the literal is wrong twice — wrong today, and it
  silently drifts when the token changes.

  ```tsx
  // BAD: Tailwind's default, and frozen at the value it had when written
  'h-[calc(var(--text-heading)*1.375)]'

  // GOOD: correct now, and follows the token
  'h-[calc(var(--text-heading)*var(--leading-snug))]'
  ```

  Current leading tokens: `--leading-tight: 1.2`, `--leading-snug: 1.35`,
  `--leading-body: 1.625`, `--leading-prose: 1.7`. Look values up in
  `theme.css` rather than assuming the framework default.

## Text Entry Submits Through a Native `<form>`

Anything that submits — a dialog, sheet, drawer, or inline page section whose
primary action confirms typed input — wraps its fields and that button in a
`<form onSubmit>`, with `type='submit'` on the button. Enter then submits for
free and one handler serves both the click and the keypress. Do not hand-roll an
`onKeyDown` Enter check instead: it skips native validation and fires during IME
composition. Gate submission with a disabled submit button, which blocks Enter
too.

Two things the wrapper changes:

- Raw `<button>` elements inside it default to `type='submit'`, so every one
  other than the primary needs an explicit `type='button'`. The design-system `Button`
  already defaults to `type='button'`.
- Native constraint validation now runs. A `type='number'` field holding a
  fractional value needs `step='any'`, and `required` or `pattern` fields must be
  reachable rather than hidden in a collapsed section.

Leave Enter alone where it already means something else: a textarea, a composer,
an editor, or a live-filtering search box. Type-to-confirm destructive dialogs
stay outside a form entirely — the missing shortcut is the friction.

Initial focus comes from the dialog focusing its first tabbable element, so keep
non-inputs out of the tab order ahead of the field — informational tooltip
triggers are `tabIndex={-1}` for this reason (see
[`components/ui/InfoTooltip.tsx`](components/ui/InfoTooltip.tsx)).

## Forms: react-hook-form + Zod

Exemplar: `projects/mission-control/app/data-policy/DataPolicyForm.tsx`;
larger references `projects/web/features/guardrails/ui/GuardrailEditorForm.tsx`
and `projects/web/features/presets/ui/PresetEditor/PresetEditorForm.tsx`.

- Only input values, hand-written validation errors, and submitting flags
  belong in `useForm`. Fetched data, open/tab/step state, selection,
  pagination, dialog targets, and in-flight ids stay where they are. A file
  where nothing moves into `useForm` has no form; leave it alone.
- One colocated Zod schema per form (`z` from
  `@openrouter-monorepo/type-utils/zod`; a sibling `*-schema.ts` past ~50
  lines). `useForm<z.infer<typeof Schema>>({ resolver:
  standardSchemaResolver(Schema), defaultValues })` with the resolver from
  `@hookform/resolvers/standard-schema`. Every `register` rule and manual check
  moves into the schema, including the user-facing message.
- Model the form's own fields, not the DB row. Server-owned fields are added at
  the action call site (`createSA({ ...values, deleted: false })`), never via
  the schema or `as`.
- Optional numbers are `z.number()...nullable()`. Coerce inline where the
  input is bound (`register(name, { setValueAs })` or the `FormField`
  `onChange`), so a cleared input is `null`, not `NaN`. No standalone
  parse/coerce helpers per form; anything the schema can express belongs in
  the schema.
- Render with `Form`, `FormField`, `FormItem`, `FormLabel`, `FormControl`,
  `FormMessage` from `components/ui/Form.tsx` (or `ZodFormField`), keeping the
  existing input primitives, labels, test ids, and DOM order. Drop native
  `required`/`min`/`pattern` on schema-validated fields.
- Hydrate through `defaultValues` or `form.reset(...)`, never a `useEffect`
  that copies props or query data into state. A field derived from another
  form field is `useWatch` + `form.setValue`, kept inside the form.
- Submitting state is `formState.isSubmitting` from an async `handleSubmit`.
  Server errors keep the file's established channel (`useGlobalErrorToast`);
  otherwise `form.setError('root', { message })`.
- Do not change server actions, data-layer hooks, or the shared `Form`/
  `Controlled*` primitives for a single form's migration.
- Every submit path has a colocated `*.dom.test.tsx`: a schema error blocks
  submit, a valid submit calls the action with parsed values. Render through
  `renderWithProviders` from `packages/frontend/test-utils/render-with-providers`,
  which supplies a query client and Next's real navigation contexts (assert on
  the returned `router.push`), so `next/navigation` is never module-mocked. If
  `./actions` must still be mocked, spread the real module into the factory.

## State Management

Every piece of state has exactly one owner, and the owner determines the layer:

- **Server state — TanStack Query.** Anything an API owns. Never copy a query
  result into a store or a context value.
- **Shared mutable client state — a Zustand store.** State read or written from
  more than one component subtree, or written from outside React (action
  modules, stream handlers, event listeners).
- **Dependency injection and subtree-scoped values — React context.** Stable
  handles, clients, config, and per-instance values consumed by a single
  component tree. A provider value must not carry a setter that other subtrees
  call to mutate shared state — that state belongs in a store.
- **Everything else — component state.** Local, short-lived, single-component
  state stays in `useState` / `useRef`.

- **Never mirror state another layer owns.** One writer per field. A
  `useEffect` that copies context, props, or query data into a store creates a
  second source of truth that lags the first by a render.
- **Read stores through a per-property selector**, so a component re-renders
  only when the property it reads changes. Never call a store hook with no
  argument, and never build an object of several properties in a selector
  without `useShallow`. Enforced by `openrouter/require-zustand-selector`.

  ```tsx
  // BAD: re-renders on every write to any property in the store
  const { phase, prompt } = useMixtureStore();

  // GOOD
  const phase = useMixtureStore((state) => state.phase);
  const prompt = useMixtureStore((state) => state.prompt);
  ```

- **`getState()` is for reads outside React only.** Inside a component, read
  through the hook so the read subscribes.
- **One `create()` per file**, in a `stores/` or `state/` directory or in a file
  named `*-store.ts`, so every store has one obvious home. Enforced by
  `openrouter/store-file-placement`.
- **Persist with the `persist` middleware**, always with `name`, `version`, and
  `partialize`. Do not hand-roll localStorage reads and writes, and do not
  persist state that an API owns.
- **Use `zustand-mutative`, not Immer**, for nested updates.

## `@tw` Directive

Only add `/** @tw */` on raw Tailwind class strings assigned to standalone
variables, object properties, array elements, or return values — NOT inside
`className=` or `cn()` where Tailwind scans automatically.

When a single element needs many classes, split them across multiple `cn()`
arguments grouped by concern instead of one long inline string:

```tsx
// BAD: @tw directive on a className prop (unnecessary)
<div className={cn(/** @tw */ 'flex flex-col gap-2 text-foreground')} />

// BAD: Long unsplit class string
<div className='flex flex-col gap-2 text-foreground rounded-lg p-4
  border border-border bg-card' />

// GOOD: No directive needed — passed directly to cn()
<div
  className={cn(
    'flex flex-col gap-2',
    'rounded-lg border border-border bg-card',
    'p-4 text-foreground',
  )}
/>

// GOOD: @tw directive on a standalone string variable
const cardBase = /** @tw */ 'flex flex-col gap-2 rounded-lg p-4';
```

## Layout: Let Parent Control Spacing

Use grid/flexbox gap - let parent control spacing for responsive layouts.

```tsx
// BAD: Child-controlled margins
<div className='block'>
  <div className='mb-2 mt-2'></div>
  <div className='mb-2'></div>
</div>

// GOOD: Parent-controlled gaps
<div className='flex flex-col gap-2 py-2'>
  <div></div>
  <div></div>
</div>
```

## Components: Edge-to-Edge

Components should be self-contained with no extra margin. Pass `className` to
allow parent control:

```tsx
// BAD: Forced margin
<div className='m-6'></div>

// GOOD: Parent controls via className
<div className={className}></div>
```

## Recommended Padding

For most text elements: `px-3 py-2` (more horizontal for reading comfort).

## Color Systems

### Shadcn (Attention-Based)

Defined in `components/ui/theme.css`. Colors by attention level:

1. `primary`, `destructive` - high
2. `accent`, `warning` - medium
3. `base`, `secondary`, `muted` - low

### Radix (State-Based)

The legacy 12-step scale from `packages/theme/index.css`:

1-2: backgrounds | 3-5: buttons + states | 6-8: borders + states
9-10: solid backgrounds | 11-12: text

Read these steps to follow existing legacy components. New code uses the
semantic tokens above.
