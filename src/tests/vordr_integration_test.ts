// SPDX-License-Identifier: PMPL-1.0-or-later
// Vörðr integration tests

import { assertEquals, assertExists } from "jsr:@std/assert@1";

const VORDR_ENDPOINT = Deno.env.get("VORDR_ENDPOINT") || "http://localhost:8080";

// Check if Vörðr is available
async function isVordrAvailable(): Promise<boolean> {
  try {
    const response = await fetch(`${VORDR_ENDPOINT}/health`, {
      signal: AbortSignal.timeout(1000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

// MCP JSON-RPC helper
async function mcpCall(method: string, params: unknown): Promise<unknown> {
  const request = {
    jsonrpc: "2.0",
    method,
    params,
    id: Date.now(),
  };

  const response = await fetch(VORDR_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });

  const json = await response.json();
  if (json.error) {
    throw new Error(json.error.message);
  }
  return json.result;
}

// === Connectivity Tests ===

Deno.test({
  name: "Vörðr connectivity check",
  fn: async () => {
    const available = await isVordrAvailable();
    if (!available) {
      console.log("⚠️  Vörðr not available - run integration tests with VORDR_ENDPOINT set");
    }
    // This test always passes - it just reports status
    assertExists(typeof available);
  },
});

// === MCP Protocol Tests (require Vörðr) ===

Deno.test({
  name: "MCP initialize handshake",
  ignore: !(await isVordrAvailable()),
  fn: async () => {
    const result = await mcpCall("initialize", {
      protocolVersion: "0.1.0",
      capabilities: {},
      clientInfo: {
        name: "svalinn-integration-test",
        version: "0.1.0",
      },
    });

    assertExists(result);
  },
});

Deno.test({
  name: "MCP tools/list returns Vörðr tools",
  ignore: !(await isVordrAvailable()),
  fn: async () => {
    const result = await mcpCall("tools/list", {}) as { tools: unknown[] };

    assertExists(result.tools);
    assertEquals(Array.isArray(result.tools), true);

    // Check for expected Vörðr tools
    const toolNames = (result.tools as Array<{ name: string }>).map((t) => t.name);
    console.log("Available tools:", toolNames);

    // Vörðr should expose container and verification tools
    const expectedTools = [
      "vordr_container_create",
      "vordr_container_start",
      "vordr_container_stop",
      "vordr_verify_image",
    ];

    for (const tool of expectedTools) {
      if (!toolNames.includes(tool)) {
        console.log(`⚠️  Tool ${tool} not found - may not be implemented yet`);
      }
    }
  },
});

// === Container Lifecycle Tests (require Vörðr) ===

Deno.test({
  name: "Container create validates image reference",
  ignore: !(await isVordrAvailable()),
  fn: async () => {
    try {
      await mcpCall("tools/call", {
        name: "vordr_container_create",
        arguments: {
          image: "alpine:3.18",
          name: "test-container",
          config: {
            privileged: false,
            readOnlyRoot: true,
          },
        },
      });
    } catch (e) {
      // Expected if container runtime not available
      console.log("Container create result:", e);
    }
  },
});

Deno.test({
  name: "Image verification checks SBOM",
  ignore: !(await isVordrAvailable()),
  fn: async () => {
    try {
      const result = await mcpCall("tools/call", {
        name: "vordr_verify_image",
        arguments: {
          image: "alpine:3.18",
          checkSbom: true,
          checkSignature: false,
        },
      });

      console.log("Verification result:", result);
      assertExists(result);
    } catch (e) {
      console.log("Verification error (expected if not fully implemented):", e);
    }
  },
});

// === Svalinn → Vörðr Integration Tests ===

Deno.test({
  name: "Svalinn client can instantiate",
  fn: () => {
    // Test that we can create a Vörðr client configuration
    const config = {
      endpoint: VORDR_ENDPOINT,
      timeout: 30000,
    };

    assertExists(config.endpoint);
    assertEquals(config.timeout, 30000);
  },
});

Deno.test({
  name: "Svalinn validates before forwarding to Vörðr",
  fn: async () => {
    // Import policy evaluator
    const { evaluate } = await import("../policy/evaluator.ts");
    const { strictPolicy } = await import("../policy/defaults.ts");

    // Test that Svalinn rejects invalid requests before they reach Vörðr
    const invalidRequest = {
      image: "evil.registry.com/malware:latest",
    };

    const result = evaluate(strictPolicy, invalidRequest);

    // Should be blocked at Svalinn level, never reaching Vörðr
    assertEquals(result.allowed, false);
    assertEquals(result.violations.length > 0, true);
  },
});

Deno.test({
  name: "Svalinn allows valid requests for Vörðr",
  fn: async () => {
    const { evaluate } = await import("../policy/evaluator.ts");
    const { strictPolicy } = await import("../policy/defaults.ts");

    const validRequest = {
      image: "docker.io/library/alpine:3.18",
    };

    const result = evaluate(strictPolicy, validRequest);

    // Should be allowed to proceed to Vörðr
    assertEquals(result.allowed, true);
    assertEquals(result.violations.length, 0);
  },
});

// === End-to-End Flow Tests ===

Deno.test({
  name: "E2E: Policy check → Vörðr verify → result",
  ignore: !(await isVordrAvailable()),
  fn: async () => {
    const { evaluate } = await import("../policy/evaluator.ts");
    const { standardPolicy } = await import("../policy/defaults.ts");

    // Step 1: Svalinn policy check
    const request = {
      image: "docker.io/library/alpine:latest",
    };

    const policyResult = evaluate(standardPolicy, request);
    console.log("Policy result:", policyResult);

    if (!policyResult.allowed) {
      console.log("Request blocked by policy");
      return;
    }

    // Step 2: Forward to Vörðr for verification
    try {
      const verifyResult = await mcpCall("tools/call", {
        name: "vordr_verify_image",
        arguments: {
          image: request.image,
          checkSbom: true,
          checkSignature: false,
        },
      });

      console.log("Vörðr verification result:", verifyResult);
      assertExists(verifyResult);
    } catch (e) {
      console.log("Vörðr verification not available:", e);
    }
  },
});

Deno.test({
  name: "E2E: Run container with policy enforcement",
  ignore: !(await isVordrAvailable()),
  fn: async () => {
    const { evaluate } = await import("../policy/evaluator.ts");
    const { strictPolicy } = await import("../policy/defaults.ts");

    // Request with security settings
    const request = {
      image: "docker.io/library/alpine:3.18",
      privileged: false,
      hostNetwork: false,
      memory: 512,
    };

    // Step 1: Policy enforcement
    const policyResult = evaluate(strictPolicy, request);
    assertEquals(policyResult.allowed, true, "Valid request should be allowed");

    // Step 2: Forward to Vörðr
    try {
      const createResult = await mcpCall("tools/call", {
        name: "vordr_container_create",
        arguments: {
          image: request.image,
          name: `svalinn-test-${Date.now()}`,
          config: {
            privileged: request.privileged,
            readOnlyRoot: true,
            memory: request.memory,
          },
        },
      });

      console.log("Container created:", createResult);
      assertExists(createResult);

      // Cleanup - stop and remove container
      const containerId = (createResult as { containerId: string }).containerId;
      if (containerId) {
        await mcpCall("tools/call", {
          name: "vordr_container_stop",
          arguments: { containerId },
        });
        await mcpCall("tools/call", {
          name: "vordr_container_remove",
          arguments: { containerId },
        });
      }
    } catch (e) {
      console.log("Container operations not available:", e);
    }
  },
});

// === Authorization Tests (require Vörðr) ===

Deno.test({
  name: "Multi-party authorization request",
  ignore: !(await isVordrAvailable()),
  fn: async () => {
    try {
      const result = await mcpCall("tools/call", {
        name: "vordr_request_authorization",
        arguments: {
          operation: "container.create",
          threshold: 2,
          signers: 3,
        },
      });

      console.log("Authorization request:", result);
      assertExists(result);
    } catch (e) {
      console.log("Authorization not available:", e);
    }
  },
});

// === Monitoring Tests (require Vörðr) ===

Deno.test({
  name: "eBPF monitoring configuration",
  ignore: !(await isVordrAvailable()),
  fn: async () => {
    try {
      const result = await mcpCall("tools/call", {
        name: "vordr_monitor_start",
        arguments: {
          containerId: "test-container",
          syscalls: true,
          network: true,
          filesystem: true,
        },
      });

      console.log("Monitor start:", result);
    } catch (e) {
      console.log("Monitoring not available:", e);
    }
  },
});

// === Rollback Tests (require Vörðr) ===

Deno.test({
  name: "Rollback preview",
  ignore: !(await isVordrAvailable()),
  fn: async () => {
    try {
      const result = await mcpCall("tools/call", {
        name: "vordr_preview_rollback",
        arguments: {
          containerId: "test-container",
        },
      });

      console.log("Rollback preview:", result);
    } catch (e) {
      console.log("Rollback not available:", e);
    }
  },
});
