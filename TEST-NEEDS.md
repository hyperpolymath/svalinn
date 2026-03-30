# TEST-NEEDS: svalinn

## Current State

| Category | Count | Details |
|----------|-------|---------|
| **Source modules** | 26 | ReScript: auth (4), bindings (2), compose (2), gateway (3), integrations (2), mcp (3), policy (3), validation (2), vordr (2), Main |
| **Unit tests** | 2 files | AuthTest.res, PolicyEvaluatorTest.res (both in src/tests/) |
| **Integration tests** | 0 | None |
| **E2E tests** | 0 | None |
| **Benchmarks** | 0 | None |
| **Fuzz tests** | 0 | placeholder.txt only |
| **Spec schemas** | 7 | Policy JSON schemas in spec/ |

## What's Missing

### P2P Tests (CRITICAL)
- [ ] No tests for gateway <-> policy evaluator interaction
- [ ] No tests for MCP server handling actual MCP protocol messages
- [ ] No tests for vordr client <-> vordr server communication
- [ ] No tests for CerroTorre/PolyContainerMcp integrations

### E2E Tests (CRITICAL)
- [ ] No test running the gateway server with actual HTTP requests
- [ ] No test for the full auth -> policy -> gateway pipeline
- [ ] No test for compose orchestration with real containers

### Aspect Tests
- [ ] **Security**: SECURITY GATEWAY with only AuthTest.res and PolicyEvaluatorTest.res. JWT validation, OAuth2 flow, and schema validation need extensive testing
- [ ] **Performance**: No load tests for the gateway
- [ ] **Concurrency**: No concurrent request handling tests
- [ ] **Error handling**: No tests for invalid JWTs, expired tokens, malformed policies

### Build & Execution
- [ ] No validation that spec/ JSON schemas are correct
- [ ] No test for the policy DSL (POLICY-DSL.adoc) implementation

### Benchmarks Needed
- [ ] Gateway request throughput
- [ ] JWT validation latency
- [ ] Policy evaluation time per request
- [ ] Schema validation overhead

### Self-Tests
- [ ] No gateway healthcheck test
- [ ] No self-diagnostic mode

## FLAGGED ISSUES
- **Security gateway with 2 test files** -- completely inadequate for security-critical infrastructure
- **OAuth2 module has 0 dedicated tests** -- authentication flow untested
- **MCP server has 0 tests** -- protocol handling untested
- **Policy schemas in spec/ but no validation tests** -- schemas may be wrong
- **fuzz/placeholder.txt** -- fake fuzz testing claim

## Priority: P0 (CRITICAL)
