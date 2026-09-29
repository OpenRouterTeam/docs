# Skills are living documents

Every skill in this directory is a living document. Codebases move, external
agents change behavior, and each run hits at least one gotcha the skill didn't
predict. Updating the skill is part of executing it — a run that leaves the
skill unchanged is suspicious: either it went perfectly or you didn't look.

Before finishing any task where you followed a skill, diff what the skill
predicted against what actually happened:

1. **New steps or sites**: did the work require something the skill doesn't
   mention? Add it, anchored to a file path or PR number.
2. **Stale entries**: did a referenced file, command, or behavior move or
   stop being relevant? Fix or delete it. Dead entries erode trust in all
   the live ones.
3. **New gotchas**: did anything bite you (review feedback, CI failure,
   post-merge fix, agent quirk)? Capture it as one line. Keep it at the
   level of "what to check", not one-time incident detail — that goes
   stale fastest.
4. **Over-specific entries**: if an entry names internals that have since
   been refactored, lift it back up to the durable principle.

Skill edits ship in the same PR as the work (or a small follow-up if the
work has no PR). A skill may add its own domain-specific "Improve this
skill" section, but it doesn't need to restate this principle.

## This document is a living document too

Added 2026-07-21 by jakob (`jakobdylanc`), in PR #29566 — tomas's
(`ping-Toven`) model-launch-runbook PR that jakob hijacked for this —
generalized from `onboard-frontier-model`, which had proven the pattern
per-skill. Applying it to the whole skills
folder is a big blast radius: every agent run that touches any skill now
gets nudged to edit it. The known risk is over-editing — a flood of
low-value skill diffs, especially early on. Calibration: only record
learnings that would have changed what you did; a perfectly clean run
legitimately produces no edit. If in practice this principle causes too
many noisy skill edits (or too few useful ones), tweak or scope down this
file itself — it is subject to its own rule.
