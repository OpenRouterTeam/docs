---

*TLDR Overall Impact:*
• no effect on completions uptime, user requests continued to be fulfilled throughout the incident
• db stayed healthy enough to continue to serve auth requests
• auto topups delayed, but still processed when the queue backlog was burned down
• credit deductions delayed, but ultimately all processed within 30m
• spike in 404s on `/api/v1/generation` endpoint during the duration of the incident
