---
name: social-video
description: Render the 4:3 launch video for an OpenRouter launch from the projects/social-video workspace (HTML, GSAP, Playwright, ffmpeg). Use this when a launch needs an X video, on its own or as the video step of social-launch.
user-invocable: true
---

# Social video

This skill is written in simple technical English. Keep it that way when you
edit it.

## 1. Inputs and output

Inputs:

- Approved copy: kicker, headline, lede lines, commands or proof points, CTA.
  If the thread exists, take these from it so the two agree.
- The launch slug. Example: `ori-prime`.
- The launch link for the footer. Example: `openrouter.ai/ori/harness`.

Output: one MP4. Format 4:3. Size 1440x1080. Codec H.264. No audio.
4:3 and the large type are for the X timeline.

Do not render before the copy is agreed. A render cycle costs minutes. A copy
change after approval costs a new render of every cut.

## 2. Where the code is

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

Send the MP4 to the owner and wait for approval before it is attached to any
post.
