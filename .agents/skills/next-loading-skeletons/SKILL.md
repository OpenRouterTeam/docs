---
name: next-loading-skeletons
description: When and how to add loading.tsx files to Next.js App Router pages.
  Triggers on tasks involving new pages with server-side data fetching, slow
  navigations, or loading state improvements.
user-invocable: false
---

# Loading States for Server-Fetching Pages

Pages that fetch data in `page.tsx` (server components, DB queries, auth checks)
block navigation until the fetch completes. The browser's top loader bar spins
while the user stares at a frozen screen.

A colocated `loading.tsx` fixes this: Next.js wraps the page in a Suspense
boundary automatically, so navigation is instant and the loading state renders
immediately while the server fetch runs.

## When to Add a `loading.tsx`

Add one when the route's `page.tsx`:

- Awaits DB queries, API calls, or auth checks before rendering
- Takes noticeably long (200ms+) to resolve on navigation

Skip it when:

- The page is purely static (no async work in `page.tsx`)
- A parent route group already provides an adequate loading state
- The page is so fast that a skeleton would flash and feel worse

## Choosing a Loading Strategy: Skeleton vs Spinner

Skeleton shimmer UIs and loading spinners serve different situations.

### Use skeleton shimmer for structured, predictable layouts

Skeletons work well when the content has a **fixed, known structure** that won't
change based on data. Tables are the ideal case: column widths and row counts
are controlled by the component abstraction, so the skeleton-to-real transition
is smooth with no layout shift.

Good candidates for skeletons:

- **Tables** (via the shared v2 `TableSkeleton`): column structure is defined upfront
- **Fixed card grids** where card dimensions don't depend on content
- **Dashboard chrome** (title, sidebar, nav) that's identical between loading
  and loaded states

### Use a loading spinner for variable-dimension content

Skeletons tend to **drift from the real layout** over time as the page evolves.
When the container's dimensions depend on the actual content (variable-length
lists, text-heavy sections, dynamic layouts), a skeleton creates jarring layout
shifts on the loading-to-loaded transition.

Use a spinner (or a minimal empty container) when:

- Content dimensions vary based on data (profile pages, detail views, feeds)
- The page layout changes frequently and skeleton maintenance would be a burden
- The loading state is brief enough that a spinner feels fine

### The hybrid approach

Render the page's **structural chrome** (layout wrapper, title, breadcrumbs)
immediately, with either a spinner or skeleton for the data area. This gives
instant navigation feedback without committing to a full skeleton that might
drift.

## How to Build the Loading State

### 1. Match the page's structural chrome

Render the same wrapper, header, title, and layout as the real page. The user
should feel like they've already arrived at the destination.

```tsx
// app/[locale]/(user)/(dashboard)/workspaces/loading.tsx
import { DashboardPage } from '@/app/[locale]/(user)/(dashboard)/DashboardPage';

export default function WorkspacesLoading(): React.JSX.Element {
  return (
    <DashboardPage
      title='Workspaces'
      subtitle='Manage your workspaces and their configurations.'
      className='gap-6'
    >
      <WorkspaceTableSkeleton />
    </DashboardPage>
  );
}
```

Reuse the same layout component (`DashboardPage`, page wrapper, breadcrumb nav)
that the real `page.tsx` uses. This keeps the chrome continuous through the
transition and avoids layout shift.

### 2. For table pages: use the shared v2 table skeleton

The v2 `Table` primitive does not own loading state. Use `TableSkeleton` from
`packages/frontend/components/ui/Skeleton.tsx` for a stable table-shaped
placeholder, then render the v2 `Table` once the data is ready.

```tsx
import { TableSkeleton } from '@openrouter-monorepo/frontend/components/ui/Skeleton';

function WorkspaceTableSkeleton(): React.JSX.Element {
  return <TableSkeleton rowCount={5} />;
}
```

### 3. For non-table pages: prefer a spinner or minimal placeholder

When the content area has variable dimensions, keep it simple:

```tsx
import { Loader2 } from 'lucide-react';

export default function PageLoading(): React.JSX.Element {
  return (
    <DashboardPage title='Activity'>
      <div className='flex items-center justify-center py-12'>
        <Loader2 className='size-6 animate-spin text-muted-foreground' />
      </div>
    </DashboardPage>
  );
}
```

### 4. Keep the loading state static and cheap

`loading.tsx` is a **server component** with no props and no data fetching. It
must be pure, synchronous JSX. No `async`, no `await`, no hooks.

### 5. Match responsive breakpoints

If the real page hides columns or changes layout at certain breakpoints
(`hidden md:table-cell`, etc.), the loading state should do the same.

## Route Group Boundaries

`loading.tsx` applies to its segment and all child segments that don't have their
own. Think about where in the route tree it belongs:

- **Route group level** (`(user)/loading.tsx`): generic fallback for every page
  in the group. Usually a minimal empty container or spinner.
- **Leaf page level** (`workspaces/loading.tsx`): page-specific loading state.
  Preferred when the page has distinctive layout.

A leaf-level `loading.tsx` overrides the parent group's version for that route.

## Checklist

Before shipping a `loading.tsx`:

- [ ] Layout wrapper matches the real page's wrapper component and props
- [ ] Title, subtitle, breadcrumbs match the real page
- [ ] Loading strategy matches content type (skeleton for tables, spinner for variable content)
- [ ] Responsive breakpoints match (hidden columns, stacked layouts)
- [ ] No async work, no hooks, no data fetching in the loading state
- [ ] Navigation to the page feels instant (test by clicking a sidebar link)
- [ ] No jarring layout shift on the loading-to-loaded transition
