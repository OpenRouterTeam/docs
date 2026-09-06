---
title: Deprecation Page UX Improvements
type: feat
date: 2026-01-23
---

# Deprecation Page UX Improvements

## Overview

Improve the deprecation page UX to match the Activity page patterns, making it easy for users to filter and understand upcoming deprecation dates at a glance.

## Problem Statement

The current deprecation page has a poor filtering UX:

1. **Text input filters** require users to know exact provider/model names beforehand
2. **No visual cues** for urgency - users can't quickly identify upcoming deprecation dates
3. **Sorting on all fields** - sorting by provider/model names isn't useful, only deprecation dates matter
4. **No dropdown selection** - unlike the Activity page which shows available options
5. **No active filter visualization** - no removable chips showing what's currently filtered

**Screenshot comparison:**
- Current: Basic text inputs with sort buttons for all fields
- Desired: Popover-based filter with dropdown selects, chips, and default date sorting

## Proposed Solution

Adopt the Activity page's filter pattern for the deprecation page:

1. **Replace text inputs** with dropdown select components (`ProviderSelect`)
2. **Add visual filter feedback** using removable chips
3. **Default sort by deprecation date** (ascending for Pending, descending for Deprecated)
4. **Remove irrelevant sorting** - only keep deprecation date and created at sorting
5. **Add visual urgency indicators** for upcoming deprecation dates

## Technical Approach

### Files to Modify

1. `projects/mission-control/app/endpoints/deprecation/DeprecationTabs.tsx` - Main component refactor
2. Create new `projects/mission-control/app/endpoints/deprecation/DeprecationFilters.tsx` - Extract filter logic

### Implementation Details

#### 1. Create DeprecationFilters Component

```tsx
// projects/mission-control/app/endpoints/deprecation/DeprecationFilters.tsx

'use client';

import type { ProviderInfo } from '@openrouter-monorepo/db/providers';
import type { ProviderName } from '@openrouter-monorepo/enums/providers';

import { ProviderSelect } from '@openrouter-monorepo/frontend/components/ProviderSelect';
import { Button } from '@openrouter-monorepo/frontend/components/ui/Button';
import { RemovableChip } from '@openrouter-monorepo/frontend/components/v2/Chip';
import { ProviderIcon } from '@openrouter-monorepo/frontend/components/ui/Icons/ProviderIcons';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@openrouter-monorepo/frontend/components/v2/Popover';
import { useGlobal } from '@openrouter-monorepo/frontend/providers/GlobalProvider';
import { FilterButton } from './FilterButton';

type DeprecationFiltersProps = {
  selectedProviders: ProviderInfo[];
  onAddProvider: (provider?: ProviderName) => void;
  onRemoveProvider: (provider: ProviderInfo) => void;
  onClearFilters: () => void;
};

export function DeprecationFilters({
  selectedProviders,
  onAddProvider,
  onRemoveProvider,
  onClearFilters,
}: DeprecationFiltersProps) {
  const { getAllProviders } = useGlobal();
  const providers = getAllProviders();
  const hasActiveFilters = selectedProviders.length > 0;

  return (
    <div className='flex items-center gap-4'>
      <Popover>
        <PopoverTrigger render={<FilterButton active={hasActiveFilters} />}>
        </PopoverTrigger>
        <PopoverContent className='w-80 p-4' align='start'>
          <div className='grid gap-4'>
            <ProviderSelect
              selected={null}
              defaultLabel='Select Provider'
              onDone={(name) => {
                if (name) {
                  onAddProvider(name);
                }
              }}
            />

            {selectedProviders.length > 0 && (
              <div className='flex flex-wrap gap-2'>
                {selectedProviders.map((provider) => (
                  <RemovableChip
                    key={provider.name}
                    className='grid grid-cols-[auto,1fr] items-center gap-1'
                    onRemove={() => onRemoveProvider(provider)}
                  >
                    <ProviderIcon
                      className='size-4'
                      providerName={provider.name}
                      providerIcon={provider.icon}
                    />
                    <span className='truncate'>{provider.displayName}</span>
                  </RemovableChip>
                ))}
              </div>
            )}
          </div>

          {hasActiveFilters && (
            <div className='mt-4 flex justify-end'>
              <Button variant='outline' onClick={onClearFilters} size='sm'>
                Clear All
              </Button>
            </div>
          )}
        </PopoverContent>
      </Popover>

      {/* Show active filter chips outside popover for visibility */}
      {selectedProviders.length > 0 && (
        <div className='flex flex-wrap gap-2'>
          {selectedProviders.map((provider) => (
            <RemovableChip
              key={provider.name}
              className='grid grid-cols-[auto,1fr] items-center gap-1'
              onRemove={() => onRemoveProvider(provider)}
            >
              <ProviderIcon
                className='size-4'
                providerName={provider.name}
                providerIcon={provider.icon}
              />
              <span className='truncate'>{provider.displayName}</span>
            </RemovableChip>
          ))}
        </div>
      )}
    </div>
  );
}
```

#### 2. Create FilterButton Component (reuse Activity pattern)

```tsx
// projects/mission-control/app/endpoints/deprecation/FilterButton.tsx

import type React from 'react';

import { FunnelIcon as FunnelIconOutline } from '@heroicons/react/24/outline';
import { FunnelIcon as FunnelIconSolid } from '@heroicons/react/24/solid';
import { Button } from '@openrouter-monorepo/frontend/components/ui/Button';
import { cn } from '@openrouter-monorepo/frontend-utils/cn';

export const FilterButton = ({
  active,
  ...props
}: React.ComponentProps<'button'> & {
  active: boolean;
}) => (
  <Button
    className={cn(
      'flex items-center gap-1.5',
      'h-9 w-auto',
      'rounded-full border',
      'px-3 py-2',
      'text-sm whitespace-nowrap',
      'border-input bg-background',
      'text-muted-foreground',
      'hover:bg-muted/60 hover:text-muted-foreground hover:shadow-sm',
      'shadow-none transition-colors',
    )}
    title={active ? 'Remove Filter' : 'Add Filter'}
    {...props}
  >
    {active ? <FunnelIconSolid className='size-4' /> : <FunnelIconOutline className='size-4' />}
    Filters
  </Button>
);
```

#### 3. Refactor DeprecationTabs Component

Key changes to `DeprecationTabs.tsx`:

```tsx
// Key changes:

// 1. Remove SortButton for provider/permaslug - only keep deprecation_date
type SortField = 'deprecation_date' | 'created_at';

// 2. Add default sorting by deprecation_date
const [sortField, setSortField] = useState<SortField>('deprecation_date');
const [sortDirection, setSortDirection] = useState<SortDirection>(
  selectedIndex === 0 ? 'desc' : 'asc' // desc for Deprecated, asc for Pending
);

// 3. Replace text inputs with DeprecationFilters component
// 4. Add urgency indicators in filterAndSortEndpoints
```

#### 4. Add Urgency Visual Indicators

Modify `EndpointTable.tsx` or add inline styling in the deprecation date cell:

```tsx
// Urgency color coding for pending deprecations:
const getDeprecationUrgencyClass = (dateString: string) => {
  const date = new Date(dateString);
  const now = new Date();
  const daysUntil = Math.ceil((date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

  if (daysUntil <= 0) return 'text-destructive font-semibold'; // Already passed
  if (daysUntil <= 7) return 'text-warning-11 font-semibold'; // Within 1 week
  if (daysUntil <= 30) return 'text-warning-11'; // Within 1 month
  return 'text-muted-foreground'; // More than 1 month away
};
```

## Acceptance Criteria

- [x] Provider filter uses dropdown select instead of text input
- [x] Selected filters shown as removable chips
- [x] Default sort by deprecation date (asc for Pending, desc for Deprecated)
- [x] Remove sorting by provider/model slug (keep only deprecation_date, created_at)
- [x] Visual urgency indicators for upcoming deprecation dates:
  - Red for past deprecation dates
  - Yellow/warning for within 7 days
  - Subtle warning for within 30 days
- [x] Clear all filters button
- [x] Both "Deprecated" and "Pending Deprecation" tabs use same filter pattern
- [x] Filter state preserved when switching tabs

## Testing Checklist

- [ ] Filter by single provider works correctly
- [ ] Filter by multiple providers works correctly
- [ ] Remove individual filter chips works
- [ ] Clear all filters works
- [ ] Sort by deprecation date ascending/descending
- [ ] Sort by created at ascending/descending
- [ ] Urgency colors display correctly for different date ranges
- [ ] Tab switching preserves filter state
- [ ] Pagination still works with filters applied

## References

### Internal References
- Activity page filters: `projects/web/app/[locale]/(user)/activity/TransactionFilters.tsx`
- Filter button component: `projects/web/app/[locale]/(user)/activity/FilterButton.tsx`
- Provider select: `packages/frontend/components/ProviderSelect.tsx`
- Current deprecation page: `projects/mission-control/app/endpoints/deprecation/DeprecationTabs.tsx`

### Component Dependencies
- `RemovableChip` from `@openrouter-monorepo/frontend/components/v2/Chip`
- `ProviderSelect` from `@openrouter-monorepo/frontend/components/ProviderSelect`
- `Popover` components from `@openrouter-monorepo/frontend/components/v2/Popover`
