# 2026-09-22 Post-Mortem - NVIDIA SIN Latency Spike (p90 > 1000 ms)

## Timeline (UTC, 2026-09-22)

| Time | Event |
| --- | --- |
| 01:23 | NVIDIA reports significantly higher router overhead latency. Ticket 3917 opened. |
| 01:42 | OpenRouter first response acknowledging the ticket. |
| 01:45 | Support and Eng on-call start triaging and identifying potential solutions. |
| 02:00 | Subject matter experts pulled in for deeper investigation. |
| 02:56 | Declared incident and war room huddle started. |
| 03:18 | Support ticket filed with Cloudflare on the unstable network between the Singapore colo and the US-central Hyperdrive pool. |
| 03:20 | Work started on an alternative read path for private endpoints, to be more resilient to Cloudflare degradation. |
| 04:15 | Cloudflare confirms the issue, identifies the root cause, and starts rerouting our traffic to better colos. |
| 04:30 | Cloudflare reports improvement. OpenRouter observes better results. |
| 04:45 | OpenRouter confirms performance improvement over the last 15 minutes. |
| 04:57 | Incident moved to Stable. |
| 05:41 | NVIDIA confirms latency back to normal for 15 minutes. |

## Root Cause

- A request for a private (BYOK) endpoint hits the SIN colo. To pick the target endpoint, the router must load that entity's private endpoints and model grants.
- That read goes through Hyperdrive. The Hyperdrive origin pool for OpenRouter's Postgres database is not distributed, it lives at the Cloudflare datacenter nearest the origin (ORD, US Central), so every SIN request crosses the SIN→ORD path. Normally this read takes roughly 250–300 ms at p50.
- During the incident the same read took 0.9–1.9 s at p50 and 3–5 s at p90 (measured from SIN, 00:00–04:30 UTC). Other colos stayed at p50 9 ms (DFW), 44 ms (IAD), 79 ms (SJC).
- OpenRouter's Postgres database was healthy throughout: CPU 14–16%, max 461–546 backends of 1,000, no slow queries or connection terminations.
- Cloudflare Hyperdrive metrics were flat: average query latency 4–5 ms, no clients waiting for a connection, negligible disconnects.
- So the origin and the pool were fast and the worker saw a slow round trip. The added ~1 s sat on the network between SIN and ORD.

**Alternatives excluded.**

- Database slowness
- Pool exhaustion
- Recent changes or releases
- General SIN issue (public endpoint traffic unimpacted)

## Impact

1. **Customers affected:** 1. NVIDIA/SIN is confirmed as the only private endpoint group with traffic in SIN during the incident window.
2. **Impacted requests:** 8,784 SIN private endpoint requests, p50 24 ms, p90 2,266 ms, 2,045 (23.3%) over 1 s. Peak 15-min bucket (01:30 UTC): p90 10,149 ms, 59.8% over 1 s.
3. **Controls, same org, same window:** SJC 2,344 requests p90 101 ms (2 over 1 s), PDX 719 p90 68 ms (0), IAD 320 p90 177 ms (0), DFW 319 p90 173 ms (1).
4. **Control, SIN public traffic, all users:** 12,004,597 requests from 18,696 users, p50 2 ms, p90 52 ms, 1.05% over 1 s.

## Mitigation

- Cloudflare rerouted OpenRouter's SIN traffic. Exact change not disclosed.

## What went well

- Fast isolation: database ruled out and the Hyperdrive/network segment identified within the first huddle.
- Cloudflare escalation through the shared channel produced a root cause and a route fix in ~70 minutes.
- Resilience design and implementation were produced in parallel with the vendor escalation rather than waiting.
- Regular customer updates kept NVIDIA informed throughout.

## What could be improved

- **Detection lag.** Latency was elevated from 00:00 UTC, but we learned about it from the customer at 01:23 UTC. No monitor covered private endpoint router latency or per-colo database latency.
- **Triage time.** It took ~90 minutes from the customer report to declaring the incident, and ~2 hours to engage Cloudflare. Recognising the fault signature (one colo slow, database and pool healthy) as a Cloudflare network issue earlier would have shortened both.

## Follow-ups

- **Build the alternative read path for private endpoints** (KV-backed, hedged against Postgres).
- **Build more monitors** on NVIDIA SLOs (p90 and p50 router latency) and per-colo database query latency.

## Participants

- Eng on-call: Qi Shao
- Support: Eric Lee, Kate Herget, Jason Schrader
- SME: John Krauss
