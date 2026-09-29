*[SEV 1] Queue workers unable to spin up*

*Root Cause*
A GCP IAM service account `batch-transactions-worker` — was removed based on a Oneleet alert indicating 90 days of inactivity. However `batch-transactions-worker` was still in use. This deletion caused the batch transaction workers to stop being able to pull transactions from the pubsub queue.

*Impact*
1. No queue messages were being processed, insert-transactions, insert-generations and instrumentation logs.
2. No credit updates
    a. Also means no auto top ups
3. generations API not working
User facing issues:
1. People's API key limits would not be respected during that time *(really bad)*
2. Anyone that doesnt have auto top up set up can possibly be in a big negative balance situation now
*What Went Well*
• Chat completions was still working, and transactions were being queued up.
• The team was able to detect the issue fairly quickly
*What Went Poorly*
• IAM changes were made during off hours with limited team availability.
• No Slack announcement or paper trail was provided at the time of change.
• The decision relied too heavily on a potentially misleading signal ("unused for 90 days").
• There was no post-change monitoring window or rollback plan.
• The engineer (me) was offline after the change.
• The team was not aware of how to reset GKE secrets
*Resolution*
The deleted service account was restored and IAM bindings were reconfigured. System functionality returned to normal shortly after.

*Action Items (short term)*
• Create guidelines for how to handle production config/infra changes
• Always message in slack if any changes are made
• Remove the hardcoded secret and add it as an env var @U06DJ8YS066 (sam)
• Add documentation on how to handle gke secrets and general practices
*Action Items (long term)*
• See if we can move all of these IAM policies and secrets etc to helm charts so that the config lives in code.
Overall, I want to take full ownership here for making a pretty noob mistake that had real impact on the platform. Thanks to everyone that jumped on and spent their night dealing with this.
