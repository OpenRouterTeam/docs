# Abuse rule package guidance

Read `README.md` before modifying the schemas.

- Treat the schema as a stable contract. Adding request dimensions or user
  fields is cheap. Renames are not.
- Keep the Zod restriction allowlist narrower than the shared database enum,
  and keep it synchronized with `index.ts` constants.
- Keep `RuleFiltersSchema` assignable to react-querybuilder `RuleGroupType`.
  Preserve the compile-time assertions.
- Every newly admitted restriction kind needs a commutative, idempotent merge
  at its enforcement site.
- Keep migration comments synchronized with the persisted rule shape.
- Run the abuse-rule schema tests and
  `bun run --cwd packages/db typecheck`.
