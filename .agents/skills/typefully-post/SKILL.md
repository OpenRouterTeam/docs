---
name: typefully-post
description: Create a Typefully draft for the OpenRouterAI X account, and the LinkedIn company page when the launch goes there, from approved copy and optional MP4 media, then publish it only after explicit human approval. Use this to post a thread or a LinkedIn post to Typefully, on its own or as the posting step of social-launch.
user-invocable: true
---

# Typefully post

This skill is written in simple technical English. Keep it that way when you
edit it.

## 1. Inputs and output

Inputs:

- If X is a surface: approved thread copy, one entry per post.
- Optional MP4 to attach to post `1/`, and to the LinkedIn post.
- If LinkedIn is a surface: the approved LinkedIn post, the companies to tag with their LinkedIn URLs, the people to tag with their display names and LinkedIn profile URLs, and the first-comment text. See `social-thread` section 7.
- The publish time, only once a human has approved publishing.

A draft carries one or both surfaces. Enable only the platforms the draft publishes to.

Output: a Typefully draft, then, after approval, the published URL of each platform enabled on the draft: the X URL when X is enabled, the LinkedIn URL when LinkedIn is enabled.

## 2. Access

Posting goes through the Typefully v2 REST API. The key is the
`TYPEFULLY_API_KEY` secret. It is scoped to the requesting user, so if it is
not in your secrets, ask the owner. Never paste the key into a file, a log, or
a message.

```
Authorization: Bearer $TYPEFULLY_API_KEY
Base URL: https://api.typefully.com/v2
Schema:   GET /v2/openapi.json
```

## 3. Create a draft. Do not publish yet.

1. `GET /social-sets`, following `next` until it is null. Pick the set by
   `username`. The OpenRouter account is `OpenRouterAI`.
2. If there is no media, skip to step 5. Otherwise upload it: `POST /social-sets/{id}/media/upload` with `{"file_name":"<slug>.mp4"}` (or `.png` / `.jpg`, the same route handles images). The reply has `media_id` and `upload_url`.
3. `PUT` the file bytes to `upload_url` within one hour. Send no `Content-Type` header. A `Content-Type` header makes S3 return 403, and Python `urllib` adds one implicitly on PUT, so use `curl -X PUT -H "Content-Type:" --data-binary @file "<upload_url>"`.
4. Poll `GET /social-sets/{id}/media/{media_id}` until `status` is `ready`.
   `failed` means start again from step 2.
5. `POST /social-sets/{id}/drafts`. For a draft that publishes to X, set
   `platforms.x.enabled: true` and one entry in `platforms.x.posts` per
   thread post. If there is a `media_id`, add `media_ids: [media_id]` to
   post `1/`. Otherwise send no `media_ids`. For a LinkedIn-only draft,
   leave `platforms.x` out and fill `platforms.linkedin` as described below.
   Do not send `publish_at` or `plan_at`. Without them the draft is inert.
   Leave `share` false. A share link is public.
6. Send the owner the `private_url` from the reply. It needs a Typefully team
   login. Check that the draft text matches the approved copy word for word.

### LinkedIn

The OpenRouterAI social set has LinkedIn connected as the `openrouter` company page. Add it to the same draft as `platforms.linkedin` with `enabled: true` and one entry in `posts`. When the X and LinkedIn publish times differ, make a separate LinkedIn-only draft instead: `platforms.linkedin.enabled: true`, no `platforms.x`. Enabling X on both drafts publishes the thread twice.

- Never copy the X posts into `platforms.linkedin.posts`. The LinkedIn text is the separate post from `social-thread` section 7.
- Tags. `@OpenAI` publishes as plain text on LinkedIn. A real tag is `@[Company Name](urn:li:organization:ID)`. For each company to tag, `GET /social-sets/{id}/linkedin/organizations/resolve?organization_url=<LinkedIn company URL>` and paste the `mention_text` from the reply into the post text in place of the display name. Example: `https://www.linkedin.com/company/openai` resolves to `@[OpenAI](urn:li:organization:11130470)`. The endpoint takes a URL only, it is not a search. The API documents company mentions only. Send the owner the list of people to tag, with display names and profile URLs, to tag by hand in the Typefully editor before approval.
- Media. Use the same `media_id` from step 2 in the LinkedIn post's `media_ids`. LinkedIn accepts up to 20 media items per post.
- Links. The LinkedIn post body has no URL. If the owner insists on one, set `hide_link_preview: true` on the post so the video stays the visual.
- Comment. The API has no first-comment field. The `comment-threads` endpoints are review notes on the draft, not published comments. After the post is live, the owner adds the comment with the links by hand on LinkedIn. Put the comment text in the message that carries the draft link so it is ready to paste.

When you check the draft, open `private_url` and confirm the tags show as chips, not as `@[Name](urn:...)` text and not as plain `@Name`.

## 4. Publish only after explicit human approval

1. Wait for a human to write explicit approval to publish, with the draft
   link. A thumbs-up on the copy alone is not approval. Silence is not
   approval.
2. Only then `PATCH /social-sets/{id}/drafts/{draft_id}` with
   `publish_at` set to `"now"`, `"next-free-slot"`, or an ISO 8601 time with
   a timezone. Use the time the approver named. `"now"` returns 403
   `FORBIDDEN` ("Direct publishing of X drafts containing URLs is blocked")
   when any post has a URL, which every launch thread does. Schedule an ISO
   time one or two minutes out instead; that path publishes fine.
3. Poll `GET /social-sets/{id}/drafts/{draft_id}` until `publish_state` is
   `finished`. Then require `status` to be `published` and the published
   URL of every platform enabled on that draft: `x_published_url` when X
   was enabled, `linkedin_published_url` when LinkedIn was enabled. Send
   those URLs to the owner. Anything else is a failure. Report it as one.
4. For a published LinkedIn post, send the URL with the first-comment text and a reminder to post the comment and check the tags on the live post. Do not say the tag worked until you have seen it on the published post.

If the copy changes after the draft is made, edit the draft with `PATCH` and
go back to step 3.6. Approval does not carry over to new copy.

To discard a draft, `DELETE /social-sets/{id}/drafts/{draft_id}`. A `GET`
afterwards returns 404.
