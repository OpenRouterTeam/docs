# Snowflake Broadcast Destination

Stream OpenRouter traces to your Snowflake data warehouse for custom analytics, long-term storage, and business intelligence.

## Table Setup

Create the `OPENROUTER_TRACES` table in your Snowflake database:

```sql
CREATE TABLE OPENROUTER_TRACES (
  -- Primary identifiers (indexed for fast filtering)
  TRACE_ID VARCHAR(64) NOT NULL,
  SPAN_ID VARCHAR(32) NOT NULL,
  PARENT_SPAN_ID VARCHAR(32),

  -- Timestamps (indexed for time-range queries)
  TIMESTAMP TIMESTAMP_NTZ NOT NULL,
  START_TIME TIMESTAMP_NTZ NOT NULL,
  END_TIME TIMESTAMP_NTZ,
  DURATION_MS NUMBER(18,3),

  -- High-cardinality identifiers (indexed for user/session filtering)
  USER_ID VARCHAR(256),
  SESSION_ID VARCHAR(256),
  ORGANIZATION_ID VARCHAR(256),
  ENTITY_ID VARCHAR(256),
  API_KEY_NAME VARCHAR(256),

  -- Model information (critical for cost analysis and filtering)
  MODEL VARCHAR(256),
  PROVIDER_NAME VARCHAR(128),
  PROVIDER_SLUG VARCHAR(128),

  -- Status fields (for filtering successes/errors)
  STATUS VARCHAR(32),  -- 'ok' or 'error'
  LEVEL VARCHAR(32),   -- 'DEBUG', 'INFO', 'WARNING', 'ERROR'
  FINISH_REASON VARCHAR(64),

  -- Token metrics (for usage analysis and billing)
  PROMPT_TOKENS NUMBER(18,0),
  COMPLETION_TOKENS NUMBER(18,0),
  TOTAL_TOKENS NUMBER(18,0),
  CACHED_TOKENS NUMBER(18,0),
  REASONING_TOKENS NUMBER(18,0),

  -- Cost metrics (for financial analysis)
  INPUT_COST NUMBER(18,8),
  OUTPUT_COST NUMBER(18,8),
  TOTAL_COST NUMBER(18,8),
  INPUT_UNIT_PRICE NUMBER(18,10),
  OUTPUT_UNIT_PRICE NUMBER(18,10),

  -- Type classification
  SPAN_TYPE VARCHAR(32),  -- 'SPAN', 'GENERATION', 'EVENT'
  SPAN_KIND VARCHAR(32),  -- 'CLIENT', 'SERVER', 'INTERNAL', etc.
  OPERATION_NAME VARCHAR(64),  -- 'chat', 'embeddings', etc.

  -- Arbitrary JSON data (use VARIANT for flexibility)
  ATTRIBUTES VARIANT,  -- All OTEL attributes as JSON
  INPUT VARIANT,       -- Input messages/prompts
  OUTPUT VARIANT,      -- Output messages/completions
  METADATA VARIANT,    -- User-defined metadata
  TAGS ARRAY,          -- User-defined tags
  MODEL_PARAMETERS VARIANT,  -- Model configuration
  RESOURCE_ATTRIBUTES VARIANT,  -- OTEL resource attributes

  -- Constraints
  PRIMARY KEY (TRACE_ID, SPAN_ID)
);

-- Recommended indexes for common query patterns
CREATE INDEX idx_timestamp ON OPENROUTER_TRACES(TIMESTAMP);
CREATE INDEX idx_user_id ON OPENROUTER_TRACES(USER_ID);
CREATE INDEX idx_model ON OPENROUTER_TRACES(MODEL);
CREATE INDEX idx_status ON OPENROUTER_TRACES(STATUS);
CREATE INDEX idx_organization_id ON OPENROUTER_TRACES(ORGANIZATION_ID);
CREATE INDEX idx_session_id ON OPENROUTER_TRACES(SESSION_ID);
```

## Configuration

1. **Account**: Your Snowflake account identifier (e.g., `abc12345.us-east-1`)
2. **Token**: Personal Access Token with INSERT permissions
3. **Database**: Target database name (default: `SNOWFLAKE`)
4. **Schema**: Target schema name (default: `PUBLIC`)
5. **Table**: Table name (default: `OPENROUTER_TRACES`)
6. **Warehouse**: Compute warehouse name (default: `COMPUTE_WH`)

### Creating a Personal Access Token

```sql
-- Create a role for OpenRouter
CREATE ROLE openrouter_writer;

-- Grant permissions
GRANT USAGE ON DATABASE your_database TO ROLE openrouter_writer;
GRANT USAGE ON SCHEMA your_database.public TO ROLE openrouter_writer;
GRANT INSERT ON TABLE your_database.public.OPENROUTER_TRACES TO ROLE openrouter_writer;
GRANT USAGE ON WAREHOUSE your_warehouse TO ROLE openrouter_writer;

-- Create user and assign role
CREATE USER openrouter_service;
GRANT ROLE openrouter_writer TO USER openrouter_service;

-- Generate PAT (run as openrouter_service user)
-- Then in Snowflake UI: User → My Profile → Personal Access Tokens
```

## Example Queries

### Cost Analysis by Model

```sql
SELECT
  DATE_TRUNC('day', TIMESTAMP) as day,
  MODEL,
  SUM(TOTAL_COST) as total_cost,
  SUM(TOTAL_TOKENS) as total_tokens,
  COUNT(*) as request_count
FROM OPENROUTER_TRACES
WHERE TIMESTAMP >= DATEADD(day, -30, CURRENT_TIMESTAMP())
  AND STATUS = 'ok'
  AND SPAN_TYPE = 'GENERATION'
GROUP BY day, MODEL
ORDER BY day DESC, total_cost DESC;
```

### User Activity Analysis

```sql
SELECT
  USER_ID,
  COUNT(DISTINCT TRACE_ID) as trace_count,
  COUNT(DISTINCT SESSION_ID) as session_count,
  SUM(TOTAL_TOKENS) as total_tokens,
  SUM(TOTAL_COST) as total_cost,
  AVG(DURATION_MS) as avg_duration_ms
FROM OPENROUTER_TRACES
WHERE TIMESTAMP >= DATEADD(day, -7, CURRENT_TIMESTAMP())
  AND SPAN_TYPE = 'GENERATION'
GROUP BY USER_ID
ORDER BY total_cost DESC;
```

### Error Analysis

```sql
SELECT
  TRACE_ID,
  TIMESTAMP,
  MODEL,
  LEVEL,
  FINISH_REASON,
  ATTRIBUTES:gen_ai.response.finish_reasons[0]::STRING as otel_finish_reason,
  METADATA as user_metadata,
  INPUT,
  OUTPUT
FROM OPENROUTER_TRACES
WHERE STATUS = 'error'
  AND TIMESTAMP >= DATEADD(hour, -1, CURRENT_TIMESTAMP())
ORDER BY TIMESTAMP DESC;
```

### Cache Efficiency

```sql
SELECT
  MODEL,
  SUM(CACHED_TOKENS) / NULLIF(SUM(PROMPT_TOKENS), 0) * 100 as cache_hit_rate_pct,
  SUM(INPUT_COST - (CACHED_TOKENS * INPUT_UNIT_PRICE * 0.5)) as estimated_cache_savings,
  COUNT(*) as request_count
FROM OPENROUTER_TRACES
WHERE CACHED_TOKENS > 0
  AND TIMESTAMP >= DATEADD(day, -7, CURRENT_TIMESTAMP())
GROUP BY MODEL
ORDER BY cache_hit_rate_pct DESC;
```

### Provider Performance Comparison

```sql
SELECT
  PROVIDER_NAME,
  MODEL,
  AVG(DURATION_MS) as avg_duration_ms,
  PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY DURATION_MS) as p50_duration_ms,
  PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY DURATION_MS) as p95_duration_ms,
  COUNT(*) as request_count
FROM OPENROUTER_TRACES
WHERE TIMESTAMP >= DATEADD(day, -7, CURRENT_TIMESTAMP())
  AND STATUS = 'ok'
  AND SPAN_TYPE = 'GENERATION'
GROUP BY PROVIDER_NAME, MODEL
HAVING request_count >= 10
ORDER BY avg_duration_ms;
```

### Usage by API Key

```sql
SELECT
  API_KEY_NAME,
  COUNT(DISTINCT TRACE_ID) as trace_count,
  SUM(TOTAL_COST) as total_cost,
  SUM(PROMPT_TOKENS) as prompt_tokens,
  SUM(COMPLETION_TOKENS) as completion_tokens
FROM OPENROUTER_TRACES
WHERE TIMESTAMP >= DATEADD(day, -30, CURRENT_TIMESTAMP())
  AND SPAN_TYPE = 'GENERATION'
GROUP BY API_KEY_NAME
ORDER BY total_cost DESC;
```

### Accessing VARIANT Columns

```sql
-- Query custom metadata
SELECT
  TRACE_ID,
  METADATA:custom_field::STRING as custom_value,
  ATTRIBUTES:"gen_ai.request.model"::STRING as requested_model
FROM OPENROUTER_TRACES
WHERE METADATA:custom_field IS NOT NULL;

-- Parse input messages
SELECT
  TRACE_ID,
  INPUT:messages[0]:role::STRING as first_message_role,
  INPUT:messages[0]:content::STRING as first_message_content
FROM OPENROUTER_TRACES
WHERE SPAN_TYPE = 'GENERATION';
```

## Schema Design

### Typed Columns
The schema extracts ~25 commonly-queried fields as typed columns for efficient filtering and aggregation:
- **Identifiers**: TRACE_ID, USER_ID, SESSION_ID, etc.
- **Timestamps**: For time-series analysis
- **Model Info**: For cost and performance analysis
- **Metrics**: Tokens and costs for billing

### VARIANT Columns
Less commonly-accessed and variable-structure data is stored in VARIANT columns:
- **ATTRIBUTES**: Full OTEL attribute set
- **INPUT/OUTPUT**: Variable message structures
- **METADATA**: User-defined key-values
- **MODEL_PARAMETERS**: Model-specific configurations

This design balances query performance with schema flexibility and storage efficiency.

## Data Structure Notes

- Each **observation** in a trace creates a separate row
- Use `PARENT_SPAN_ID` to reconstruct the span hierarchy
- `SPAN_TYPE = 'GENERATION'` identifies actual LLM API calls
- `SPAN_TYPE = 'SPAN'` or `'EVENT'` are wrapper/tool spans
- Most cost analysis should filter to `SPAN_TYPE = 'GENERATION'`
