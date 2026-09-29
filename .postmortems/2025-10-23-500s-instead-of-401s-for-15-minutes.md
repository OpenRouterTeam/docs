the time we had an outage that only affected requests that were gonna fail anyway:  [thread](https://openrouter.slack.com/archives/C05F41UHEE7/p1761192709764859) & [tldr](https://openrouter.slack.com/archives/C05F41UHEE7/p1761193803077009?thread_ts=1761192709.764859&cid=C05F41UHEE7) & dashboard

for about 15 minutes we served 500s instead of 401s, and only for the subset of users that fell back from hyperdrive to postgREST
