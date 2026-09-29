# Glossary

Human-curated nouns and the context each one makes sense in. This is the vocabulary humans and agents use when talking about, naming, and reviewing code in this repo. Expand it only when a new concept is obvious or necessary. Do not add a term because a model produced it.

## How to use this file

- **Before naming something new**, check whether an existing term already covers the concept. If it does, use that term. If a name made you stop and think for a second, it is not good enough.
- **When reviewing**, treat a variable, schema, or concept name that points at nothing in this glossary or in the surrounding code as a defect to flag.
- **When adding a term**, the entry needs a human owner who agrees the word is established.
- **When two words compete**, pick one and list the losers under Avoid so grep finds the decision.

The `!glossary` Devin playbook reads this file to match team vocabulary in a thread, and appends terms a human supplies to it.

## Entry format

Each entry is one row. Keep definitions to one sentence.

| Column | Meaning |
| --- | --- |
| Term | The noun, in the casing we use in prose |
| Meaning | What it points at, in one sentence |
| Context | Where the term applies, and where a neighbouring term applies instead |
| Avoid | Words that mean the same thing and should not be introduced |

## Terms

| Term | Meaning | Context | Avoid |
| --- | --- | --- | --- |

### Fortuna

| Term | Meaning | Context | Avoid |
| --- | --- | --- | --- |
| Composite score | Weighted average of an endpoint's reliability, latency, throughput, quality and capacity scores. | Fortuna ranking, multiplied by a Thompson-sampled reliability draw under the composite policy. | behavioral bracket, bracket |
| Band | The top-scoring endpoints Fortuna picks one from at random, weighted by score. | Fortuna selection, always at least 2 endpoints unless health cutoffs exclude the rest. | sampling pool |
| Band shrank to a single endpoint | Health cutoffs excluded every endpoint but one, so all Fortuna traffic for the model went to that endpoint. | Unintended Fortuna behavior tracked in [ECO-4130](https://linear.app/openrouter/issue/ECO-4130). | band collapse |
| Health cutoff | Excludes an endpoint from the band when its recent hard-failure rate or 429 rate is above a fixed threshold. | Fortuna selection. The standard router uses endpoint status (degraded, down) instead. | breaker, circuit breaker |
| Max traffic share | Highest share of a model's traffic an endpoint may receive, derived from its sustainable RPM. | Fortuna band weighting. | share cap |
| Sustainable RPM | Estimated requests per minute an endpoint can take before its 429 rate passes the target rate. | Fortuna capacity modeling. | safe load |
| Selection probability | Probability an endpoint is picked as the first choice for a request, 0 outside the band. | Fortuna selection logging and offline replay. | propensity |
| A/B results report | Comparison of Fortuna-routed traffic against control traffic on completion, latency, throughput and cost. | Fortuna evaluation. | readout |
| Per-user rate | A rate where each user counts equally, regardless of request volume. | Fortuna A/B results, reported next to the per-request rate. | user-weighted |
| User concentration | How much of a group's requests come from a few users, reported as the top-1 user share, the top-10 user share and effective users, where effective users is (sum n)^2 / sum n^2. | Fortuna A/B results, used to spot one heavy workload moving a group's rates. | |
| A/B experiment switching arms every 3 hours | Experiment that routes all eligible traffic through Fortuna or the old router in alternating, paired 3-hour blocks. | Fortuna vs old router comparison. Describe it in full rather than naming it. | switchback |
