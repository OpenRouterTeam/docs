# Manual Testing

## Bug Testing

Bug tests live in `tests/e2e/bugs/` with date-prefixed directories.

### Pattern

```typescript
import { writeJsonToFile }
  from '@openrouter-monorepo/script-utils/write-to-file';
import { assertOk }
  from '@openrouter-monorepo/lib-result';
import { expect, it, vi } from 'vitest';
import { callChatCompletion } from '@/api/completions/shared';
import snapshot from './snapshot.json';

vi.setConfig({ testTimeout: 47_000_000 });

it('e2e bug', async () => {
  // @ts-expect-error - raw snapshot
  const result = await callChatCompletion(snapshot);

  await writeJsonToFile({
    fileName: `${Date.now()}.json`,
    jsonData: result,
    baseUrl: import.meta.url,
  });

  assertOk(result);
  expect(result.data.completion).toBeDefined();
});
```

### Workflow

1. Create the bug test directory:

```bash
mkdir -p tests/e2e/bugs/$(date +%m-%d-%Y)-your-bug-description
```

1. Create `snapshot.json` with the failing request payload.

1. Create `index.test.ts` following the pattern above.

1. Run the test to reproduce the bug:

```bash
cd tests/e2e
bun run test bugs/10-03-2025-your-bug-description
```

1. Fix the bug in the codebase.

1. Re-run the test to verify the fix.

1. Update assertions to prevent regression.
