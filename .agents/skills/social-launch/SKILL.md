---
name: social-launch
description: Make the launch video and the social thread for any OpenRouter launch — a feature, a model, an API, an integration, or a CLI harness. Use this when something ships and needs a 4:3 X video plus a numbered post thread.
user-invocable: true
---

# Social launch kit

This skill is written in simple technical English. Keep it that way when you
edit it.

## 1. What you make

Each launch needs two items:

1. One MP4 video. Format 4:3. Size 1440x1080. Codec H.264. No audio.
2. One social thread. Numbered "1/ 2/ 3/" format. Plain text.

Make both. The video goes on post 1/.

Ask which surface the post is for. X is the normal answer.
X is also the reason for the 4:3 format and the large type.

Agree the copy with the owner before you render anything. A render cycle costs
minutes. A copy change after approval costs a new render of every cut.

## 2. Where the video code is

Workspace: `projects/social-video`.
It is beside `projects/remotion`. It is not inside it. It does not use Remotion.

The stack is HTML, CSS, GSAP, Playwright, and ffmpeg.
Playwright moves the GSAP timeline with `window.seekTo(t)` and saves one PNG per
frame. ffmpeg then makes the MP4. Every render gives the same result.

Read `projects/social-video/AGENTS.md` before you change any code there.

## 3. How to make a new video

Write one file. Change nothing else.

Copy the closest file in `projects/social-video/videos/` to
`videos/<launch-slug>.ts`. Then change only the words, the commands, and the
slug. The file is a typed config, so the schema tells you what is allowed.

A video is a list of scenes. Each scene has a kind and a duration.
The kinds are:

- `title`. A kicker, a headline, and two lede lines.
- `terminal`. A short list of shell commands that type themselves.
- `rows`. Short labelled proof points.
- `cta`. Two closing lines and the commands again. The schema needs at least
  one command here.

Use three scenes for a normal launch:

1. `title`, 5.25 seconds
2. `terminal` or `rows`, 5.75 seconds
3. `cta`, 2.6 seconds

Total time is 13.6 seconds. Keep this time unless the owner asks for another.
Add 0.5 seconds to the middle scene for each extra command.

Copy pattern:

- Kicker: the release class, in capitals. Example: `NEW ON ORI HARNESS`.
- Headline: the product name. Three words or fewer.
- Lede line 1: what it is, and that it runs on OpenRouter.
- Lede line 2: the one benefit that makes people care.
- CTA: "Start using <product>" and "today on OpenRouter".
- Footer: the short page for the launch. Example: `openrouter.ai/ori/harness`.

Keep every line short. A line that fits the design is more important than a
line that says everything.

For a terminal scene, set `enterTreatment` to `'press-recoil'`. The card moves
down and back when the last command runs. This shows the Enter key press.

## 4. Brand rules

Follow these rules. The design team checks them.

- Background is flat ink, `#03080A`. Do not add a grid. Do not add a gradient.
- Bright text is cloud, `#FCFCFE`.
- The accent on dark is volt, `#C8FF00`. Never use grape on dark.
- Headlines use Gordita. Body text and lede lines use Plus Jakarta Sans.
- Code and command text uses Geist Mono.
- Keep 60 pixels clear at each edge.
- Do not add a logo, a status label, or a dot before the kicker.

The type must be readable in the timeline before the reader opens the video.
This is the main rule for type size. Check it at small size, not full size.

## 5. The first frame is the poster

X and the other feeds use the first frame of the video as the still preview in
the timeline and in a quote post. Most readers see that frame and nothing else.
So the first frame must work alone, as a title card.

Rules for the first frame:

- Show the headline, the kicker, the lede, the mark, and the footer. All of
  them, in the first frame.
- Do not open on an empty card. An opening that fades in from nothing gives you
  a black poster frame.
- Move the first beat, do not reveal it. Elements may settle a short distance
  into place, but they start opaque and already legible.
- Keep the first frame inside the safe edges, like every other frame.
- Put nothing in the first frame that must stay private.

The render fails if the first frame is blank. Later blank frames are only
diagnostic output.

## 6. How to render

Run this command:

```bash
bun run --filter @openrouter-monorepo/social-video render <launch-slug>
```

Check the output. It must report:

- the frame count that matches your total time at 30 frames per second,
  for example 408 frames for 13.600 seconds
- `edge_band_hits=[]`
- a `blank_frames` list that does not contain frame 0

If `edge_band_hits` is not empty, some text is too close to an edge. Make the
text smaller or make the words shorter. Then render again.

Look at the first frame, and at one still frame from each scene, before you
send the file. Render a still with the same command and `--still <seconds>`:

```bash
bun run --filter @openrouter-monorepo/social-video render <launch-slug> --still 0
bun run --filter @openrouter-monorepo/social-video render <launch-slug> --still 3
```

Judge the `--still 0` frame as the poster. Read it at timeline size and ask
whether that frame alone would make a reader stop.

Send the MP4 to the owner and wait for approval before the post goes out.

## 7. How to write the thread

Structure:

- 1/ The launch line, one line on what it is, and the fastest way to use it.
- 2/ The main difference from the way people do this today.
- 3/ The thing that removes work from the reader, for example setup or install.
- 4/ The safety or correctness detail that a careful reader will ask about.
- 5/ The controls and limits. Name the real command or setting names.
- 6/ The same start steps again, and the docs link.

Use four posts for a small launch. Keep 1/, the main difference, one proof
point, and the closing post.

Rules:

- Use the product display name, not the internal name or the command name.
- Tag the partner company if there is one.
- Show commands or code as their own lines, with a `$` prompt for shell
  commands.
- End with: `Read more at: <link>`
- Use the same link in every post of the set, and the same link as the video
  footer.
- Slack turns some @ names into Slack user links. Check every @ name and every
  link after you paste the thread.
- Write plain text. Do not use bold, italics, or headers in the posts.

## 8. Check every claim before you post

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

## 9. Checklist by launch type

- Feature or product: show the smallest path to value in 1/. Name the surface
  it appears in.
- Model: name the provider, the context length, and the price. Take these from
  the model page data, not from memory.
- API or SDK: show one request or one code block. Name the version.
- CLI or harness: show the install command and the run command. Read
  `framework/cli/src/commands/<name>/command.ts` in `OpenRouterIncubator/ori`
  to learn whether the command starts the tool or only writes config. Name the
  environment keys it removes.

## 10. How to post

Posting goes through the Typefully v2 REST API. The key is the
`TYPEFULLY_API_KEY` secret. It is scoped to the requesting user, so if it is
not in your secrets, ask the owner. Never paste the key into a file, a log, or
a message.

```
Authorization: Bearer $TYPEFULLY_API_KEY
Base URL: https://api.typefully.com/v2
Schema:   GET /v2/openapi.json
```

### 10.1 Create a draft. Do not publish yet.

1. `GET /social-sets`, following `next` until it is null. Pick the set by
   `username`. The OpenRouter account is `OpenRouterAI`.
2. Upload the MP4: `POST /social-sets/{id}/media/upload` with
   `{"file_name":"<slug>.mp4"}`. The reply has `media_id` and `upload_url`.
3. `PUT` the file bytes to `upload_url` within one hour. Send no
   `Content-Type` header. A `Content-Type` header makes S3 return 403.
4. Poll `GET /social-sets/{id}/media/{media_id}` until `status` is `ready`.
   `failed` means start again from step 2.
5. `POST /social-sets/{id}/drafts` with `platforms.x.enabled: true` and one
   entry in `platforms.x.posts` per thread post. Add `media_ids: [media_id]`
   to post `1/`. Do not send `publish_at` or `plan_at`. Without them the
   draft is inert. Leave `share` false. A share link is public.
6. Send the owner the `private_url` from the reply. It needs a Typefully team
   login. Check that the draft text matches the approved copy word for word.

### 10.2 Publish only after explicit human approval

1. Wait for a human to write explicit approval to publish, with the draft
   link. A thumbs-up on the copy alone is not approval. Silence is not
   approval.
2. Only then `PATCH /social-sets/{id}/drafts/{draft_id}` with
   `publish_at` set to `"now"`, `"next-free-slot"`, or an ISO 8601 time with
   a timezone. Use the time the approver named.
3. Poll `GET /social-sets/{id}/drafts/{draft_id}` until `publish_state` is
   `finished`. Then require `status` to be `published` and `x_published_url`
   to be set before you send that URL to the owner. Anything else is a
   failure. Report it as one.

If the copy changes after the draft is made, edit the draft with `PATCH` and
go back to step 10.1.6. Approval does not carry over to new copy.

## 11. Two sample threads

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
