# Paging

## Page triggers and routing

| Signal | Route |
| --- | --- |
| Monitor `priority:1` | Engineering — Engineers P1/SEV-1, high urgency, plus a Slack post |
| Monitor `priority:2` | Engineering — Engineers P2/SEV-2, high urgency, plus a Slack post |
| Monitor `priority:3` to `priority:5` | Slack only; no page |
| Monitor with no priority tag | Engineering — Engineers default, low urgency |
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
| Support P0 (live call, P1/P2 monitor) | Primary (1 minute) → Secondary (1 minute) → Manager (5 minutes) → round robin (5 minutes) |
| Support P1 (manual page, other monitors) | Primary → Secondary → Manager; 15 minutes per step, then a final 5-minute step |

Engineering policies repeat once if the whole chain goes unacknowledged; Support policies do not repeat.

Routing and escalation policies are configured in [Datadog On-Call](https://us5.datadoghq.com/on-call/teams); this page is a snapshot taken on 2026-09-29.
