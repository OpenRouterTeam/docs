# Server tool agent demos

## Approved behavior

Demo Hub's server tools page gains two editable presets. Subagent uses `~openai/gpt-sol-latest` as lead and `z-ai/glm-5.3` as the research worker for a detailed cross-country passenger journey. Advisor uses `z-ai/glm-5.3` as lead and `~anthropic/claude-opus-latest` as advisor for a webhook delivery architecture. The lead researches official sources, calculates capacity and drafts an initial architecture before asking for advice, then explains its revisions.

## Execution and presentation

The new demos use the Responses API and render ordered output items. Every visible contribution identifies its role and actual returned model; absent model identity is unknown. Tool inputs, research calls, tool results, and final lead messages remain distinct. The subagent receives web search with bounded tool calls. The advisor receives a self-contained consultation prompt and review instructions; the lead receives web search and web fetch. Subagent tool use is required, while advisor tool selection is automatic with explicit sequencing instructions.

The tool-enabled transcript is the main result. An optional baseline runs the same prompt without tools. Raw request/response payloads and session links remain available. A successful HTTP response does not imply successful demonstration: missing, failed, or out-of-order consultations and absent final synthesis are reported explicitly. Web search performed inside the subagent is not fabricated as a visible nested transcript because only its final outcome is returned.

## Validation

Unit tests cover request defaults, overrides, output validation, attribution, ordering, incomplete/error results, and the success criteria. DOM tests cover controls, submissions, errors, tab state, model labels, and telemetry privacy. Live runs must demonstrate the configured second model and the expected sequence for each preset. Credentials never enter captured payloads. Preserve internal-admin authorization and Mission Control's existing egress and HIPAA controls.

Live validation: full-transcript forwarding intermittently returned empty Opus advice. Explicit prompt mode completed the required research, visible draft, consultation, and revision sequence in two consecutive live runs.
