# On-Call Playbook

For the Engineering and Support on-call rotations.

## Start here


| When                       | Guide                                                      |
| -------------------------- | ---------------------------------------------------------- |
| Before your shift          | [Readiness checklist](./readiness-checklist.md)            |
| Understand severity        | [Priority and Severity](./severity.md)                     |
| How Paging works           | [Paging](./paging.md)                          |
| You have been paged        | [First 15 minutes](./first-15-minutes.md)                  |
| The incident is ongoing    | [During an incident](./during-incident.md)                 |
| The incident is resolved   | [After an incident](./after-incident.md)                   |
| Writing to the customer    | [Customer update templates](./template-customer-update.md) |
| Posting a public notice    | [Publish a status page notice](./publish-status-page.md)   |
| Wording a public notice    | [Public status page templates](./template-status-page.md)  |

## Flow overview

Engage the Support on-caller for every SEV-1/2 incident. Until Support acknowledges, the incident commander owns communication.

```mermaid
---
config:
  htmlLabels: false
---
flowchart TD
    signal["P1/P2 monitor alert or live call"] --> ack["Acknowledge the page or call"]
    ack --> triage["Confirm what is failing and who is affected"]
    triage --> decide{"SEV-1 or SEV-2?"}
    decide -->|"No"| ticket["Close the page; ticket follows normal handling"]
    decide -->|"Yes or unclear"| declare["Join or declare a Datadog incident"]
    declare --> mitigate["Engineering: triage and mitigate"]
    declare --> engage["Page the other rotation if not already engaged"]
    engage --> updates["Support: customer updates on schedule"]
    mitigate -.->|"2+ customers affected"| notice["Publish and update a public notice"]
    mitigate -.->|"Optional"| freeze["Freeze releases"]
    mitigate --> recovered["Verify recovery; declare mitigated"]
    recovered --> resolved["Resolve the incident"]
    updates --> final["Support: final update and ticket close-out"]
    resolved --> final
    resolved --> cleanup["Resolve any notice; lift any freeze when safe"]
    notice -.-> cleanup
    freeze -.-> cleanup
    cleanup --> followups["Follow-ups in Linear; postmortem if required"]
```
