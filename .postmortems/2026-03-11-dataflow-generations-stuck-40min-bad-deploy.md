post-mortem for yesterday's [incident](https://openrouter.slack.com/archives/C05F41UHEE7/p1773078456308169)
• for about ~40 minutes generations were stuck in a bad dataflow job (`usage-record-generations-9` )
• job duration was '2026-03-09T17:01:37Z' to '2026-03-09T17:45:27Z' although the generations that it pulled from pubsub could've been from a bit earlier
• the job was kicked off by me manually from what i thought was a clean main branch locally
    ◦ i ran the deploy script around 9:30am and over the ~30 minutes it took to deploy i managed to forget the docker image was still building/pushing layers so i switched branches to review something else (specifically, https://github.com/OpenRouterTeam/openrouter-web/pull/15078 which has issues and was definitely not ready to be deployed)
• @U08C04FBGHW (John Colanduoni) attempted to create a new job off a clean branch
    ◦ IIUC if we flushed the job it would've acked the messages and we would've just lost them
    ◦ so instead we tried to cancel the job so the new job would pick it up. but there was some sort of serialization issue -- iiuc dataflow pickles the pipeline and the culprit PR has some bad changes that are not backwards compatible
    ◦ at this point the new job resumed our generations inserts but the data in the bad job was still stuck there
• one way to recover the data is from `transactions_2` however it was created without a PK so the dataflow backfill job cannot run without slaughtering postgres (which happened for a brief period yesterday). @U08C04FBGHW (John Colanduoni) has a [PR](https://github.com/OpenRouterTeam/openrouter-web/pull/15492) to make the script use generation id instead
• impact
    ◦ missing usage for that period in spanner
    ◦ budget checks not being respected for that period of time
    ◦ missing logs on the /logs page
• mitigations
    ◦ [github action](https://github.com/OpenRouterTeam/openrouter-web/actions/workflows/deploy-usage-record-generations-dataflow.yaml) to deploy dataflow is now working
