# Grafana Cloud Broadcast Destination

Stream OpenRouter traces to Grafana Cloud for distributed tracing visualization, performance monitoring, and debugging. OpenRouter sends traces via the standard OTLP HTTP/JSON endpoint.

## Prerequisites

- A [Grafana Cloud](https://grafana.com/products/cloud/) account (free tier available)

## Configuration

To set up the Grafana Cloud integration, you'll need the following values from your Grafana Cloud portal:

| Field | Description | Example |
|-------|-------------|---------|
| **Base URL** | Your Grafana Cloud [OTLP endpoint](https://grafana.com/docs/grafana-cloud/send-data/otlp/send-data-otlp/) | `https://otlp-gateway-prod-us-west-0.grafana.net` |
| **Instance ID** | Your numeric Grafana Cloud instance ID | `123456` |
| **API Key** | A Grafana Cloud [API token with write permissions](https://grafana.com/docs/grafana-cloud/security-and-account-management/authentication-and-permissions/access-policies/create-access-policies/) | `glc_...` |

### Finding Your OTLP Endpoint

1. Log in to your Grafana Cloud portal
2. Navigate to **Connections** → **Add new connection**
3. Search for **OpenTelemetry (OTLP)** and select it
4. On the configuration page, you'll find your **OTLP endpoint URL** (e.g., `https://otlp-gateway-prod-us-west-0.grafana.net`)

### Finding Your Instance ID

1. Go to your Grafana Cloud account at `https://grafana.com/orgs/{your-org}/stacks`
2. Select your stack
3. Your **Instance ID** is the numeric value shown in the URL or on the stack details page

> **Important**: The base URL should be the OTLP gateway endpoint, not your main Grafana dashboard URL. The format is `https://otlp-gateway-prod-{region}.grafana.net`.

### Creating [an API Token](https://grafana.com/docs/grafana-cloud/security-and-account-management/authentication-and-permissions/access-policies/create-access-policies/)

1. In Grafana Cloud, go to **My Account** → **Access Policies**
2. Create a new access policy with `traces:write` scope
3. Generate a token from this policy
4. Copy the token (starts with `glc_...`)

## Viewing Your Traces

Once configured, OpenRouter will send traces to Grafana Cloud. You can view them in two ways:

### Option 1: Explore with TraceQL

![Grafana Explore with TraceQL query](./traceql-example.png)

1. Go to your Grafana Cloud instance (e.g., `https://your-stack.grafana.net`)
2. Click **Explore** in the left sidebar
3. Select your Tempo data source (e.g., `grafanacloud-*-traces`)
4. Switch to the **TraceQL** tab
5. Run this query to see all OpenRouter traces:

```traceql
{ resource.service.name = "openrouter" }
```

You can also filter by specific attributes:

```traceql
{ resource.service.name = "openrouter" && span.gen_ai.request.model = "openai/gpt-4-turbo" }
```

### Option 2: Drilldown → Traces

![Grafana Drilldown Traces view](./drilldown-traces-example.png)

1. Go to your Grafana Cloud instance
2. Navigate to **Drilldown** → **Traces** in the left sidebar
3. Use the filters to find traces by service name, duration, or other attributes
4. Click on any trace to see the full span breakdown

## Trace Attributes

OpenRouter traces include the following key attributes:

### Resource Attributes
- `service.name`: Always `openrouter`
- `service.version`: `1.0.0`
- `openrouter.trace.id`: The OpenRouter trace ID

### Span Attributes
- `gen_ai.operation.name`: The operation type (e.g., `chat`)
- `gen_ai.system`: The AI provider (e.g., `openai`)
- `gen_ai.request.model`: The requested model
- `gen_ai.response.model`: The actual model used
- `gen_ai.usage.input_tokens`: Number of input tokens
- `gen_ai.usage.output_tokens`: Number of output tokens
- `gen_ai.usage.total_tokens`: Total tokens used
- `gen_ai.response.finish_reason`: Why the generation ended (e.g., `stop`)

### Custom Metadata
Any metadata you attach to your OpenRouter requests will appear under the `trace.metadata.*` namespace.

## Example TraceQL Queries

### Find slow requests (> 5 seconds)

```traceql
{ resource.service.name = "openrouter" && duration > 5s }
```

### Find requests by user

```traceql
{ resource.service.name = "openrouter" && span.user.id = "user_abc123" }
```

### Find errors

```traceql
{ resource.service.name = "openrouter" && status = error }
```

### Find requests by model

```traceql
{ resource.service.name = "openrouter" && span.gen_ai.request.model =~ ".*gpt-4.*" }
```

## Troubleshooting

### Traces not appearing

1. **Check the time range**: Grafana's time picker might not include your trace timestamp. Try expanding to "Last 1 hour" or "Last 24 hours".

2. **Verify the endpoint**: Make sure you're using the OTLP gateway URL (`https://otlp-gateway-prod-{region}.grafana.net`), not your main Grafana URL.

3. **Check authentication**: Ensure your Instance ID is numeric and your API key has write permissions.

4. **Wait a moment**: There can be a 1-2 minute delay before traces appear in Grafana.

### Wrong data source

If you don't see any traces, make sure you've selected the correct Tempo data source in the Explore view. It's typically named `grafanacloud-{stack}-traces`.

## Additional Resources

- [Grafana Cloud OTLP Documentation](https://grafana.com/docs/grafana-cloud/send-data/otlp/)
- [TraceQL Query Language](https://grafana.com/docs/tempo/latest/traceql/)
- [Grafana Tempo Documentation](https://grafana.com/docs/tempo/latest/)
