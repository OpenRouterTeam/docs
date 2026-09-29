# AGENT GUIDELINES — projects/

## Marketing Navigation Must Stay In Sync

The top-level nav (Models, Benchmarks, Chat, Rankings, Apps, Pricing, Docs) is
duplicated across three independently-built surfaces.
When a nav entry is added, removed, renamed, or repointed, update **all**
of them in the same PR:

- `projects/web/components/ui/Navbar/DesktopNavBar.tsx` and
  `projects/web/components/ui/Navbar/MobileNavMenu.tsx` — the app navbar
- `projects/docs/docs.json` (`navbar.links`) — the Mintlify docs site
- `projects/blog/src/layouts/BaseLayout.astro` — the Astro blog, which has a
  desktop nav, a mobile menu, and a footer link list

Grep the new and old hrefs across `projects/` before opening the PR; a
surface missed here ships a stale link to users for weeks.
