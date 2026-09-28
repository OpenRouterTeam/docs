# First 15 Minutes of Getting Paged

> [!IMPORTANT]
> Use this timeline for:
>
> - P1/P2 Alerts (when triggered, that means SEV-1/SEV-2 Incidents)
> - Customer calling our Datadog Live Call number
> - Another responder paging you for a SEV-1/SEV-2 incident
>
> Tickets alone do not page, regardless of priority. Lower-priority alerts follow normal handling. Time runs from T0. [Join an existing incident](#join-or-declare-an-incident) immediately.


| Time          | Engineering                                                                                                                                                                                                                                                                                                                                                          | Support                                                                                                                                                       |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **T0**        | - Page from Datadog P1/P2 Monitors<br>- Call from Customer (**SLA clock starts!**)                                                                                                                                                                                                                                                                 | - Page from Engineering<br>- Call from Customer (**SLA clock starts!**)                                                                                                                  |
| **0–2 min**   | - **Ack** Datadog Page, otherwise it'll escalate.<br>- Call from Customer? [Find or create their ticket](#acknowledge-a-customer-call).<br>- If there is a ticket, reply in it **to STOP the SLA clock!** Use the [acknowledgement](./template-customer-update.md#initial-acknowledgement); it needs no Engineering findings.                                                                                                                                                                                                            | - **Ack** Datadog Pages, otherwise it'll escalate.<br>- Call from Customer? [Find or create their ticket](#acknowledge-a-customer-call).<br>- If there is a ticket, reply in it to **STOP the SLA clock!** Use the [acknowledgement](./template-customer-update.md#initial-acknowledgement); it needs no Engineering findings.     |
| **2–5 min**   | - Confirm what is failing and who is affected.<br>- **Unclear and no incident yet? [Declare SEV-1](#join-or-declare-an-incident).**<br>- Clearly not SEV-1/SEV-2? [Close the false alarm](./during-incident.md) and return the ticket to normal handling. Stop this timeline.                                                                                                                                                                                                                                                                              | - Join the existing incident, if any.<br>- Find the Pylon ticket, if any.<br>- Confirm the customer's symptoms and impact.<br>- **Unclear and no incident yet? [Declare SEV-1](#join-or-declare-an-incident).**<br>- Clearly not SEV-1/SEV-2? [Close the false alarm](./during-incident.md) and return the ticket to normal handling. Stop this timeline.                                             |
| **5–10 min**  | - SEV-1/SEV-2 or still unclear, and no incident yet? [Declare an incident](#join-or-declare-an-incident).<br>- For every SEV-1/SEV-2 incident, [page Support](#page-the-other-rotation) if not already engaged.<br>- 2+ customers affected? [Publish Notice](https://us5.datadoghq.com/status-pages/3bdfe680-d6e4-4a0b-9c04-c25058c342e0/notices) to Public Status Page. Post its public link from [status.openrouter.ai](https://status.openrouter.ai/) in the incident channel.<br>- (Optional) [Freeze releases](https://github.com/OpenRouterTeam/openrouter-web/actions/workflows/release-freeze.yaml) and say so in the incident channel. | SEV-1/SEV-2 or unclear, and Engineering not already engaged? [Page Engineering](#page-the-other-rotation).                                                                                                                                        |
| **10–15 min** | - Triage in the incident channel.<br>- Follow the monitor's runbook. None? Use the Triage stage in [During an incident](./during-incident.md).<br>- Share triage progress and findings.                                                                                                                                                                                                                                                        | - Triage in the incident channel.<br>- Keep customer updates on schedule.<br>- Update incident impact and timeline with customer reports and triage findings. |
| **15 min+**   | - Continue triage and mitigation.<br>- Obvious expert needed? Pull them in now.<br>- **No traction by T30?** Pull in an expert or [page Secondary](https://us5.datadoghq.com/on-call/schedules).                                                                                                                                                                                                                    | - Update the customer every **30 min for SEV-1** or **60 min for SEV-2**.<br>- The team decides when to bring in an expert.                                   |


## Acknowledge a customer call

Whoever takes the call owns finding the customer's ticket or creating one for the caller in [Pylon](https://app.usepylon.com/support/issues/views/inbox), then sending the [acknowledgement](./template-customer-update.md#initial-acknowledgement) immediately. Do not wait for diagnosis or a Support handoff.

## Join or declare an incident

1. Open [Datadog Incidents](https://us5.datadoghq.com/incidents). Join an existing incident for the same issue.
1. If none exists, click **Declare Incident**, enter the customer impact as the title, select SEV-1 or SEV-2 (SEV-1 if unclear), and confirm **Declare Incident**.
1. Click **Slack Channel** on the incident page to join its dedicated Slack channel. This is "the incident channel" throughout the playbook; follow the link rather than guessing its configured name.
1. Link the alert thread and any Pylon ticket in the incident.

## Page the other rotation

1. Open [Datadog On-Call Teams](https://us5.datadoghq.com/on-call/teams), select the team for the requested **Support** or **Engineering** rotation, and click **Page**.
1. Enter a title and add impact plus the incident link in **Description**. If no incident exists yet, use call details and the ticket link; Engineering declares it when engaged, following the timeline above. Click **Page** to send it.

## DO NOT

- Do not diagnose before acknowledging.
- Do not downgrade severity before triage.
- Do not make technical claims to the customer, such as cause, scope, fix, or recovery estimate, until Engineering confirms them in the incident channel. The acknowledgement needs no confirmation.
- Do not fix quietly. Every change goes in the incident channel before or as it happens.
- Do not swap the page to someone else in Slack. Reassign in Datadog so the record is right.

