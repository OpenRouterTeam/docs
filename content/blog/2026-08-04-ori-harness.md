---
title: "Ori Harness: The Best Way to Use OpenRouter with Any Harness"
date: "2026-08-04T00:00:00.000Z"
author: "OpenRouter"
category: "announcements"
metaTitle: "Ori Harness: Use OpenRouter with Claude Code, Codex, OpenCode, and Hermes"
metaDescription: "Install the ori CLI, log in with OpenRouter, and run Claude Code, Codex, OpenCode, or Hermes with an optimized configuration out of the box. No ad-hoc scripts, no environment variable spelunking."
teaser: "Using OpenRouter with your favorite harness usually means ad-hoc scripts or a wall of environment variables. Install the ori CLI, log in once, and every supported harness runs with an optimized configuration out of the box."
headerImage:
  url: "/images/ori-harness.png"
  width: 1584
  height: 672
faq:
  - question: "What is ori harness?"
    answer: "ori harness runs the agent CLI you already use on OpenRouter. `ori claude`, `ori codex`, `ori opencode`, and `ori hermes` each launch the real harness with OpenRouter wired in and configured for the model you picked. The commands, keybindings, and flags stay the same."
  - question: "Why do I need this if I can just change a few settings?"
    answer: "Some harnesses need one environment variable. Others, like Claude Code, need a dozen to match the experience of the first-party harness, including model tier defaults, gateway model discovery, and tool search. ori sets those for you, and adjusts them per model instead of hard-coding a single profile."
  - question: "Which harnesses are supported today?"
    answer: "Claude Code (`ori claude`), Codex (`ori codex`), OpenCode (`ori opencode`), and Hermes (`ori hermes`), with more on the way."
  - question: "What does tool search change?"
    answer: "On Anthropic models, enabling tool search saves almost half the system prompt in tokens, and it is the default on modern Claude models when Claude Code detects the first-party harness. It also changes behavior: with tool search off, Claude uses more tokens and more turns for the same task, and reaches for the Todo tool more often. Most open models do not support tool search at all, so ori reads your `--model` flag and only enables it where it helps."
  - question: "Do I need an API key?"
    answer: "No. Run `ori login` and sign in with your existing OpenRouter account. Your models, credits, and org settings come with the login."
  - question: "How do I install ori?"
    answer: "Run `curl -fsSL https://openrouter.ai/labs/ori/install.sh | bash`, then `ori login`."
  - question: "Where do I send feedback or request a harness?"
    answer: "Join the OpenRouter Discord and leave a note in the #ori-feedback channel."
---

We often see folks trying to use OpenRouter with their favorite harnesses resort to writing [ad-hoc scripts](https://x.com/xlr8harder/status/2081834210445152438) or complex config to tweak them to fit just right. Some harnesses require minimal configuration, maybe just one environment variable, but others like Claude Code require many more.

You can now install the [ori CLI](https://openrouter.ai/ori/harness), log in with OpenRouter, and immediately have an optimized configuration right out of the box that works with all your favorite harnesses:

```sh
# Install ori cli
curl -fsSL https://openrouter.ai/labs/ori/install.sh | bash

ori login # Log in to OpenRouter

# Set up and optimized for OpenRouter
ori claude
ori codex
ori opencode
ori hermes
# ... more to come
```

## Why do I need this if I can just change a few settings?

When using a gateway like OpenRouter, to get the same out-of-the-box experience with Claude Code as you get using Anthropic's first-party harness, there's a _lot_ of environment variables you need to set...

```sh
ANTHROPIC_BASE_URL=https://openrouter.ai/api
ANTHROPIC_AUTH_TOKEN=<openrouter-api-key>
ANTHROPIC_API_KEY=
OPENROUTER_API_KEY=<openrouter-api-key>
CLAUDE_CODE_SKIP_FAST_MODE_ORG_CHECK=1
CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY=1
ENABLE_TOOL_SEARCH=true
CLAUDE_CODE_SIMPLE_SYSTEM_PROMPT=1
ANTHROPIC_DEFAULT_HAIKU_MODEL=~anthropic/claude-haiku-latest
ANTHROPIC_DEFAULT_SONNET_MODEL=~anthropic/claude-sonnet-latest
ANTHROPIC_DEFAULT_OPUS_MODEL=~anthropic/claude-opus-latest
ANTHROPIC_DEFAULT_FABLE_MODEL=~anthropic/claude-fable-latest[1m]
ANTHROPIC_DEFAULT_FABLE_MODEL_NAME=Fable
```

For Anthropic models, enabling `ENABLE_TOOL_SEARCH` will save you almost half the system prompt in tokens, and is the default setting on modern Claude models... _when Claude Code detects the first-party harness_.

Tool search meaningfully changes the agent's behavior as well: when tool search is disabled, Claude uses more tokens, more turns to accomplish the same task, and uses the Todo tool more!

However, most open models today do not support tool search at all. In `ori claude`, we detect your `--model` flag and switch the settings to be most optimal for the model you're using. In the future, we plan to take this further and optimize tool settings, system prompt verbosity, and more depending on the model.

## That's it

Claude Code is a particularly tricky example, but we'll be optimizing ori harness for many harnesses. Today we support:

- Claude Code
- Codex
- OpenCode
- Hermes

Please give it a try!

Some future plans and ideas:

- Better support desktop apps
- A toolbar widget to track your usage, and toggle global switching to OpenRouter
- Including WebSearch plugins out of the box for harnesses like OpenCode and Pi

If any of those sound appealing, or if you have feedback on a harness you'd like us to support, please join the [Discord](https://discord.com/invite/openrouter) and leave us a note in the #ori-feedback channel.
