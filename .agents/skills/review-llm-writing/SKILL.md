---
name: review-llm-writing
description: Review prose for LLM clichés and AI-writing tells (negative parallelisms, "no X, no Y" chains, stage-managed reveals, "delve"-class vocabulary, echoing sentence runs) and rewrite the flagged sentences. Use when asked to de-AI, humanize, tighten, or review generated or suspected-generated writing, or before publishing blog posts, docs, announcements, PR descriptions, or social copy drafted with a model.
user-invocable: true
---

# Review and fix LLM writing

Detector adapted from Simon Willison's [LLM cliché highlighter](https://github.com/simonw/tools/blob/main/llm-cliche-highlighter.html), which catalogues the tells in Wikipedia's [Signs of AI writing](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing). The script finds the sentences. You do the rewriting.

## Workflow

1. Get the text into a file (or pipe it on stdin). For markdown, review the rendered prose, not code blocks or frontmatter.
2. Run the checker:

   ```bash
   bun .agents/skills/review-llm-writing/scripts/cliche-check.ts <file>
   bun .agents/skills/review-llm-writing/scripts/cliche-check.ts --json <file>
   bun .agents/skills/review-llm-writing/scripts/cliche-check.ts --list
   ```

   Exit code is 1 when anything is flagged, 0 when clean. `--disable <id>,<id>` turns patterns off (`colon-triple` is the usual candidate for technical docs, where "three things: a, b, and c" is often the clearest phrasing).

   The script does not strip markdown. Expect false hits on YAML frontmatter keys (`colon-triple` on `teaser: "..."`), on `-` list markers (`sentence-anaphora` opening "-"), and on decimals such as `1.1 hours`, which it splits as a sentence end. Judge those by the rendered prose and keep them.

3. For each finding, read the whole flagged sentence plus its neighbours and decide: rewrite, or keep on purpose. Apply the fixes from the table below. Rewrite the idea, do not just delete the trigger words. A sentence that lost its cliché but says nothing should go.
4. Re-run until the output is clean or every remaining hit is a deliberate keep you can defend in one sentence.
5. Do a final read for the things the regexes cannot see (section below), then report: what you changed, what you kept and why, and the before/after counts.

When the user asked only for a review, deliver the findings with a suggested rewrite per sentence and do not edit the source. When they asked to fix, edit in place and summarize.

## Fix guide by pattern

| Pattern id | What it is | How to fix |
| --- | --- | --- |
| `no-chain`, `did-not-chain` | "No fluff, no filler, no jargon." / "Did not flinch, did not blink." | Pick the one item that matters and state it positively, or state what the thing does instead of what it does not do. |
| `not-just`, `not-but` | "Not just X, but Y." / "It isn't X. It's Y." | Say Y directly. Drop the straw man X unless the reader actually believes X. |
| `dont-verb-it` | "Don't call it a rewrite. Call it a rescue." | Use the second name once, plainly. |
| `whole`, `is-the-whole`, `is-the-entire`, `the-entire-is`, `punchline` | "That's the whole point." / "Consistency is the entire game." / "The punchline is ..." | Delete the framing and let the point stand as its own sentence. |
| `heres-the-twist`, `turns-out`, `thats-the-part`, `the-only-i-trust`, `take-my-word` | Stage-managed reveals and narrowing superlatives | State the fact. If it is surprising the reader will notice without the drumroll. |
| `sit-with`, `worth-naming`, `not-nothing`, `already-know`, `is-real` | Therapist voice, false intimacy | Replace with the concrete consequence, number, or example the sentence was gesturing at. |
| `performative-honesty` | "I won't pretend", "Honestly,", "To be clear," | Cut the preamble. Keep the clause that follows it. |
| `x-is-dead`, `thats-why-mattered`, `stranded-auxiliary` | Obituary headlines, retroactive significance, "The tool died; the data didn't." | Write the claim as a plain comparative or causal sentence with both halves spelled out. |
| `stacked-questions` | Two or more rhetorical questions in a row | Answer the question you were going to answer anyway. Keep at most one question if it genuinely sets up the next paragraph. |
| `sentence-anaphora` | Three or more sentences opening on the same word ("Maybe ... Maybe ... Maybe ...") | Merge into one sentence with a list, or vary the openers so each sentence carries its own subject. |
| `echo-triad` | Consecutive sentences on the same skeleton | Combine into one sentence, or give each item a detail the others lack. |
| `colon-triple` | "It needs three things: a, b, and c." | Fine in reference material. In narrative prose, fold the items into the sentence or pick the one that matters. |
| `fits-in-your-head` | "batteries included", "zero config", "it just works" | Replace with the specific thing that is small, included, or configured. |
| `ai-vocab` | delve, tapestry, meticulous, pivotal, intricate, underscore, garner, bolster, vibrant, seamless, multifaceted, ever-evolving | Swap for the ordinary word (look into, careful, important, detailed, show, get, support, smooth). Two or more in one piece is a strong tell. |
| `note-that` | "It is important to note that", "It's worth noting" | Delete the phrase. The sentence after it survives on its own. |
| `testament`, `crucial-role`, `landscape`, `participle-tail`, `promo` | "stands as a testament", "plays a pivotal role", "ever-evolving landscape", ", highlighting the ...", "nestled in the heart of" | Say what happened and what it caused. Replace evaluation with a fact the reader can check. |
| `vague-experts` | "Experts argue", "some critics have noted" | Name the source or cut the claim. |
| `despite-challenges` | "Despite these challenges", "remains to be seen", "time will tell" | Name the challenge and the current state. Delete outlook filler. |
| `ai-leftovers` | "As an AI language model", "as of my last update", `oaicite`, `turn0search` | Delete. Check the surrounding paragraph, it was probably pasted without reading. |

## Things the regexes cannot see

Check these by hand on the final read:

- Paragraphs of identical length and shape, every one ending on a tidy one-line conclusion.
- A closing paragraph that restates the opening ("In summary", "Ultimately", "At the end of the day").
- Bolded lead-ins on every bullet, or bullets where full sentences would read better.
- Hedges stacked on claims that need none ("can potentially help to", "in many cases may").
- Em dashes used as the default connector. One per paragraph at most, and none if the house style forbids them.
- Sentences that are true of every product in the category. If you could swap the subject for a competitor and nothing breaks, the sentence has no content.
- Missing specifics: numbers, names, dates, file paths, error messages. Generated prose rounds these away.

## Judgment calls

- Quoted text, code, error messages, and product names are never findings. Do not rewrite them.
- One hit from a single pattern in a long piece can be coincidence. Density is the signal. Three hits in a paragraph means rewrite the paragraph, not the three phrases.
- Do not introduce a new cliché while removing one. Re-run the script after your edits, the rewrite is the most common place a `not-but` sneaks in.
- Preserve the author's voice and claims. You are removing tells and adding specifics, not changing the argument. If a sentence cannot be made specific because you lack the fact, leave a `TODO(specific):` marker or ask, do not invent one.

## Maintaining the pattern set

Patterns live in `scripts/cliche-check.ts` with a data-driven test table in `scripts/cliche-check.test.ts`. To add one, add a `patterns` entry with a `makeRegexFinder` (or a chain/echo finder) and at least one positive and one negative sample in the test table, then run `bun test .agents/skills/review-llm-writing/scripts/`. Before adding a pattern, check upstream for a newer version of the highlighter and port from there when it already covers the case.
