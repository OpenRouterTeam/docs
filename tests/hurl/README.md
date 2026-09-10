# OpenRouter API Hurl Test Suite

This directory contains comprehensive HTTP API tests for OpenRouter using [Hurl](https://hurl.dev/), a command-line tool for testing HTTP APIs with plain text files.

## Current State

### ✅ Completed
- **Hurl installation**: Successfully installed Hurl 4.3.0 for HTTP API testing
- **Basic endpoint tests** (`01-basic.hurl`): Homepage, models listing, model endpoints, providers, parameters, llms-full.txt
- **Authentication tests** (`02-auth.hurl`): Comprehensive auth scenarios including valid/invalid/missing API keys, malformed tokens
- **Chat completions tests** (`03-chat-completions.hurl`): Streaming and non-streaming completions, system messages, legacy completions, error scenarios
- **Generation metadata tests** (`04-generation-metadata.hurl`): Post-completion metadata retrieval for both streaming and non-streaming, error handling
- **API key management tests** (`05-api-keys.hurl`): Full CRUD operations on API keys, key validation, legacy endpoint testing
- **Test runner script** (`run-all.sh`): Executes all tests with proper error handling and status reporting
- **Comprehensive assertions**: JSONPath validation for response structure, error codes, required fields

### ⏳ Remaining Work
- **Environment resolution**: Complete local development setup with proper database configuration
- **Test validation**: Run tests against properly configured API server to validate assertions
- **Response refinement**: Adjust assertions based on actual API responses once environment is working
- **Enhanced test scenarios**:
  - Rate limiting behavior testing
  - Large payload handling
  - Response time assertions
  - Header validation improvements
- **Test data management**:
  - Dynamic test data generation
  - Cleanup procedures for test artifacts
  - Test isolation improvements

## Test Organization

### File Structure
```
tests/hurl/
├── README.md                    # This file
├── 01-basic.hurl               # Homepage, models, basic endpoints
├── 02-auth.hurl                # Authentication scenarios
├── 03-chat-completions.hurl    # Chat completions (streaming/non-streaming)
├── 04-generation-metadata.hurl # Generation metadata retrieval
├── 05-api-keys.hurl           # API key management
├── 06-key-limits-negative-balance.hurl # Key limits and negative balance scenarios
├── 07-oauth-pkce.hurl         # OAuth PKCE flow tests
├── 08-oauth-pkce-errors.hurl  # OAuth PKCE error scenarios
├── 09-internal-routes.hurl    # Internal routes tests
├── 10-guardrails-crud.hurl    # Guardrails CRUD operations
└── run-all.sh                 # Test runner script
```

### Test Coverage

| Endpoint | Auth Required | Streaming | Status |
|----------|---------------|-----------|---------|
| `GET /` | No | No | ✅ |
| `GET /docs/llms-full.txt` | No | No | ✅ |
| `GET /api/v1/model/{author}/{slug}` | No | No | ⏳ |
| `GET /api/v1/models` | No | No | ✅ |
| `GET /api/v1/models/{author}/{slug}/endpoints` | No | No | ✅ |
| `POST /api/v1/chat/completions` | Yes | No | ✅ |
| `POST /api/v1/chat/completions` | Yes | Yes | ✅ |
| `GET /api/v1/generation` | Yes | No | ✅ |
| `GET /api/v1/credits` | Yes | No | ✅ |
| `GET /api/v1/key` | Yes | No | ✅ |
| `GET /api/v1/keys` | Yes | No | ✅ |
| `POST /api/keys/code` | Yes | No | ✅ |
| `POST /api/v1/auth/keys` | No | No | ✅ |
| `GET /api/v1/guardrails` | Yes (Admin) | No | ✅ |
| `POST /api/v1/guardrails` | Yes (Admin) | No | ✅ |
| `GET /api/v1/guardrails/{id}` | Yes (Admin) | No | ✅ |
| `PATCH /api/v1/guardrails/{id}` | Yes (Admin) | No | ✅ |
| `DELETE /api/v1/guardrails/{id}` | Yes (Admin) | No | ✅ |
| `GET /api/v1/providers` | No | No | ⏳ |
| `GET /api/v1/parameters/{author}/{slug}` | No | No | ⏳ |

## Running Tests

### Prerequisites
1. **Install Hurl**: Download from [GitHub releases](https://github.com/Orange-OpenSource/hurl/releases)
2. **Start local API server**:
   ```bash
   cd /path/to/openrouter-web
   bun run dev:up
   tilt wait --for=condition=Ready uiresource/api --timeout=300s
   ```
   Use the API origin reported by Tilt (normally `http://localhost:8787`). See [local-dev-env](../../.agents/skills/local-dev-env/SKILL.md) for setup and port discovery.

### Running All Tests
```bash
# Make script executable
chmod +x tests/hurl/run-all.sh

# Run all tests
./tests/hurl/run-all.sh
```

### Running Individual Tests
```bash
# Run specific test file
hurl --test tests/hurl/01-basic.hurl

# Run with verbose output
hurl --test --verbose tests/hurl/02-auth.hurl

# Run and capture variables for debugging
hurl --test --variables-file vars.env tests/hurl/03-chat-completions.hurl
```

### Test Configuration
- **Base URL**: `http://localhost:8787`
- **Test API Key**: `sk-or-v1-unlimitedkey` (unlimited development key)
- **Default Model**: `openai/gpt-3.5-turbo` (for chat completion tests)

## Key Test Scenarios

### Authentication Testing
- ✅ Valid API key authentication
- ✅ Invalid API key rejection (401)
- ✅ Missing API key rejection (401)
- ✅ Bearer token format validation

### Chat Completions
- ✅ Non-streaming completions with usage tracking
- ✅ Streaming completions with proper content-type
- ✅ Required response fields validation (`id`, `choices`, `usage`)
- ✅ Message format validation

### Generation Metadata
- ✅ Metadata retrieval after completion
- ✅ Generation ID capture and reuse
- ✅ Invalid ID handling (404)
- ✅ Unauthorized access handling (401)

### Response Assertions
- HTTP status code validation
- JSON structure validation using JSONPath
- Required field existence checks
- Collection type validation
- Content-type header validation

## GitHub Actions Integration Plan

### Phase 1: Manual Dispatch Action
**Status: TODO** - `.github/workflows/hurl-api-tests.yml`

**Features:**
- Manual dispatch with environment selection (localhost/production)
- Templatable base URL configuration
- Selective test suite execution (all/basic/auth/completions/metadata/api-keys)
- Dynamic API key replacement using GitHub secrets
- Comprehensive test result reporting and artifacts
- Localhost environment setup with Postgres integration
- Production testing against https://openrouter.ai

**Required GitHub Secrets:**
- `HURL_PROVISIONING_KEY` - For API key management operations
- `HURL_UNLIMITED_KEY` - For general testing (unlimited usage)
- `HURL_FREE_USER_KEY` - For free tier testing
- `HURL_DEPLETED_KEY` - For depleted balance testing
- `HURL_DISABLED_KEY` - For disabled key testing
- `HURL_DELETED_KEY` - For deleted key testing
- `PG_US_CENTRAL1_POOL_DB_URL` - For database connectivity (e.g. `postgresql://postgres:postgres@127.0.0.1:54322/postgres`)

### Phase 2: Automated Integration
- **PR validation**: Run subset of critical tests on pull requests
- **Deployment verification**: Run full test suite after deployments
- **Scheduled monitoring**: Daily/hourly health checks against production
- **Performance benchmarking**: Track response times and success rates

### Phase 3: Advanced Features
- **Multi-environment testing**: Parallel execution against dev/staging/prod
- **Test result reporting**: Integration with GitHub status checks
- **Slack/Discord notifications**: Alert on test failures
- **Test data management**: Dynamic test data setup/teardown
- **Load testing integration**: Combine with performance testing tools

## Development Workflow

### Adding New Tests
1. Create new `.hurl` file or extend existing ones
2. Follow naming convention: `##-description.hurl`
3. Include comprehensive assertions for response validation
4. Update this README with new test coverage
5. Test locally before committing

### Test Maintenance
- **Regular updates**: Keep tests in sync with API changes
- **Response validation**: Update assertions when API responses evolve
- **Performance monitoring**: Track test execution times
- **Documentation**: Keep README current with test capabilities

### Debugging Failed Tests
```bash
# Run with maximum verbosity
hurl --test --verbose --very-verbose tests/hurl/failing-test.hurl

# Capture full HTTP exchange
hurl --test --include tests/hurl/failing-test.hurl

# Use variables for dynamic debugging
hurl --test --variables-file debug.env tests/hurl/failing-test.hurl
```

## Contributing

When adding new tests or modifying existing ones:
1. Ensure tests are idempotent and can run multiple times
2. Use descriptive test names and comments
3. Include both positive and negative test cases
4. Validate all critical response fields
5. Follow the existing file organization pattern
6. Update this README with any new coverage or capabilities

## Troubleshooting

### Common Issues
- **Server not running**: Ensure `bun run dev cfw-api` is running on port 8787
- **Authentication failures**: Verify `sk-or-v1-unlimitedkey` is properly configured
- **Timeout errors**: Increase wait times for generation metadata tests
- **JSON parsing errors**: Check API response format changes

### Debug Commands
```bash
# Check if API server is responding
curl -I http://localhost:8787/

# Validate API key
curl -H "Authorization: Bearer sk-or-v1-unlimitedkey" http://localhost:8787/api/v1/key

# Test specific endpoint manually
curl -X POST http://localhost:8787/api/v1/chat/completions \
  -H "Authorization: Bearer sk-or-v1-unlimitedkey" \
  -H "Content-Type: application/json" \
  -d '{"model":"openai/gpt-3.5-turbo","messages":[{"role":"user","content":"test"}]}'
```
