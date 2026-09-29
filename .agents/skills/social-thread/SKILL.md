---
name: social-thread
description: Write the numbered social thread for an OpenRouter launch — a feature, a model, an API, an integration, or a CLI harness — and the separate LinkedIn post when the launch goes to LinkedIn. Use this when a launch needs post copy for X or LinkedIn, on its own or as the copy step of social-launch.
user-invocable: true
---

# Social thread

This skill is written in simple technical English. Keep it that way when you
edit it.

## 1. Inputs and output

Inputs:

- What shipped, with a link to the code, PR, or docs that prove it.
- The launch link. Example: `openrouter.ai/ori/harness`. Every post and the
  video footer use this same link.
- The surface. X is the normal answer. A launch that also goes to LinkedIn gets a second, separate piece of copy. See section 7.

Output: one thread in numbered "1/ 2/ 3/" format. Plain text. Plus one LinkedIn post when LinkedIn is a surface.

Agree the copy with the owner before anything is rendered or drafted from it.
A copy change later costs a new video render and a new Typefully draft.

## 2. Structure

- 1/ The launch line, one line on what it is, and the fastest way to use it.
- 2/ The main difference from the way people do this today.
- 3/ The thing that removes work from the reader, for example setup or install.
- 4/ The safety or correctness detail that a careful reader will ask about.
- 5/ The controls and limits. Name the real command or setting names.
- 6/ The same start steps again, and the docs link.

Use four posts for a small launch. Keep 1/, the main difference, one proof
point, and the closing post.

## 3. Rules

- Use the product display name, not the internal name or the command name.
- Tag the partner company if there is one. On X the tag is the `@handle`. On LinkedIn it is a different syntax, see section 7.
- Show commands or code as their own lines, with a `$` prompt for shell
  commands.
- End with: `Read more at: <link>`
- Use the same link in every post of the set, and the same link as the video
  footer.
- Slack turns some @ names into Slack user links. Check every @ name and every
  link after you paste the thread.
- Write plain text. Do not use bold, italics, or headers in the posts.

## 4. Check every claim

Do not trust the last launch thread. Do not trust the marketing page.
Read the code or the API that ships the feature.

For each sentence in the thread, ask:

- Does the source show this?
- Does it show it for this release, or for a similar one?
- Are the names exact? Check command names, flag names, file names, and
  environment variable names, letter by letter.
- Does the claim say "never" or "nothing"? A strong word needs a strong source.
  Name the limit instead, for example "nothing in your config changes".
- Is a listed item now missing? Add new items, for example a new command in a
  list of commands.

Two failures repeat. Watch for both:

- A name that is right for one product and wrong for another. Example: the Ori
  Prime extension registers `/speed`, because Prime Agent already has a
  built-in `/fast` that shadows extension commands. The DeepSeek plugin does
  use `/fast`.
- A claim that is true for the run but not for the install. Example: a launch
  writes no config file, but the installer still writes a binary.

State facts you checked. Mark anything else as a guess, or remove it.

## 5. Checklist by launch type

These apply to the X thread and to the LinkedIn post.

- Feature or product: show the smallest path to value in 1/. Name the surface
  it appears in.
- Model: name the provider, the context length, and the price. Take these from
  the model page data, not from memory.
- API or SDK: show one request or one code block. Name the version.
- CLI or harness: show the install command and the run command. Read
  `framework/cli/src/commands/<name>/command.ts` in `OpenRouterIncubator/ori`
  to learn whether the command starts the tool or only writes config. Name the
  environment keys it removes.

## 6. Two sample threads

Both samples are CLI launches. The shape works for other launch types.

### Sample A. Ori Prime Agent

```text
1/ Today, we are launching Ori Prime Agent

Run @PrimeIntellect Agent directly on OpenRouter. Your credentials, your models, and your environment set up for you, on Prime Agent

$ curl -fsSL openrouter.ai/labs/ori/install.sh | bash
$ ori prime

2/ Ori Prime never writes your auth.json or your models.json.

Your key arrives through a bundled extension for that run only, so your existing Prime Agent setup is exactly as you left it.

3/ Don't have Prime Agent installed? Ori will offer to install it for you and launch straight into it.

You don't need to pre-install anything. ori claude / ori codex / ori opencode / ori hermes / ori pi / ori grok / ori prime bootstrap the harness for you.

4/ Prime Agent picks up provider keys from your environment, so a leftover ANTHROPIC_API_KEY or OPENAI_API_KEY won't silently compete with OpenRouter — Ori strips them before the run. Every request goes off your OpenRouter key.

5/ /model becomes your account's catalog, with your guardrails applied, and non-OpenRouter providers stay filtered out after every registry refresh. Add /speed on for speed routing or /zdr on for zero-retention providers, and both persist with the session.

6/ Install Ori and start Prime Agent on OpenRouter in one command:

$ curl -fsSL openrouter.ai/labs/ori/install.sh | bash
$ ori prime

Read more at: openrouter.ai/ori/harness
```

### Sample B. Ori Grok Build

```text
1/ Today, we are launching Ori Grok Build

Run @xai Grok Build directly on OpenRouter. Your credentials, your models, and your environment set up for you, on Grok Build

$ curl -fsSL openrouter.ai/labs/ori/install.sh | bash
$ ori grok

2/ No grok login.

Ori starts Grok Build in custom-endpoint mode and hands it your OpenRouter key for that run only, so there's no browser login and nothing in your Grok config changes.

3/ Don't have Grok Build installed? Ori will offer to install it for you and launch straight into it.

You don't need to pre-install anything. ori claude / ori codex / ori opencode / ori hermes / ori pi / ori prime / ori grok bootstrap the harness for you.

4/ Grok Build picks up provider keys from your environment, so a leftover GROK_CODE_XAI_API_KEY or GROK_DEPLOYMENT_KEY won't silently compete with OpenRouter — Ori strips them before the run. Every request goes off your OpenRouter key.

5/ Your model list becomes your OpenRouter catalog, private endpoints included, refreshed straight from your account. Grok's own flags pass through untouched, so -m / --model and --reasoning-effort work exactly as they do today. xAI telemetry, error reporting, and trace upload are all pinned off for the run.

6/ Install Ori and start Grok Build on OpenRouter in two commands:

$ curl -fsSL openrouter.ai/labs/ori/install.sh | bash
$ ori grok

Read more at: openrouter.ai/ori/harness
```

## 7. LinkedIn post

Never send the X thread to LinkedIn as is. Write one LinkedIn post from the agreed thread. The facts are the same. The shape is not.

- One post, not a thread. Keep it short and on one idea: the launch and the fastest way to use it.
- The first line has to carry the post on its own. LinkedIn cuts the post after the first lines and shows "see more". Put the launch line first, not "Today, we are launching".
- No links in the post body. Every link, including `Read more at:`, goes into the first comment after the post is live. A link in the body lowers reach and turns into a preview card that competes with the video. So the LinkedIn post has no `Read more at:` line.
- One CTA, and it contains no URL. A command with no URL in it, like `$ ori prime`, can be the CTA. A `curl <url> | bash` installer is a link and follows the link rule: it goes into the first comment together with the docs link. Pick one CTA for the body, the rest goes in the comment.
- Attach the native video or image. Do not rely on a link preview for the visual.
- Tag the partner company and any named people. A tag only works with LinkedIn mention syntax `@[Company Name](urn:li:organization:ID)`. An X handle like `@OpenAI` posts as plain text on LinkedIn. `typefully-post` resolves the URN from the company's LinkedIn URL, so write the company display name in the copy and list the companies to tag under the post. The URN goes in at draft time. People are tagged by hand in the Typefully editor, not written as URNs in the copy. List them under the post with their display name and LinkedIn profile URL.
- Plain text. No bold, no headers, no hashtags unless the owner asks.

Hand over the LinkedIn post as: the post text, the list of companies to tag with their LinkedIn URLs, the list of people to tag with their display names and LinkedIn profile URLs, and the comment text with the links. Agree all four with the owner before drafting.

### Sample. Ori Prime Agent on LinkedIn

```text
Post:
Ori Prime Agent is live. Run Prime Intellect Agent directly on OpenRouter, with your credentials, your models, and your environment set up for you.

Ori hands Prime Agent your OpenRouter key for that run only. It never writes your auth.json or models.json, and it strips leftover ANTHROPIC_API_KEY or OPENAI_API_KEY from the environment so nothing competes with OpenRouter. Your /model list becomes your account's catalog with your guardrails applied.

With Ori installed, one command to start:
$ ori prime

Tag: Prime Intellect (https://www.linkedin.com/company/primeintellect)

First comment:
Install Ori:
$ curl -fsSL openrouter.ai/labs/ori/install.sh | bash
Docs and the full list of supported harnesses: openrouter.ai/ori/harness
```
