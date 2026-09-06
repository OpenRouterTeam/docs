---
name: test-learn-course
description: >-
  Test the /learn course (learn-course-content.ts) locally through a single file,
  without deploying. Simulates a coding agent + learner conversation over the
  local course content, grades the transcript for teaching behavior, and can
  reproduce lossy summarizing fetchers (the Hermes failure mode). Use when
  changing the /learn course or evaluating whether it actually teaches.
allowed-tools: Bash
user-invocable: true
---

# Test the /learn Course Locally

The /learn course is the markdown served at `https://openrouter.ai/learn.md`,
defined in `projects/web/app/[locale]/(static)/learn/learn-course-content.ts`. It instructs
any AI agent to act as an OpenRouter tutor. This skill tests that content
locally through one file, so edits can be evaluated before deploying.

## Requirements

An OpenRouter API key:

```bash
export OPENROUTER_API_KEY=sk-or-...
```

## Usage

All commands run from the repo root.

Simulated end-to-end run (agent + simulated learner + grading):

```bash
bun .agents/skills/test-learn-course/scripts/simulate.ts
```

Play the learner yourself:

```bash
bun .agents/skills/test-learn-course/scripts/simulate.ts --interactive
```

Reproduce the lossy-fetcher failure mode (some agents, like Hermes, summarize
fetched pages with a cheap auxiliary model, which strips the teaching
directives):

```bash
bun .agents/skills/test-learn-course/scripts/simulate.ts --summarized
```

Dump the current course markdown (e.g. to point a real local agent at a file):

```bash
bun .agents/skills/test-learn-course/scripts/simulate.ts --print > /tmp/learn-course.md
```

Other options: `--turns <n>` (default 6), `--agent-model <id>`
(default `anthropic/claude-sonnet-4.5`).

## What the grader checks

After the conversation, a judge model scores the agent transcript 0-10 on:

1. Explaining concepts before showing code
2. Ending lessons with comprehension checks
3. Pacing (one concept per turn, control handed back to the learner)
4. Not building ahead of the current lesson
5. Connecting concepts to the learner's mission

If the overall score is low, the course content needs stronger teaching
directives, not more curriculum.

## Testing against a real agent

The simulation approximates agent behavior. For a real test, run `--print` to a
file and tell a local coding agent (Hermes, Claude Code, etc.) to read that file
and teach you. Watch for the failure modes listed in the course's "You are
off-course if" section.
