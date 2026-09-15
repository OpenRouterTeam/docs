---
name: update-app-categories
description: Add, modify, or remove app categories and subcategories in the OpenRouter marketplace — covers code, docs, and naming rules
user-invocable: true
---

# Update App Categories

This skill guides you through adding, modifying, or removing app categories
(subcategories) and category groups in the OpenRouter marketplace.

## Key Concepts

- **Category Group** (`AppCategoryGroup`): A top-level grouping shown in the
  marketplace UI (e.g., Coding, Creative, Productivity, Entertainment)
- **Category** (`AppCategory`): A subcategory within a group (e.g., `cli-agent`,
  `creative-writing`, `video-gen`)
- Categories are the values apps send via the `X-OpenRouter-Categories` header
- Category groups are only used for UI organization

## Naming Rules (MUST FOLLOW)

1. **Use singular, lowercase, hyphen-separated slugs** for category values
   - Good: `cli-agent`, `creative-writing`, `video-gen`
   - Bad: `cli-agents` (no plurals), `CLI_Agent` (no uppercase/underscores)
2. **Never name a subcategory the same as its parent group**
   - Bad: Group `creative` with subcategory `creative`
   - Good: Group `creative` with subcategories `creative-writing`, `video-gen`
3. **Display names can be plural or descriptive** (e.g., `'CLI Agents'`,
   `'IDE Extensions'`), but the slug values must not be plural
4. **Max 30 characters** per category slug
5. **Format regex**: `/^[a-z0-9]+(-[a-z0-9]+)*$/`

## Files to Update

When adding or modifying categories, update ALL of these files:

### 1. `packages/db/apps/categories.ts` (Required)

This is the source of truth for all categories.

- **`AppCategory` const**: Add/remove the category enum entry
- **`APP_CATEGORY_DISPLAY_NAMES`**: Add/remove the human-readable display name
- **`GROUP_TO_CATEGORIES`**: Add/remove the category under the correct group
- If adding a new group: update `AppCategoryGroup`,
  `APP_CATEGORY_GROUP_DISPLAY_NAMES`, and `GROUP_TO_CATEGORIES`

Example of adding a new subcategory to the Coding group:

```typescript
// In AppCategory const:
ProgrammingApp: 'programming-app',

// In APP_CATEGORY_DISPLAY_NAMES:
[AppCategory.ProgrammingApp]: 'Programming App',

// In GROUP_TO_CATEGORIES, under the appropriate group:
[AppCategoryGroup.Coding]: [
  AppCategory.CliAgent,
  AppCategory.IdeExtension,
  AppCategory.CloudAgent,
  AppCategory.ProgrammingApp,
  AppCategory.NativeAppBuilder,
],
```

### 2. `packages/db/apps/categories.test.ts` (Required)

The existing tests validate all `AppCategory` values automatically, so adding
a new enum entry is usually sufficient. Add specific tests if needed.

### 3. `projects/docs/app-attribution.mdx` (Required)

Update the "Category Groups" section to list the new category with its slug
and description. Keep the format consistent:

```markdown
**Group Name** — Group description:

- `category-slug` — Category description
```

Make sure every category in `AppCategory` is documented here.

### 4. `postgres/seeds/apps_rows.csv`

This seed file mirrors production app data. Unlike the other seed CSVs, it
is **not** updated by the `Refresh Models and Endpoints` workflow (which
updates models, endpoints, providers, pricing, etc.). New category
assignments in prod should be synced to this file manually.

## Checklist Before Submitting

- [ ] Category slug is lowercase, hyphen-separated, singular, max 30 chars
- [ ] No subcategory shares the same name as its parent group
- [ ] `AppCategory` enum entry added/updated
- [ ] `APP_CATEGORY_DISPLAY_NAMES` updated
- [ ] `GROUP_TO_CATEGORIES` updated (category assigned to correct group)
- [ ] `app-attribution.mdx` docs updated with new category
- [ ] All previously existing categories still present (nothing accidentally removed)

## Common Mistakes to Avoid

1. **Pluralizing category slugs** — Use `game` not `games`,
   `writing-assistant` not `writing-assistants`
2. **Creating a subcategory with the same name as the group** — This creates
   confusion in the UI and URL structure
3. **Forgetting to update the docs** — The docs in `app-attribution.mdx` must
   always reflect the current set of categories
4. **Forgetting to update display names** — TypeScript will catch this as a
   compile error since `APP_CATEGORY_DISPLAY_NAMES` is typed as
   `Record<AppCategory, string>`
5. **Not checking for existing apps** — If removing or renaming a category,
   consider that existing apps may have that category stored in the database.
   A data migration may be needed.
