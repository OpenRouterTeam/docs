# Inference CPU and Memory Profiling

Prompt an AI agent with:

> Profile the cfw-api inference path for CPU and memory hotspots. Follow
> `scripts/profile-inference/AGENTS.md`, operate the harness end to end without
> human setup, collect comparable evidence, and document potential fixes in
> `CPU_MEMORY_FIXES.md`. Keep iterating until the findings are actionable.

The agent instructions in [AGENTS.md](./AGENTS.md) are the source of truth.
Read its
[workload identity and response validation](./AGENTS.md#workload-identity-and-response-validation)
section before interpreting any number: a run counts only when every response
parsed as a complete, error-free document, and `--action compare` refuses pairs
whose workload identity, sampling arm, or model output differ.
