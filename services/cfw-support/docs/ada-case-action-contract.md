# Ada case action contract (confidence, live policy, auto mode)

For the Ori playbook owner. This describes what Ada must send to cfw-support when she
proposes or executes a ticket action, and how she must react to refusals. The
authoritative server behavior is in the cfw-support README ("Case dispatch and
approval", "Autonomous writes", "Action outcome events").

## Case origins and live modes

The owner controls Ada from Mission Control with the live-config key
`support_ada_policy`. Each case has an arrival origin, signed into the `case_token`:

| Origin | How the case arrived | Policy mode key |
| --- | --- | --- |
| `new_ticket` | Zendesk webhook case start: a new ticket whose priority is in `assign_priorities` that cfw-support assigned to Ada, or a ticket someone else assigned to Ada | `modes.new_tickets` |
| `backlog` | Launcher dispatch | `modes.backlog` |
| `customer_reply` | Zendesk webhook customer-reply continuation | `modes.customer_replies` |

The mode is not signed. The server reads `modes[origin]` from the live policy on every
approve and autonomous call, so a Mission Control change applies to cases already in
flight, within about a minute (a ~10s per-isolate cache plus Cloudflare KV propagation,
which can take 60s or more). This includes `off`. The intake payload still carries `mode`, the effective mode
at dispatch, so Ada knows how to behave, but the server decides again on every write.

| Mode | What Ada may do |
| --- | --- |
| `off` | Nothing. New cases of this origin are not started (for `new_tickets`, new tickets are not assigned to Ada either), and every approve or autonomous call is refused with 403 (`mode_off`); stop working the ticket. |
| `dry_run` | Investigate and propose. Approvals are verified; nothing is written. |
| `assist` | Propose; a Slack-approved action is written. The autonomous tool refuses (`mode_not_auto`). Used for calibration. |
| `auto` | Call `support__autonomous_ticket_action` first; if any gate refuses, fall back to Slack approval for the same action. |

Backlog cases can also be started from Mission Control (Support → Launcher), which calls the console `dispatch` route. Such a case is identical for Ada: the ticket is assigned to Ada first, the intake payload and `case_token` carry origin `backlog`, and `modes.backlog` applies. The console refuses to start any case while `modes.backlog` is `off`. The first approve or autonomous result Ada reports on a console-started case is shown to the operator as its outcome (`auto_sent`, `approved_sent`, `dry_run`, `awaiting_approval`, `escalated`, or `refused` with the reason), so Ada must not retry a refused call with a different action to change what the console shows.

A missing or malformed policy resolves to the defaults: every origin `assist`,
`assign_priorities` and `auto_send_priorities` `low,normal`, `min_confidence` 0.7,
`max_auto_replies_per_ticket_per_day` 3, and no category or tag deny list. It never
resolves to `auto`.

## Confidence (all proposals)

Every proposed action now carries:

- `confidence` (required): Jev's confidence for this ticket, from `0` to `1` with at most
  two decimals (for example `0.7`, `0.85`, `1`). It is the score from Ada's playbook step 6:
  how sure Jev is that the playbook, docs, site pages and this run's tool output are
  enough to answer. It is not Ada's own estimate of her reply. More than two decimals
  is rejected (400).
- `confidence_rationale` (optional): at most 500 characters on why. Only its length is
  logged, so it may reference the case, but keep it short.

## Tags and custom status (both write actions)

Both `support__approve_ticket_action` and `support__autonomous_ticket_action` take two
optional metadata fields, written in the same single conditional Zendesk update as the
comment (`safe_update` against `expected_updated_at`), so a replay or concurrent edit
changes nothing:

- `tags?`: tags to add. Add-only: the server merges them with the ticket's live tags and
  never removes one. At most 20 tags, each 1-80 characters of lowercase letters, digits
  and `_ - : . /` (Zendesk's lowercase tag form; no spaces or commas). Duplicates are
  ignored. When every requested tag is already on the ticket, tags are not sent.
- `custom_status_id?`: a Zendesk custom status id (for example the "Escalated" status),
  a positive integer. The server reads it from Zendesk at request time and refuses with
  400 when it does not exist or is inactive (`custom_status_invalid`), or when `status`
  is also given and differs from the custom status's `status_category`
  (`custom_status_mismatch`). Omit `status`, or send the matching category, when setting a
  custom status. In `dry_run` the same validation runs before nothing is written.

Show the confidence to the human in the Slack approval message next to the proposed
action. The owner compares it with which approvals humans accepted to calibrate the
live `min_confidence` (default 0.7).

## Approval flow (`support__approve_ticket_action`)

Input: `ticketId`, `case_token`, `comment_body`, `public`, `status?`,
`expected_updated_at`, `confidence`, `confidence_rationale?`, `tags?`,
`custom_status_id?`, `approver`.

The Approve button value is still `{"ticket_id":<id>,"action_sha256":"<hex>"}`. The
digest is the lowercase hex SHA-256 of the UTF-8 bytes of a compact JSON object with
keys in this fixed order and non-ASCII characters not escaped: `ticket_id`,
`comment_body`, `public`, `status`, `expected_updated_at`, `confidence_pct`, `tags`,
`custom_status_id`.
Do not sort the keys. In Python (dicts keep insertion order):

```python
d = {
    "ticket_id": ticket_id,
    "comment_body": comment_body,
    "public": public,
    "status": status,                 # None when the status is unchanged
    "expected_updated_at": expected_updated_at,
    "confidence_pct": round(confidence * 100),   # integer percent
    "tags": sorted(set(tags or [])),  # the requested tags, deduplicated and sorted; [] when none
    "custom_status_id": custom_status_id,   # None when not set
}
canonical = json.dumps(d, separators=(",", ":"), ensure_ascii=False)   # no sort_keys
action_sha256 = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
```

Confidence goes into the digest as the integer `confidence_pct`, never as a float, so
Python writing `1.0` and JavaScript writing `1` cannot produce different hashes. Because
`confidence` has at most two decimals, `round(confidence * 100)` is exact. `tags` are the
tags the action adds (not the ticket's final tag set), sorted by code point after removing
duplicates, so their order in the call does not matter; omitted and `[]` hash the same.

Worked example. Input fields:

```
ticket_id=41872
comment_body="Merci — votre clé API est réactivée.\nBonne journée"   (\n is a newline)
public=true
status="pending"
expected_updated_at="2026-09-26T08:00:00Z"
confidence=0.85
```

Canonical string:

```
{"ticket_id":41872,"comment_body":"Merci — votre clé API est réactivée.\nBonne journée","public":true,"status":"pending","expected_updated_at":"2026-09-26T08:00:00Z","confidence_pct":85,"tags":[],"custom_status_id":null}
```

`action_sha256`:

```
4c05f5a4c701121d48e44ec8b4cb30c896dd0ceb38d33b1d840f2e3606a5f9e7
```

With `public=false`, `status` unchanged (`null`) and `confidence=1`, the canonical
string is
`{"ticket_id":41872,"comment_body":"Merci — votre clé API est réactivée.\nBonne journée","public":false,"status":null,"expected_updated_at":"2026-09-26T08:00:00Z","confidence_pct":100,"tags":[],"custom_status_id":null}`
and the digest is `35c1c3634fcac51345969f360acba4840660690011f6e48ad820db52db571d89`.

With `public=false`, `status` unchanged, `confidence=0.8`,
`tags=["vip","escalated_billing","bucket:billing","vip"]` and
`custom_status_id=360001234567`, the canonical string ends
`"confidence_pct":80,"tags":["bucket:billing","escalated_billing","vip"],"custom_status_id":360001234567}`
and the digest is `1ad30cec9c4b0da94089e1d9cc021ddc8f949e8f1048d1d543aab68a68e004fb`.
All three vectors are unit tests in cfw-support.

The `confidence`, `tags` and `custom_status_id` in the approve call must be the same
values used when rendering the button; a different value is rejected as `action_mismatch` (403) and needs a fresh
approval.

## Autonomous flow (`support__autonomous_ticket_action`)

Only in `auto` cases, and there Ada calls it first. Input: `ticketId`, `case_token` (the read token from
intake), `comment_body`, `public`, `status?`, `expected_updated_at`, `confidence`,
`confidence_rationale?`, `category?` (the ticket's `"Category > Subcategory"`), `tags?`,
`custom_status_id?` (see above). No `approver`. `category` is checked against the deny
list only. `never_auto_send_tags` is checked against the final tag set the write would
leave on the ticket (live tags plus requested ones, case-insensitively), so a denied tag
already on the ticket or one Ada wants to add both refuse `tag_not_allowed`.

Only public replies (`public: true`) consume `max_auto_replies_per_ticket_per_day`.
Metadata-only writes (an internal note with or without tags or a custom status) never
consume it; a public reply that also sets tags or a custom status consumes one slot.

Success is `200 {"data":{"executed":true,"mode":"auto","ticket":{…}}}`: the reply
was posted. Post a short note in the case's Slack thread saying Ada answered
autonomously, with the confidence.

Any refusal except `mode_off` is a 403 or 409 whose message names the reason and ends
with the instruction to request Slack approval instead. Ada must not retry autonomously and
must not change the action or confidence to get past a gate. She falls back to the
normal approval flow for the same action:

| Reason | Status | Meaning | Ada's next step |
| --- | --- | --- | --- |
| `not_configured` | 403 | Server config broken | Request approval |
| `mode_off` | 403 | Live mode for the case's origin is `off` | Do not request approval; stop working the ticket |
| `mode_not_auto` | 403 | Live mode for the case's origin is not `auto` | Request approval |
| `confidence_below_threshold` | 403 | Confidence below `min_confidence` | Request approval |
| `category_not_allowed` | 403 | Request or ticket category (or its top-level category) is in `never_auto_send_categories`, matched case-insensitively with spaces/underscores/hyphens equivalent | Request approval |
| `category_unknown` | 403 | A category deny list is set but the ticket's category could not be read | Request approval |
| `tag_not_allowed` | 403 | A tag in the final set (live ticket tags plus requested tags) is in `never_auto_send_tags` | Request approval |
| `priority_not_allowed` | 403 | Live priority is not in `auto_send_priorities` | Request approval |
| `per_ticket_cap_reached` | 403 | `max_auto_replies_per_ticket_per_day` public autonomous replies on this ticket in the last 24h | Request approval (internal notes, tags and custom statuses are not capped) |
| `cap_unavailable` | 403 | Cap could not be checked (fails closed) | Request approval |
| `ticket_stale` | 409 | Ticket changed since `expected_updated_at` | Re-read the ticket, re-plan, then request approval |
| `write_conflict` | 409 | Zendesk `safe_update` collision (replay or concurrent edit) | Re-read the ticket, re-plan, then request approval |
| ticket not active | 403 | No longer assigned to Ada or no longer open (case-not-active message) | Stop working the ticket, as today |

`custom_status_invalid` / `custom_status_mismatch` are 400 and are checked before the
cap. Other statuses (400 validation, 5xx) mean nothing was written; treat them like a
refusal and request approval.

## What the server does and does not check

The server enforces the confidence threshold but cannot verify the score: it is
Jev's confidence as reported by Ada. The real guardrails are server-side and
independent of it: the signed origin and its live mode (only `auto` can write
unattended; `off` stops every write), the live priority against
`auto_send_priorities`, the category and tag deny lists, the live assignee and status,
`expected_updated_at`, the per-ticket daily cap on public replies, and the conditional
write. There is no separate autonomous identity allowlist: Ada's case token plus the
existing `zendesk_write` and `case_approve` capabilities authorize the call, and the
live policy decides whether it may write.

## Satisfaction (`support__get_satisfaction`)

Read tool, input `ticketId`, `case_token` (the case's read token). Same case checks as
`support__get_ticket`: the token must be for this ticket and the ticket must still be
Ada's and active, else 403. It returns only the case's own ticket's CSAT:

```
{"data":{"ticket_id":42,"rating":{"score":"good"|"bad"|"offered"|"unoffered","reason_id":<int>|null,"reason":<string>|null}|null}}
```

`rating` is `null` when the ticket has no rating. `reason` is the reason category the
customer picked for a bad rating. The customer's free-text rating comment is never
returned. There is no tool to list satisfaction ratings across tickets, and ticket-view
and custom-object operations are not exposed to Ada.
