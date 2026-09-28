# Customer Update Templates

## Sending checklist

- [ ] Fill a template with confirmed facts and UTC times. **Use Engineering’s updates for incidents.**
- [ ] Reuse and link the public notice, if relevant—not the Datadog management page.
- [ ] Remove internal details, internal links, and other customers’ information.
- [ ] Promise a next-update time only if Support commits to it.
- [ ] Send as a customer-facing reply in the Pylon ticket thread.

> ⚠️ Support updates **SEV-1 every 30 minutes** and **SEV-2 every 60 minutes**, even with no change. Other tickets follow their support SLA.
>
> ⚠️ Ticket progress does not automatically change the public incident status.

## Initial acknowledgement

Took the call? Reply immediately, within the response SLA. Do not wait for diagnosis or a public notice. See [First 15 minutes](./first-15-minutes.md).

```text
Thank you for calling. We’ve received your report of [issue] and are looking into it. We’ll keep you updated in this ticket.
```

## Progress update

Send when there is confirmed progress. Add a next step or workaround only if confirmed and useful.

Public status: [Investigating](./template-status-page.md#investigating) or [Identified](./template-status-page.md#identified--mitigation-underway).

```text
Update [HH:MM UTC]: [Confirmed progress]. You may still experience [current impact].
```

## No change

Send when an update is due but nothing new is confirmed. No public status change is needed.

```text
Update [HH:MM UTC]: We are still working on this issue. You may continue to experience [current impact].
```

## Recovery check

Send when recovery starts. Keep scheduled updates going without waiting for a reply. Ask for request IDs only for ongoing API failures.

Public status: [Monitoring](./template-status-page.md#monitoring--verifying-recovery).

```text
We are seeing recovery and monitoring for stability. Are you still experiencing [symptom]?
```

## Final update

Send after verified recovery. For incidents, Engineering confirms recovery—not customer silence.

Public status: [Resolved](./template-status-page.md#resolved--recovery-verified) only when Engineering declares the wider incident resolved.

Add an impact window or postmortem commitment only if confirmed and relevant. Close the ticket separately; see [After an incident](./after-incident.md).

```text
We have verified that [affected function] is working normally again. Please let us know if you still see problems.
```
