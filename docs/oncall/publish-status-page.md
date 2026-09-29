# Publish a Status Page Notice

## Who can publish

Publishing needs the Datadog permission `status_pages_incident_write`, granted by the **Engineers** and **Datadog Admin** roles (not the Standard role). Everyone on the Engineering and NVIDIA Support rotations should have it; the weekly readiness reminder flags anyone who does not as `cannot publish status page notices`. Missing it? Ask a Datadog admin to add you to the Engineers role before your shift, not during an incident.

## In-channel draft

For SEV-1 and SEV-2 incidents, Datadog posts a ready-to-paste notice draft in the incident channel when the incident is declared (notification rule: status Active, severity SEV-1 or SEV-2). The message is:

```text
:loudspeaker: *Status page* (SEV-1 = Major outage, SEV-2 = Degraded performance). If 2+ customers are affected and no notice is open, publish within 10 minutes: https://us5.datadoghq.com/status-pages/3bdfe680-d6e4-4a0b-9c04-c25058c342e0/notices
Paste, then replace the bracket with what customers see (API requests, sign-in, credit purchases, or a public model name; never internal service names):
> We are investigating [customer-visible issue].
Post the public link from https://status.openrouter.ai/ back here when done. Templates for later updates: docs/oncall/template-status-page.md
```

The draft is a reminder, not a decision: the "2+ customers" call and the wording stay with the Engineering on-caller (see [During an incident](./during-incident.md)).

## Publishing checklist

- [ ] Open [Datadog notices](https://us5.datadoghq.com/status-pages/3bdfe680-d6e4-4a0b-9c04-c25058c342e0/notices). Update the existing notice for this incident, or create a **degradation**.
- [ ] Set a **title** describing customer impact, such as `Increased request errors` or `Delayed responses`.
- [ ] Select the **current status**: Investigating, Identified (problem known), Monitoring, or Resolved.
- [ ] Select **affected components** and set their **impact**: Major Outage for SEV-1, Degraded Performance for SEV-2. Update impact as it changes.
- [ ] Set recovered components to **Operational** in this notice. Datadog shows the highest impact across open notices.
- [ ] Add a **message** from [Public Status Page Templates](./template-status-page.md). Replace placeholders with confirmed facts and UTC times. Follow the [wording guidance](./template-status-page.md#template-guidance) for affected functions and public models.
- [ ] Remove internal service names, implementation details, customer names, request IDs, internal links, and unconfirmed causes or recovery estimates.
- [ ] Turn on **Notify subscribers**, then publish.
- [ ] Post the notice’s public link from [status.openrouter.ai](https://status.openrouter.ai/) in the incident channel so Support can reuse it.
