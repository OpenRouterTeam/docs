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

| Step | Skill            | Output                                                          |
| ---- | ---------------- | --------------------------------------------------------------- |
| 1    | `social-thread`  | Numbered thread, plain text. Plus one LinkedIn post if LinkedIn |
| 2    | `social-video`   | 4:3 MP4, 1440x1080, H.264, no audio                             |
| 3    | `typefully-post` | Typefully draft, then the published X URL and LinkedIn URL      |

## 1. Collect the inputs once

Ask for these before step 1. Every skill uses the same values.

- What shipped, with the code, PR, or docs that prove it.
- The launch slug. Example: `ori-prime`.
- The launch link. Example: `openrouter.ai/ori/harness`. It is the last line
  of the thread and the footer of the video.
- Whether the launch is embargoed. Ask the owner this directly, every time, before any calendar work or copy. The Social Media Calendar is read by people who are not privy to unannounced launches. The launch is embargoed when the owner says so, when anyone calls it stealth, embargoed, under NDA, or not public until a date, when the request or thread is in `#model-launches-private` (always embargoed, but still ask so the answer is on record), or when the request comes from any private Slack channel or DM and nobody has said the launch is public. Until a human answers, treat it as embargoed.
- The post time. If the launch already has a calendar entry (the caller passes its page URL), reuse it and skip the query and creation below. Otherwise remind the owner that the post must be scheduled on the [Notion Social Media Calendar](https://app.notion.com/p/openrouter/Social-Media-Calendar-f4e2fd57c4dc839c82b901c204ca8b8c). Before proposing a time, query its Posts database (Notion MCP data source `collection://7222fd57-c4dc-8269-bc79-872c28c0ccf1`) and report any post within about two hours of the candidate slot on the same platform. An occupied slot is a stop. Do not propose or schedule into it. Talk through a backup (another time or platform mix) with the owner and get it confirmed first. Calendar times are UTC, so state ET and UTC. After the owner confirms the time and has answered the embargo question, query the same window again. If it is still clear, add the entry (Content Type per launch type, Status `Planning`, platforms, DRI) and share the page URL. If a new post now conflicts, stop, report it, and talk through a backup before writing anything. After step 3 creates the Typefully draft, put the draft link in the entry and set Status `Scheduled`. Never move another DRI's entry.
  - Embargoed launch: the entry is a vague placeholder and nothing more. Title `EMBARGO model launch - PT AM (1)`, incrementing the number if another placeholder already holds that slot. Date only, on the launch date (new models usually post before noon PT, so the morning PT date). Content Type `Model / Provider Launch`, Status `Planning`, platforms X and LinkedIn unless told otherwise, DRI, blank body. Do not put the model or provider name, codename, feature, copy, draft link, internal doc link, or Slack link anywhere on the page. Do not set Status `Scheduled` or add the Typefully link after step 3. The draft link and any calendar conflicts go to the private thread only. Do not rename or fill in the placeholder after the embargo lifts unless the DRI asks.
  - Link the placeholder from the private tracker. The `Private - Model Launch Calendar` (Notion MCP data source `collection://3c82fd57-c4dc-8077-950c-000b95108ff1`) has a `Social post` URL property. Find the launch's row there and set `Social post` to the calendar entry's page URL. The link points one way, private to public, so it reveals nothing on the public calendar. Never add a relation or backlink on the public side. If the launch has no row, say so in the thread.
  - Launch goes public: edit the existing placeholder, do not create a second entry. Find it through the `Social post` link on the private tracker, or failing that the placeholder whose DRI is the owner, and confirm with the owner. Rename it, set the exact UTC time, set Status `Scheduled`, and add the copy or draft link to the body. The Notion MCP cannot trash a page, so a duplicate is hard to clean up.
- The X search queries to rank for. List the queries a user would type on X to find this launch without typing "openrouter". Start with the product or model name alone (`jev`), then the name plus the words people pair with it (`jev docs`, `jev api`, `jev gateway`, `jev router`). Before step 1, run each query on X (`https://x.com/search?q=<query>&f=top`, with the query URL-encoded) and note who shows up. A competitor holding a query, or nobody holding it, is a gap the thread should fill. Pass the list to `social-thread`: post `1/` must contain the exact query phrases as written, not synonyms, so the thread has a chance to rank for them. Video text does not count, only the post text. After publish, run the same queries again and report which ones surface the thread.
- The surface. X is the normal answer. If LinkedIn is included, `social-thread` writes a separate LinkedIn post and `typefully-post` enables the LinkedIn platform on the draft with resolved company mentions.

## 2. Run the steps

1. `social-thread`. Check that post `1/` contains every X search query from the inputs word for word. Stop and get the owner's agreement on the copy. Nothing
   after this step starts until the copy is agreed.
2. `social-video`. Take the kicker, headline, lede, commands, and CTA from the
   agreed thread. Send the MP4 to the owner and get approval.
3. `typefully-post`. Create the draft with the thread and the MP4 on post
   `1/`. Send the `private_url`. Publish only after a human writes explicit
   approval to publish. If LinkedIn is a surface, the same draft carries the LinkedIn post with the MP4 and the resolved tags. The first comment with the links is posted by hand after publish.

## 3. When something changes

- Copy changes after step 1: run steps 2 and 3 again. Approval of the old copy
  does not carry over.
- Video changes after step 2: upload the new MP4 and update the draft. Get
  approval for the video again. Copy approval stands if the words did not
  change.
- Draft changes after step 3: follow the change rules in `typefully-post`.
