---
name: slack-mrkdwn
description: >-
  Formatting contract for text posted to Slack through the native `slack` tool
  or a Slack MCP `post_message` call, where the text is sent verbatim as Slack
  mrkdwn. Use whenever a skill or automation prompt composes a channel message,
  thread reply, or digest for Slack. Covers bold, bullets, links, tables, the
  two Slack surfaces that render differently, and a pre-post sanity check.
---

# Slack mrkdwn

## Two surfaces, two syntaxes

Text reaches Slack through two different paths, and they render differently.
Pick the syntax from the path, not from habit.

| Path | What Slack receives | Syntax |
| --- | --- | --- |
| The session's own chat reply, mirrored into the Slack thread the session was started from | Markdown, translated by the mirror | Standard Markdown: `**bold**`, `- ` bullets, `[label](url)` |
| The native `slack` tool, or a Slack MCP `post_message` / `slack_post_message` call | The string verbatim | Raw mrkdwn, below |

Report skills and automation prompts almost always take the second path. A
`**bold**` heading sent that way renders as literal asterisks and a leading
`- ` stays a literal hyphen.

## Raw mrkdwn rules

| Element | Write | Never |
| --- | --- | --- |
| Bold | `*bold*` (one asterisk each side) | `**bold**` |
| Italic | `_italic_` | `*italic*` |
| Inline code | `` `code` `` | |
| Code block | triple backticks on their own lines | indented blocks |
| Bullet | line starting with `•` followed by a space | `- `, `* `, `1.` |
| Nested bullet | four spaces then `◦` | indented `- ` |
| Link | `<https://url|label>` | `[label](https://url)` |
| User / channel mention | `<@U0123ABC>` / `<#C0123ABC>` | `@name`, `#name` |
| Heading | a `*bold*` line on its own | `#`, `##` |
| Table | triple-backtick block with fixed-width columns, or an attached CSV | Markdown pipe tables |
| Rule | blank line | `---` |
| Emoji | `:bar_chart:` | |

Escape `&`, `<`, `>` as `&amp;`, `&lt;`, `&gt;` inside quoted log lines and
error messages so Slack does not parse them as mentions or links.

Slack has no list syntax: `•` and `◦` are literal characters and Slack does
not indent or wrap them. Keep bullet text short enough to read on one line.

Message length: keep a top-level message under ~3000 characters and a
threaded reply under ~4000. Put detail in the thread, not the head message.

## Sanity check before posting

Run the composed text through these checks and fix any hit before calling the
post tool:

- No line contains `**`.
- No `](http` (Markdown link).
- Outside triple-backtick blocks, no line starts with `- `, `* `, `#`, or `|`
  (pipe table).
- Every `<url|label>` has a scheme and a label.

## Threads

Post exactly one top-level message, keep the `ts` the tool returns, and pass
it as `thread_ts` for every reply. Never post a second top-level message to
correct the first; put the correction in the thread.

## Slack canvases

Canvases use standard Markdown, not mrkdwn: `**bold**`, `- ` bullets,
`![](@U0123ABC)` for user mentions and `![](#C0123ABC)` for channel
mentions. See `create-post-mortem` for the conversion.
