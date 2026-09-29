---
title: "Image Benchmarks: See the Capabilities of Every Model"
date: "2026-08-21T00:00:00.000Z"
updated: "2026-09-03T14:40:53.000Z"
author: "Brian Thomas"
teaser: "We ran 39 image models through 15 deliberately hard prompts and put every result on one page. Compare fill levels, finger counts, poster text, and edits side by side, with the price and generation time under each image."
category: "announcements"
headerImage:
  url: "/images/image-benchmarks.png"
  width: 1344
  height: 768
metaDescription: "Compare 39 image models side by side on 15 hard prompts covering text rendering, counting, spatial relations, negation, and editing, with cost and generation time per image."
---

Unlike choosing a text model, where we have a vast array of LLM benchmarks, picking an image model can feel arbitrary. Output samples tend to be curated eye candy and LLM-as-a-judge evals can't yet capture the details a human would notice instantly. While arena scores help, they evaluate which outputs people prefer rather than what a model can actually do.

Today we're launching [Visual Image Benchmarks](https://openrouter.ai/benchmarks/media/images) to help you quickly evaluate the capabilities of all the image models we offer (39 as of August '26). We've selected a set of challenging prompts designed to differentiate the capabilities of models, and show every result in a grid with sorting for both price and generation time.

<video src="/videos/image-benchmarks.mp4" poster="/images/image-benchmarks/video-poster.jpg" width="1168" height="720" autoplay loop muted playsinline controls preload="metadata" aria-label="Scrolling through image benchmark grids for several prompts, each model output labeled with model name, price, and generation time"></video>

## Prompts designed to test the boundaries of image model capabilities

Each challenge is designed to differentiate the capabilities of image models. We've initially grouped them into seven families:

- **Improbable scenes.** A wine glass filled level with the rim, umbrellas that are closed. Training data is full of the ordinary version of both.
- **Counting.** Three fingers, specific numbers of cards and dice.
- **Text.** One long exact string on a poster, and several languages in the same frame.
- **Spatial relations.** Occlusion and mirror reflections.
- **Negation.** A zebra with no stripes, a Times Square with no advertising.
- **Editing.** Minimal diffs, object removal, person removal, all from a reference image.
- **Consistency.** Holding a product or four reference subjects steady across a new scene.

The prompts are written so you can instantly evaluate them visually. For example, can a model follow the instruction to fully fill a wine glass?

![Full Wine Glass challenge sorted by cost, with the prompt above the grid and each wine glass output labeled with model name, price, and generation time](/images/image-benchmarks/wine-glass-grid.png)

## More visual evals and additional modalities coming soon

It's similarly challenging to evaluate video and audio models to understand their quality and capabilities. We intend to expand this tool out across modalities as well as keep it up to date with all the new image models we add.

Check out our [image benchmarks](https://openrouter.ai/benchmarks/media/images) today! If you have any prompts that could challenge the next round of models, share it with us in [#feedback](https://discord.gg/fVyRaUDgxW) on our Discord.

## Generating images via the OpenRouter API and Chat

Once you've evaluated models via these benchmarks, try them on your own prompts through the [image generation API](https://openrouter.ai/docs/guides/overview/multimodal/image-generation) or [Chat](https://openrouter.ai/chat) to see how they perform on your own content.
