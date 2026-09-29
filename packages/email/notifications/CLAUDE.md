# AGENT GUIDELINES — packages/email/notifications

## Expose every renderer in Mission Control

Every transactional email renderer in this folder must be registered in the
Mission Control preview utility
(`projects/mission-control/app/admin-utils/preview-transactional-emails/registry.ts`),
one entry per bucket or variant the renderer supports, with editable inputs for
each parameter that changes the copy. Add the entry in the same PR that adds or
changes the renderer, and extend `registry.test.ts` alongside it.
