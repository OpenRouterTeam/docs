---
name: social-launch
description: Run the full social launch for any OpenRouter launch — a feature, a model, an API, an integration, or a CLI harness. Sequences social-thread, social-video, and typefully-post. Use this when something ships and needs the X thread, the 4:3 video, and the Typefully post together.
user-invocable: true
---

# Social launch

This skill is written in simple technical English. Keep it that way when you
edit it.

This skill does no work of its own. It calls three skills in order and passes
the outputs between them. Use a single skill directly when you only need one
item.

| Step | Skill            | Output                                    |
| ---- | ---------------- | ----------------------------------------- |
| 1    | `social-thread`  | Numbered thread, plain text               |
| 2    | `social-video`   | 4:3 MP4, 1440x1080, H.264, no audio       |
| 3    | `typefully-post` | Typefully draft, then the published X URL |

## 1. Collect the inputs once

Ask for these before step 1. Every skill uses the same values.

- What shipped, with the code, PR, or docs that prove it.
- The launch slug. Example: `ori-prime`.
- The launch link. Example: `openrouter.ai/ori/harness`. It is the last line
  of the thread and the footer of the video.
- The surface. X is the normal answer.

## 2. Run the steps

1. `social-thread`. Stop and get the owner's agreement on the copy. Nothing
   after this step starts until the copy is agreed.
2. `social-video`. Take the kicker, headline, lede, commands, and CTA from the
   agreed thread. Send the MP4 to the owner and get approval.
3. `typefully-post`. Create the draft with the thread and the MP4 on post
   `1/`. Send the `private_url`. Publish only after a human writes explicit
   approval to publish.

## 3. When something changes

- Copy changes after step 1: run steps 2 and 3 again. Approval of the old copy
  does not carry over.
- Video changes after step 2: upload the new MP4 and update the draft. Get
  approval for the video again. Copy approval stands if the words did not
  change.
- Draft changes after step 3: follow the change rules in `typefully-post`.
