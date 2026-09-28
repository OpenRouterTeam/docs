# Publish a Status Page Notice

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
