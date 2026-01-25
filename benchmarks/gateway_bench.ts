// SPDX-License-Identifier: PMPL-1.0-or-later
// Performance benchmarks for Svalinn Gateway

import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";

// Mock MCP client responses for benchmarking
const mockMcpResponse = {
  jsonrpc: "2.0",
  result: { containers: [] },
  id: 1,
};

// Benchmark: Health endpoint response time
Deno.bench({
  name: "Health endpoint latency",
  group: "endpoints",
  baseline: true,
  async fn() {
    const response = await fetch("http://localhost:8000/health");
    assertEquals(response.status, 200);
    await response.json();
  },
});

// Benchmark: Container list endpoint
Deno.bench({
  name: "Container list endpoint latency",
  group: "endpoints",
  async fn() {
    const response = await fetch("http://localhost:8000/api/v1/containers");
    await response.json();
  },
});

// Benchmark: JSON Schema validation overhead
Deno.bench({
  name: "JSON Schema validation (run request)",
  group: "validation",
  async fn() {
    const payload = {
      image: "nginx:alpine",
      name: "test-container",
      config: {},
    };

    const response = await fetch("http://localhost:8000/api/v1/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    await response.json();
  },
});

// Benchmark: Policy validation overhead
Deno.bench({
  name: "Policy format validation",
  group: "validation",
  async fn() {
    const payload = {
      digest: "sha256:abc123",
      policy: {
        version: 1,
        requiredPredicates: ["https://slsa.dev/provenance/v1"],
        allowedSigners: ["sha256:signer123"],
        logQuorum: 1,
        mode: "strict",
      },
    };

    const response = await fetch("http://localhost:8000/api/v1/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    await response.json();
  },
});

// Benchmark: Concurrent requests
Deno.bench({
  name: "10 concurrent health checks",
  group: "concurrency",
  async fn() {
    const requests = Array.from({ length: 10 }, () =>
      fetch("http://localhost:8000/health").then((r) => r.json())
    );

    await Promise.all(requests);
  },
});

// Benchmark: 100 concurrent requests
Deno.bench({
  name: "100 concurrent health checks",
  group: "concurrency",
  async fn() {
    const requests = Array.from({ length: 100 }, () =>
      fetch("http://localhost:8000/health").then((r) => r.json())
    );

    await Promise.all(requests);
  },
});

console.log(`
Performance Benchmark Suite for Svalinn Gateway
================================================

Prerequisites:
1. Start Svalinn gateway: just serve
2. Ensure Vörðr is running (or mock enabled)

Running benchmarks:
  deno bench --allow-net benchmarks/gateway_bench.ts

Performance targets:
- Health check: < 10ms
- Container list: < 100ms (depends on Vörðr)
- Validation: < 5ms
- Policy check: < 10ms
- 100 concurrent: < 500ms total
`);
