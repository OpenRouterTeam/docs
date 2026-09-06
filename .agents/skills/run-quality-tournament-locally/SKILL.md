---
name: run-quality-tournament-locally
description: >-
  Run a full quality tournament locally end-to-end (replay + judge calls)
  when local Spanner/ClickHouse have no log data — inject mock
  transactions and mock prompt hydration (multi-modality prompts incl. an
  OpenClaw agentic transcript), run Pairwise and Council modes, capture
  results, and revert the mock code. Also covers testing with real API
  calls on cheap models. Sub-skill of
  verify-quality-tournament-wizard-ui.
allowed-tools: Bash,Edit,Read,Write,Browser
user-invocable: true
---

# Run a Quality Tournament Locally

The wizard-UI checks in
[`verify-quality-tournament-features`](../verify-quality-tournament-features/SKILL.md)
mostly verify layout and state transitions. When you need an **actual**
tournament to run end-to-end (replay + judge calls) but local
Spanner/ClickHouse have no log data, inject mock transactions and mock
prompt hydration. This drives the classic `/labs/quality-tournament` run
path; the wizard Run & review step shares the same `tournament-runner`,
so the replay + judge pipeline is the same. Part of
[`verify-quality-tournament-wizard-ui`](../verify-quality-tournament-wizard-ui/SKILL.md);
assumes the environment from
[`setup-quality-tournament-env`](../setup-quality-tournament-env/SKILL.md).

Do **not** commit any of this mock code — revert per "Capture results &
revert the mock code" below.


## Inject mock transactions into `page.tsx`

Add a block **after** the real transactions are fetched (around the
`const transactions = txData?.transactions ?? [];` line) that falls
back to mock data when no real transactions exist. The mocks cover
multiple modalities (text, image-gen, video-gen, TTS, agentic):

```typescript
import type { PublicTransaction } from '@openrouter-monorepo/db/transactions';
import { createMockGeneration } from '@openrouter-monorepo/db/transactions/mock';

// --- LOCAL DEV MOCK: inject fake transactions for tournament testing ---
const MOCK_PROMPTS: Array<{
  prompt: string;
  model: string;
  provider: string;
  numMediaPrompt: number | null;
  nativeTokensCompletionImages: number | null;
}> = [
  // Text-only prompts
  {
    prompt: 'Explain the concept of recursion in programming with a simple example.',
    model: 'openai/gpt-4o-mini',
    provider: 'OpenAI',
    numMediaPrompt: null,
    nativeTokensCompletionImages: null,
  },
  {
    prompt: 'What are the main differences between TCP and UDP protocols?',
    model: 'openai/gpt-4o-mini',
    provider: 'OpenAI',
    numMediaPrompt: null,
    nativeTokensCompletionImages: null,
  },
  {
    prompt: 'Compare and contrast functional programming with object-oriented programming.',
    model: 'openai/gpt-4o-mini',
    provider: 'OpenAI',
    numMediaPrompt: null,
    nativeTokensCompletionImages: null,
  },
  // Image generation prompts (Nano Banana = Gemini image models)
  {
    prompt: 'Generate an image of a beautiful oak tree in autumn with golden leaves.',
    model: 'google/gemini-3-pro-image-preview',
    provider: 'Google AI Studio',
    numMediaPrompt: null,
    nativeTokensCompletionImages: 1,
  },
  {
    prompt: 'Create a photorealistic image of a cherry blossom tree in spring.',
    model: 'google/gemini-3.1-flash-image-preview',
    provider: 'Google AI Studio',
    numMediaPrompt: null,
    nativeTokensCompletionImages: 1,
  },
  // Video generation prompts (Seedance = ByteDance video models)
  {
    prompt: 'Generate a video of a tree growing from a seed to full size in time-lapse.',
    model: 'bytedance/seedance-2.0',
    provider: 'Seed',
    numMediaPrompt: null,
    nativeTokensCompletionImages: null,
  },
  {
    prompt: 'Create a cinematic video of wind blowing through a willow tree at sunset.',
    model: 'bytedance/seedance-1-5-pro',
    provider: 'Seed',
    numMediaPrompt: null,
    nativeTokensCompletionImages: null,
  },
  // TTS / speech prompts (replayed via /api/v1/audio/speech in TTS modality;
  // the source completion text is what gets synthesized)
  {
    prompt: 'Say "hello world" in a warm, friendly voice.',
    model: 'microsoft/mai-voice-2',
    provider: 'Azure',
    numMediaPrompt: null,
    nativeTokensCompletionImages: null,
  },
  // Complex agentic multi-turn conversation (OpenClaw personal assistant)
  // Full messages include system prompt w/ tool defs, web_search tool calls
  // with tool responses, a normal text completion summarising the results,
  // then a follow-up user message asking for more detail.
  {
    prompt: 'OpenClaw: tell me more about the china explosive growth in one sentence',
    model: 'openai/gpt-4o-mini',
    provider: 'OpenAI',
    numMediaPrompt: null,
    nativeTokensCompletionImages: null,
  },
];

// Rename the real variable so we can fall back to mocks
const realTransactions = transactions;
const mockTransactions: PublicTransaction[] = MOCK_PROMPTS.map((p, i) =>
  createMockGeneration({
    id: i + 1,
    generation_id: `mock-gen-${i + 1}`,
    created_at: new Date(Date.now() - (i + 1) * 60_000).toISOString(),
    usage: 0.001,
    is_byok: false,
    latency: 1200 + i * 100,
    tokens_prompt: 20 + i * 5,
    tokens_completion: 150 + i * 10,
    native_tokens_prompt: 20 + i * 5,
    native_tokens_completion: 150 + i * 10,
    model: p.model,
    provider_name: p.provider,
    generation_time: 800 + i * 50,
    origin: p.prompt,
    native_finish_reason: 'stop',
    finish_reason: 'stop',
    num_media_prompt: p.numMediaPrompt,
    native_tokens_completion_images: p.nativeTokensCompletionImages,
    // Required: `createMockGeneration` defaults this to false, but the wizard's
    // `isSelectableTransaction` (wizard/select-prompts.ts) only marks a row selectable
    // when it's exactly `true`. Without this the mock rows render but can't be
    // picked, so the "select all" / run-tournament steps below won't work.
    is_openrouter_private_logging_enabled: true,
  }),
);

const finalTransactions = realTransactions.length > 0 ? realTransactions : mockTransactions;
// --- END LOCAL DEV MOCK ---
```

This uses the canonical `createMockGeneration` factory from
`packages/db/transactions/mock.ts` — it provides sensible defaults for all
`PublicTransaction` fields, so you only need to override what matters.
Replace subsequent references to `transactions` with `finalTransactions`
in the tournament page component.

Note: this mocks the `transactions` prop only. It does **not** reach the
server-side log filters (those re-query `fetchUserTransactions`); see
"Seeding real generations" in
[`seed-quality-tournament-data`](../seed-quality-tournament-data/SKILL.md)
for why and how to seed real rows for filter tests.

## Inject mock prompt hydration into `hydrate-prompts.ts`

`loadHydratedPrompts()` lives in `hydrate-prompts.ts` (`tournament-runner.ts`
only imports it) and fetches transactions + private prompt logs, which are
unavailable locally. Add an early return there that intercepts `mock-gen-*`
IDs before the real `fetchUserTransactions` call.

First, copy the OpenClaw example messages next to `hydrate-prompts.ts`
so the import resolves:

```bash
mkdir -p "projects/web/app/[locale]/(user)/(dashboard)/labs/quality-tournament/examples"
cp .agents/skills/quality-tournament-api-fixtures/examples/openclaw-request.json \
   "projects/web/app/[locale]/(user)/(dashboard)/labs/quality-tournament/examples/"
```

Then insert this **before** `loadHydratedPrompts`:

```typescript
// --- LOCAL DEV MOCK: map mock-gen-* IDs to known prompts ---
// For simple single-user-message prompts, `prompt` is used as the message content.
// For complex multi-role prompts (e.g. OpenClaw), supply a `messages` array instead.
// JSON uses snake_case wire format (`tool_calls`, `tool_call_id`) — must go
// through `sanitizeReplayMessages` (already imported in hydrate-prompts.ts) to
// convert to the SDK's camelCase; `reasoning_content` is dropped (correct for replay).
import openclawMessages from './examples/openclaw-request.json';

const MOCK_PROMPTS: Record<string, { prompt: string; model: string; messages?: ChatMessages[] }> = {
  'mock-gen-1': { prompt: 'Explain the concept of recursion...', model: 'openai/gpt-4o-mini' },
  'mock-gen-2': { prompt: 'What are the main differences...', model: 'openai/gpt-4o-mini' },
  'mock-gen-3': { prompt: 'Compare and contrast functional...', model: 'openai/gpt-4o-mini' },
  'mock-gen-4': { prompt: 'Generate an image of a beautiful oak tree...', model: 'google/gemini-3-pro-image-preview' },
  'mock-gen-5': { prompt: 'Create a photorealistic image of a cherry blossom...', model: 'google/gemini-3.1-flash-image-preview' },
  'mock-gen-6': { prompt: 'Generate a video of a tree growing...', model: 'bytedance/seedance-2.0' },
  'mock-gen-7': { prompt: 'Create a cinematic video of wind...', model: 'bytedance/seedance-1-5-pro' },
  'mock-gen-8': { prompt: 'Say "hello world" in a warm, friendly voice.', model: 'microsoft/mai-voice-2' },
  // OpenClaw: multi-turn agentic conversation — system prompt w/ tool defs,
  // web_search calls, tool responses, a normal text completion, then a
  // follow-up asking for more detail. JSON: examples/openclaw-request.json.
  // Note: real tool-call generations are now filtered out of replays (see
  // seed-quality-tournament-data / `containsToolCalls`); this guard short-circuits loadHydratedPrompts
  // before that filter, so the mock is the way to still drive a multi-role
  // tool-call transcript through the replay path locally.
  'mock-gen-9': {
    prompt: 'tell me more about the china explosive growth in one sentence',
    model: 'openai/gpt-4o-mini',
    messages: sanitizeReplayMessages(openclawMessages),
  },
};

function getMockHydratedPrompts(generationIds: string[]): HydratedPrompt[] | null {
  const allMock = generationIds.every((id) => id in MOCK_PROMPTS);
  if (!allMock) return null;
  return generationIds.map((id) => {
    const entry = MOCK_PROMPTS[id];
    // Use explicit messages array when provided (e.g. OpenClaw multi-role prompt),
    // otherwise fall back to a single user message from the prompt string.
    const messages: ChatMessages[] =
      entry?.messages ?? [{ role: 'user', content: entry?.prompt ?? '' }];
    return {
      generationId: id,
      sourceModelSlug: entry?.model ?? 'openai/gpt-4o-mini',
      messages,
      sourceCompletion: '(mock baseline — no stored completion)',
      sourceCostUsd: 0.001,
      sourcePromptTokens: 25,
      sourceCompletionTokens: 150,
      sourceLatencyMs: 1200,
      replayMaxTokens: REPLAY_MAX_TOKENS_FLOOR,
      // Intentionally false even for image-gen mocks — avoids real image API
      // calls locally. Replays run text-only; modality detection still works
      // via detectAggregateModality for the Suggest button.
      sourceProducedImages: false,
    };
  });
}
// --- END LOCAL DEV MOCK ---
```

Then inside `loadHydratedPrompts`, add this guard at the top of the
function body (before the `fetchUserTransactions` call):

```typescript
// --- LOCAL DEV MOCK ---
const mockPrompts = getMockHydratedPrompts(generationIds);
if (mockPrompts !== null) {
  return ok(mockPrompts);
}
// --- END LOCAL DEV MOCK ---
```

## Run the tournament (Pairwise + Council)

1. Navigate to `http://localhost:3000/labs/quality-tournament`
2. All mock transactions should appear in the table — select all of them
3. Add candidate models (e.g. `google/gemini-2.5-flash` and
   `anthropic/claude-sonnet-4.6`)
4. Choose judge mode:

**Pairwise mode**
- Select a judge model (e.g. `moonshotai/kimi-k2.6`)
- Click **Run Tournament** and wait for completion (replay + judge calls
  may take several minutes)
- Screenshot the leaderboard

**Council mode** — multiple panel members each vote independently on every
pair, then an aggregator (chief judge) weighs the votes into a final
verdict. Use a diverse panel for the best signal.

| Role           | Model                         |
|----------------|-------------------------------|
| Panel Member 1 | `minimax/minimax-m1`          |
| Panel Member 2 | `google/gemini-2.5-flash`     |
| Panel Member 3 | `anthropic/claude-sonnet-4.6` |
| Aggregator     | `moonshotai/kimi-k2.6`        |

1. Switch to the **Council** tab
2. **Add panel member** for each of the three panel models
3. Select the aggregator (a fast model works well — it only synthesises
   the panel votes)
4. **Run Tournament**. Council is slower than pairwise: each pair is judged
   by every panel member (e.g. 5 prompts × 3 pairs × 3 voters + aggregation
   ≈ 55+ API calls). Expect 3–5 minutes.
5. Screenshot the leaderboard and per-prompt panel votes

What to verify in council results:
- Each panel member's vote and confidence score appears in the per-prompt
  detail view
- The aggregator verdict reflects the majority of panel votes
- Reasoning tags (e.g. COMPLETENESS, INSTRUCTION_FOLLOWING) are present
- Panel members from different providers may disagree — expected, and shows
  the council is working

## Capture results & revert the mock code

Screenshot: setup view (selected prompts, candidates, judge config),
leaderboard (rank, win rate, cost, latency), the Cost vs Quality chart, and
a per-prompt detail view (Original vs Alternative side-by-side).

Then revert the temporary mock injections.

If you had **no** uncommitted changes before injecting mocks, restore from
HEAD:

```bash
git restore --source HEAD -- \
  "projects/web/app/[locale]/(user)/(dashboard)/labs/quality-tournament/page.tsx" \
  "projects/web/app/[locale]/(user)/(dashboard)/labs/quality-tournament/hydrate-prompts.ts"
```

If you **had** uncommitted changes, `git stash` before the mock injection and
`git stash pop` after the restore above so those changes are preserved.
Also remove the copied OpenClaw example:

```bash
rm -rf "projects/web/app/[locale]/(user)/(dashboard)/labs/quality-tournament/examples"
```

## Testing with real API calls locally

If real transaction data is available (production DB replica or Spanner
tunnel), skip the mock injection and run the tournament against live stored
prompts. Use cheap, fast models to avoid burning credits while still
exercising the full replay → judge pipeline.

| Role             | Model                        | Why                                |
|------------------|------------------------------|------------------------------------|
| Candidate 1      | `deepseek/deepseek-v4-flash` | Fast, cheap, strong reasoning      |
| Candidate 2      | `moonshotai/kimi-k2.6`       | Low cost, good quality             |
| Candidate 3      | `zhipu/glm-4.7`              | Budget alternative, solid baseline |
| Judge (Pairwise) | `google/gemini-2.5-flash`    | Fast judge, low per-token cost     |

Cheap council panel: `deepseek/deepseek-v4-flash`,
`google/gemini-2.5-flash`, `anthropic/claude-haiku-4.5`, aggregator
`moonshotai/kimi-k2.6`.

Cost expectations for a typical run (5 prompts × 3 candidates):
- **Pairwise**: ~$0.01–0.03 total (replay + judge calls)
- **Council** (3 panel + aggregator): ~$0.03–0.08 total

Rough estimates — actual cost depends on prompt and completion length.
