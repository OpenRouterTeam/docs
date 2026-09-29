---
name: routing-change-explainer
description: Turn a PR or local change that affects routing, adapters, or recursive requests into an animated, evidence-grounded explainer showing which endpoints each request reaches, which routing steps drop or mint candidates, how the request is reshaped at each hop, and which HTTP status the caller gets, before and after the change. Use when asked to visualize, explain, or diagram what a routing, provider-selection, BYOK, data-policy, adapter, or server-tools PR changes for a request. Builds on the animated-explainer plugin skill and ships a shared engine plus two worked examples.
argument-hint: '[PR URL or number, or "local diff"]'
---

# Routing change explainer

The output is one standalone HTML file that runs the same concrete request through `main` and through the PR, side by side, and shows where the two lanes diverge and what status each lane ends in. It answers three reviewer questions: which endpoint serves this request now, which step decided that, and what does the caller see when nothing survives.

It reuses the build and check harness of the `animated-explainer` plugin skill. Read that skill's harness section once. Unlike that skill, this one ships a shared engine, because routing changes share one visual grammar and reviewers learn it once.

## Files

- `engine/route-engine.js`: canvas engine, player, procedural sound, captions, and the text walkthrough. Draws four scene kinds from data. Do not fork it per PR. Fix or extend it here.
- `engine/page.template.html`: page shell with the player, walkthrough, outcome tables, and evidence list.
- `engine/make-page.py`: fills the template from `<example>/meta.json` and writes `<example>/page.html`, an intermediate that is not committed. It still has the `__FONT__` placeholder and local script tags until `build.py` inlines them.
- Not vendored: `build.py` and `check.py` come from the `animated-explainer` skill in the OpenRouterTeam/agent-plugins plugin. Step 8 fails without that plugin installed. To use a copy elsewhere, set `ANIMATED_EXPLAINER_SCRIPTS` to the `animated-explainer/scripts` directory that holds both files.
- `examples/declared-zdr-byok/`: PR 41335, endpoint pools through the data-policy look-forward and BYOK expansion. Read it for `pipeline` and `matrix` scenes.
- `examples/codex-server-tools/`: PRs 46300, 39482 and 46149, request shape and recursive context hop by hop. Read it for `hops` scenes.

## Workflow

1. **Read the change, not its summary.** Pull the PR diff, description, and tests with the builtin git tools. Open every routing step, adapter function, and plugin the diff touches in the repo checkout. The PR description is a claim to check. PR 41335 names a helper that no longer exists on main, so cite the current symbol.
2. **Find the boundary that changed.** Classify the change as one or more of the following and pick the matching scene kind.
   - Candidate endpoints are filtered, minted, reordered, or preserved: `pipeline`. Locate the steps in `packages/routing/index.ts` (the `routingSteps` order) and `packages/routing/step-fragments.ts` (`byokExpansionRoutingSteps`). Before-BYOK and after-BYOK halves of one policy live in `packages/routing/lifecycle/routing-policy-features.ts`.
   - The request is reshaped at an adapter, or a recursive internal request carries new context: `hops`. Adapters live in `packages/router/adapters/<provider>/`, server-tools recursion in `packages/router/plugins/server-tools/`, and the request-id signature gate and internal headers in `packages/router/index.ts`.
   - Several request variants end in different statuses: `matrix`. Every explainer ends with one.
3. **Pick concrete requests from tests.** Each lane is one real request, with its model, flags, keys, and candidate pool. Take them from the PR's tests where they exist (for routing, tests built on `runRoutingSteps` in `packages/routing/run-routing-steps.ts` run the production step order). Prefer the smallest pool that shows the change. Add a second scene where the status stays the same but the served endpoint changes, since that is the case reviewers miss.
4. **Trace both lanes by hand.** For each step or hop write the pool or payload before and after it. Stop the `main` lane at the step that yields the error and mark later steps `halt`. Record the exact status and the message the caller sees, and whether the error came from us (local) or from the provider.
5. **Enumerate the unchanged cases.** Put the cases the PR says it preserves (undeclared keys, required-key policy, other modalities such as video, requests without the flag) into the matrix. A matrix with only changed rows hides the blast radius.
6. **Label every scene's provenance.** Set `claim` on each scene to `tested` (asserted by a test you read), `observed` (you ran it or read the code path), `documented` (PR description or docs), `inferred`, or `illustrative`. A scene takes the weakest label of anything it shows, so a scene whose PR lane is tested but whose `main` lane comes from the PR description is `documented`, and the caption says which lane the tests assert. Put symbol names and file paths in `src`. The walkthrough prints both. Call out illustrative details in the caption, for example chip order inside a step the test does not assert.
7. **Write the example.** Copy one example directory, then edit `scenes.js` and `meta.json`. Captions carry the whole story with sound off. Keep hop labels under about 30 characters so they do not break mid-token.
8. **Build and check.**

   ```bash
   S=${ANIMATED_EXPLAINER_SCRIPTS:-$(find /opt/.devin/plugins ~/.claude/plugins ~/repos ~ -path '*/animated-explainer/scripts/build.py' -print -quit 2>/dev/null | xargs -r dirname)}
   [ -f "$S/build.py" ] && [ -f "$S/check.py" ] || { echo 'set ANIMATED_EXPLAINER_SCRIPTS or install the OpenRouterTeam/agent-plugins plugin' >&2; false; }
   python3 engine/make-page.py examples/<name>
   python3 $S/build.py examples/<name>/page.html ~/explainers/<name>.html
   python3 $S/check.py ~/explainers/<name>.html ~/explainers/shots-<name>
   ```

   The check must print `PASS`. Then open every scene PNG, `mobile.png`, and `sheet.png` and look for overlapping text, clipped chips, and labels that break inside a token. Keep built HTML and screenshots out of the repo and attach them to the PR or Slack thread instead.
9. **Deliver.** Attach the built HTML (it renders inline) plus the matrix scene PNG. The HTML is the artifact, the PNG is for readers who will not open it.

## Scene data

`scenes.js` calls `RX.start({scenes:[...]})`. Common fields are `kind`, `t` (title), `dur` (seconds), `cap` (caption and walkthrough text), `claim`, `src` (list of evidence strings), and `pr` (short PR URL shown top left).

- `title`: `eyebrow`, `heading`, `bullets`, and `legend: true` to draw the chip legend.
- `pipeline`: `request` (one line), `steps` (`[{name}]`, first entry is the candidate pool), `chips` (`{id: {name, tags}}`), and `before` / `after` lanes, each `{sub, pools, outcome, halt}`. `pools[k]` lists chip ids after step `k`. An entry `{id, kept: 1, label}` draws a dashed chip kept only because of a look-forward. A chip absent from the previous column is drawn as minted, one absent from the next as dropped. `halt: k` marks steps after `k` as not run. `outcome` is `{status, text}`.
- `hops`: `request`, `hops` (`[{name, sub}]`), and `before` / `after` lanes, each `{sub, events, outcome}`. `events` is the ordered path `[{h, label, status}]`, where `h` is a hop index. Backward moves draw as dashed return arcs.
- `matrix`: `rows` of `{case, before: {status, text}, after: {status, text}}`. Rows whose status or text differ are highlighted.

## Visual grammar

- Grape wash marks a column or row that differs between lanes. Status pills use the semantic positive and negative colors. Everything else is neutral, per the `viz` skill.
- Solid chip is a candidate. Purple fill is minted in this step. Dashed amber is preserved by a look-forward. Struck through and faded is dropped.
- Every state is also labelled in text, so the diagram reads without color.

## Gotchas

- `main` and PR lanes must describe the same request. If the PR also changes the pool (new endpoint, new provider), say so in `request` rather than silently changing the first column.
- A 404 from routing and a 400 from the provider mean different fixes. Always say which side produced the status, and for recursive requests show both the inner status and the one the outer caller sees.
- The checker sweeps every scene. Unknown chip ids or bad hop indexes show as an on-canvas error and fail the check.
