# OpenTelemetry Semantic Conventions Version Tracking

This document tracks the OpenTelemetry semantic conventions version we're implementing and any deviations or notes.

## Current Version

**v1.36.0** - Tracked as of December 2024

## Spec Links

- [GenAI Overview](https://github.com/open-telemetry/semantic-conventions/blob/v1.36.0/docs/gen-ai/README.md)
- [GenAI Spans](https://github.com/open-telemetry/semantic-conventions/blob/v1.36.0/docs/gen-ai/gen-ai-spans.md)
- [GenAI Events](https://github.com/open-telemetry/semantic-conventions/blob/v1.36.0/docs/gen-ai/gen-ai-events.md)
- [GenAI Metrics](https://github.com/open-telemetry/semantic-conventions/blob/v1.36.0/docs/gen-ai/gen-ai-metrics.md)
- [GenAI Agent Spans](https://github.com/open-telemetry/semantic-conventions/blob/v1.36.0/docs/gen-ai/gen-ai-agent-spans.md)
- [OpenAI Conventions](https://github.com/open-telemetry/semantic-conventions/blob/v1.36.0/docs/gen-ai/openai.md)
- [Azure AI Inference Conventions](https://github.com/open-telemetry/semantic-conventions/blob/v1.36.0/docs/gen-ai/azure-ai-inference.md)
- [AWS Bedrock Conventions](https://github.com/open-telemetry/semantic-conventions/blob/v1.36.0/docs/gen-ai/aws-bedrock.md)

## Implementation Status

### ✅ Fully Implemented

- **GenAI Attributes**: All standard attributes per v1.36.0
- **GenAI Events**: All 5 event types (system.message, user.message, assistant.message, tool.message, choice)
- **GenAI Metrics**: All client and server metrics with correct bucket boundaries
- **GenAI Spans**: Inference, embeddings, and execute_tool spans
- **GenAI Agent Spans**: Create agent and invoke agent spans
- **System Overrides**: OpenAI, Azure AI Inference, AWS Bedrock

### 📝 Implementation Notes

1. **gen_ai.system vs gen_ai.provider.name**: We include both for compatibility. `gen_ai.provider.name` is the v1.36+ standard, while `gen_ai.system` is maintained for older consumers.

2. **finish_reason vs finish_reasons**: We emit both `gen_ai.response.finish_reason` (legacy single value) and `gen_ai.response.finish_reasons` (v1.36 array format) for backward compatibility.

3. **Token Usage Extensions**: We include OpenRouter-specific extensions like `gen_ai.usage.input_tokens.cached`, `gen_ai.usage.input_tokens.audio`, etc., which are not in the base spec but follow the naming pattern.

4. **Cost Attributes**: We include `gen_ai.usage.input_cost`, `gen_ai.usage.output_cost`, and `gen_ai.usage.total_cost` as OpenRouter extensions.

5. **Legacy Attributes**: We maintain `gen_ai.prompt` and `gen_ai.completion` for backward compatibility, though the spec recommends indexed message attributes or events.

## Changelog

### v1.36.0 (December 2024)
- Initial implementation tracking v1.36.0
- Comprehensive test coverage for all spec components
- Automated version checking via GitHub Actions

## Updating to a New Version

When updating to a new spec version:

1. **Review Changes**: Check the [semantic-conventions releases](https://github.com/open-telemetry/semantic-conventions/releases) for GenAI-related changes
2. **Update Spec Reference**: Update `otel-spec-compliance.test.ts` with new expected values
3. **Update Implementation**: Modify implementation files as needed
4. **Run Tests**: Execute `bun run test` to verify compliance
5. **Update This Document**: Add a new changelog entry with version and changes
6. **Test Integration**: Verify that destinations still work correctly with updated attributes

## Known Deviations

None at this time. All implementations follow the v1.36.0 spec exactly, with extensions clearly marked.

## Testing

Compliance tests run automatically on every commit via CI. See `otel-spec-compliance.test.ts` for the test suite.

To run tests locally:
```bash
cd packages/broadcast
bun run test
```
