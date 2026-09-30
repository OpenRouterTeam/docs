# Paging

## Page triggers and routing

| Signal | Route |
| --- | --- |
| Monitor `priority:1` | Engineering — Engineers P1/SEV-1, high urgency, plus a post in `#alerts-p1-critical` |
| Monitor `priority:2` | Engineering — Engineers P2/SEV-2, high urgency, plus a post in `#alerts-p2-high-impact` |
| Monitor `priority:3` to `priority:5` | Post in `#alerts-p3-medium-low` only; no page |
| Monitor with no priority tag | Engineering — Engineers default, low urgency, plus a post in `#alerts-p3-medium-low` |
| Manual page to Engineers (incident **Page** button, `/dd page`) | Engineering — Engineers default; manual pages are always high urgency |
| Monitor `priority:1` or `priority:2` mentioning `@oncall-nvidia-support-team` | Support — NVIDIA Support P0, high urgency |
| Manual page to NVIDIA Support (incident **Page** button, `/dd page`) | Support — NVIDIA Support P1; manual pages are always high urgency |
| Monitor mentioning `@oncall-nvidia-support-team` with no priority or `priority:3` to `priority:5` | Support — NVIDIA Support P1, low urgency |
| Live call to +1 315-889-4536, press 1 | Support — NVIDIA Support P0, high urgency |
| Live call to +1 315-889-4536, press 2 | Engineering — Engineers P1/SEV-1, high urgency |
| Pylon ticket alone, any priority | No page; normal ticket handling |

## Escalation policy

If nobody acknowledges, the page moves to the next step.

| Route | Escalation |
| --- | --- |
| Engineering P1 or live call | Primary → Secondary → EM round robin; 5 minutes per step |
| Engineering P2 | Primary (15 minutes) → Secondary (15 minutes) → EM round robin (5 minutes) |
| Engineering default (manual page, monitor with no priority) | Primary → Secondary → EM round robin; 5 minutes per step |
| Support P0 (live call, P1/P2 monitor) | Primary (1 minute) → Secondary (1 minute) → Manager schedule (5 minutes) → one named fallback person (5 minutes) |
| Support P1 (manual page, other monitors) | Primary → Secondary → Manager schedule; 15 minutes per step, then the same fallback person for 5 minutes |

Engineering policies repeat once if the whole chain goes unacknowledged; Support policies do not repeat. The EM round robin is three named Datadog users and the Support fallback is one; their IDs live in `TARGETS` in the drift script, so changing who is in either step is a paging change and shows up as drift until the script is updated.

Routing and escalation policies are configured in [Datadog On-Call](https://us5.datadoghq.com/on-call/teams); this page is a snapshot taken on 2026-09-30. `.agents/skills/oncall-prep/scripts/routing_drift.py` re-reads the rules and policies every Monday and the readiness post flags any line that no longer matches these tables; when you change paging, update this page and the script's expected tables in the same PR.
