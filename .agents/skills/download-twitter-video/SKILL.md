---
name: download-twitter-video
description: "Download public X/Twitter post videos at highest quality. Use for x.com or twitter.com status URLs, temporary blob: video URLs, or picking the right video from a multi-video post."
---

# Download Twitter Video

Resolve X's temporary player references to permanent `video.twimg.com` media,
select the intended attachment, download it safely, and verify the result.

## Workflow

1. Obtain the exact `x.com/.../status/...` or `twitter.com/.../status/...` URL.
   A `blob:` URL is only a browser-session handle and cannot be fetched outside
   that page. If the user supplied only a screenshot, recover the post URL from
   the local browser when available or ask for it.
2. List the post's video attachments before downloading:

   ```bash
   python3 .agents/skills/download-twitter-video/scripts/download_twitter_video.py \
     'https://x.com/account/status/123' --list
   ```

3. Select the intended attachment. For a multi-video post, match the screenshot's
   poster URL media ID (`..._video_thumb/<media-id>/...`) and pass
   `--media-id <media-id>`. Otherwise pass the one-based `--index`; it defaults
   to the first attachment.
4. Download to an explicit destination, normally the user's Downloads folder:

   ```bash
   python3 .agents/skills/download-twitter-video/scripts/download_twitter_video.py \
     'https://x.com/account/status/123' \
     --index 1 \
     --output /absolute/path/to/video.mp4
   ```

5. Report the final path, attachment/media ID, duration, dimensions, codecs, and
   file size. The script compares the downloaded duration with X's page metadata;
   treat a mismatch as a failed download, not a success. When the page carries no
   trustworthy duration for the attachment and the file plays correctly, re-run
   with `--skip-duration-check` to keep it.

The script refuses to replace an existing file. Use `--overwrite` only when the
user explicitly authorizes replacing that exact destination.

## How selection works

- Group CDN variants by X media ID instead of choosing the first MP4 in the page.
  A single post can contain multiple independent videos.
- Prefer the MP4 variant with the largest pixel area. Use the HLS playlist with
  `ffmpeg` only when X exposes no MP4 variant.
- Use X's poster order for attachment numbering. Do not infer attachment order
  from bitrate or filename.
- Use `ffprobe` to validate that the result is playable and to measure the actual
  duration and dimensions.

## Fallbacks

If fetching the public post HTML exposes no media URLs:

1. Confirm the post is public and still available. Do not bypass account access,
   private-post controls, paywalls, or DRM.
2. Save the rendered page HTML with an available browser tool and give that local
   HTML file to the same script instead of the URL.
3. In DevTools, inspect Network requests for `video.twimg.com`; ignore the
   `<video src="blob:...">` value. Match the request's media ID to the poster,
   then choose the largest MP4 variant.

## Requirements

- `curl` for fetching the post and MP4.
- `ffprobe` for required verification.
- `ffmpeg` only for HLS-only attachments.
