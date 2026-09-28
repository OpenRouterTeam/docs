# Paging

## Page triggers and routing

| Signal | Route |
| --- | --- |
| Monitor `priority:1` | Engineering — Engineers P1/SEV-1, high urgency |
| Monitor `priority:2` | Engineering — Engineers P2/SEV-2, high urgency |
| Monitor `priority:3` to `priority:5` | Slack only; no page |
| Monitor with no priority tag | Engineering — Engineers default, low urgency |
| Live call to +1 315-889-4536, press 1 | Support |
| Live call to +1 315-889-4536, press 2 | Engineering |
| Pylon ticket alone, any priority | No page; normal ticket handling |

## Escalation policy

If nobody acknowledges, the page moves to the next step.

| Route | Escalation |
| --- | --- |
| Engineering P1 or live call | Primary → Secondary → EM round robin; 5 minutes per step |
| Engineering P2 | Primary → Secondary → EM round robin; 15 minutes per step |
| Support live call | Primary → Secondary → Manager; 5 minutes per step |

Routing and escalation policies are configured in [Datadog On-Call](https://us5.datadoghq.com/on-call/teams).
