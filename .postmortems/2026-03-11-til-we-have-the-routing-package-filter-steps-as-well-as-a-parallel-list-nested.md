TIL we have the `routing` package filter steps as well as a parallel list nested in the `routing` module of the `embeddings` package,  so guardrails weren't being applied equally in both paths

Patched [here](https://openrouter.slack.com/archives/C05HMV4J6JE/p1773197465538079) and added a REVIEW.md file to both folders calling this out so that devin will autoflag filter step inconsistencies for review going forward

```# Review Guidelines

## Critical Areas
* The LLM & Embeddings Routers have parallel lists of filter steps. When steps are added/removed/modified in one but not the other, verify that it is expected, and ensure the differences are intuitively documented.```
