# TEST-NEEDS: svalinn

## Current State (updated 2026-04-04)

| Category | Count | Details |
|----------|-------|---------|
| **Source modules** | 26 | ReScript: auth (4), bindings (2), compose (2), gateway (3), integrations (2), mcp (3), policy (3), validation (2), vordr (2), Main |
| **Unit tests** | 4 files | AuthTest.res, PolicyEvaluatorTest.res, AuthSecurityTest.res, PolicySecurityTest.res |
| **E2E tests** | 1 file | tests/e2e/gateway_test.js (15 tests — full HTTP pipeline) |
| **Property tests** | 1 file | tests/property/policy_properties_test.js (20 tests — determinism, composition, schema) |
| **Schema tests** | 1 file | tests/schema/schema_test.js (22 tests — all 7 schemas + structural checks) |
| **Benchmarks** | 1 file | tests/bench/gateway_bench.js (12 benchmarks — JWT, policy, E2E, registry) |
| **Fuzz tests** | 0 | placeholder.txt removed — real fuzz requires dedicated harness |
| **Spec schemas** | 7 | Policy JSON schemas in spec/schemas/ |

## Test Matrix

| Layer | File | Tests | Status |
|-------|------|-------|--------|
| Unit (auth) | AuthTest.res | 4 | Existing |
| Unit (policy) | PolicyEvaluatorTest.res | 5 | Existing |
| Security (auth) | AuthSecurityTest.res | 22 | New ✓ |
| Security (policy) | PolicySecurityTest.res | 22 | New ✓ |
| E2E (gateway HTTP) | tests/e2e/gateway_test.js | 15 | New ✓ |
| Property (policy) | tests/property/policy_properties_test.js | 20 | New ✓ |
| Schema (all 7) | tests/schema/schema_test.js | 22 | New ✓ |
| Benchmarks | tests/bench/gateway_bench.js | 12 | New ✓ |

## Benchmark Baselines (2026-04-04, Intel Xeon E3-1505M v5 @ 2.80GHz)

| Benchmark | Time (avg) | Throughput |
|-----------|-----------|------------|
| JWT decode (valid token) | 2.6 µs | 378,600/s |
| Policy eval (allowed, no violations) | 1.3 µs | 780,900/s |
| Policy eval (batch 100 decisions) | 319 µs | 3,135 batches/s |
| E2E pipeline (allowed request) | 54.2 µs | 18,460 req/s |
| E2E pipeline (unauthenticated fast-reject) | 20.6 µs | 48,480/s |
| Registry extract (bare name) | 73 ns | 13,690,000/s |

## Remaining Gaps (CRG C → CRG B path)

### Not Yet Implemented (future work)
- [ ] **JWT revocation / JTI deny-list**: `AuthSecurityTest.res` documents the contract — flip test when implemented
- [ ] **Concurrent request tests**: multi-goroutine / parallel fetch stress test
- [ ] **Real MCP server tests**: protocol handling via mcp/ modules untested
- [ ] **vordr client integration tests**: vordr/ modules have 0 test coverage
- [ ] **Container compose orchestration tests**: compose/ modules untested
- [ ] **Real OAuth2 flow test**: requires mock OIDC server (e.g. using Deno's Hono to simulate)
- [ ] **Fuzz tests**: replace placeholder with real AFL/libfuzzer harness targeting JWT parser

### Build Environment Note
The existing ReScript test .mjs files (and new ones) fail when run via `deno test` due
to `@rescript/core` resolving `.res.mjs` extensions that don't exist in the Deno node_modules
cache. This is a pre-existing issue with the build environment setup, not introduced by
these tests. The Deno JS tests (e2e, property, schema, bench) run successfully and are
the primary runnable test suite until the ReScript + Deno module resolution is fixed.

## Running Tests

```bash
# Deno tests (all passing)
deno test --no-check --allow-net --allow-read --allow-env tests/e2e/gateway_test.js
deno test --no-check --allow-net --allow-read --allow-env tests/property/policy_properties_test.js
deno test --no-check --allow-read tests/schema/schema_test.js

# All Deno tests
deno test --no-check --allow-net --allow-read --allow-env tests/

# Benchmarks
deno bench --no-check --allow-read --allow-net tests/bench/gateway_bench.js

# ReScript compile (from src/)
cd src && rescript build
```

## Priority: P0 → P1 (security baseline met for CRG C)
