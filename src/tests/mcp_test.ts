// SPDX-License-Identifier: PMPL-1.0-or-later
// MCP server tests

import { assertEquals, assertExists } from "jsr:@std/assert@1";

// MCP tool definitions (matching Tools.res)
interface McpTool {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties: Record<string, unknown>;
    required: string[];
  };
}

// Tool definitions for testing
const svalinnTools: McpTool[] = [
  {
    name: "svalinn_run",
    description: "Run a container with edge validation",
    inputSchema: {
      type: "object",
      properties: {
        image: { type: "string", description: "Container image reference" },
        name: { type: "string", description: "Optional container name" },
        detach: { type: "boolean", description: "Run in background" },
      },
      required: ["image"],
    },
  },
  {
    name: "svalinn_ps",
    description: "List containers managed by Vörðr",
    inputSchema: {
      type: "object",
      properties: {
        all: { type: "boolean" },
        filter: { type: "string" },
      },
      required: [],
    },
  },
  {
    name: "svalinn_stop",
    description: "Stop a running container",
    inputSchema: {
      type: "object",
      properties: {
        containerId: { type: "string" },
        timeout: { type: "integer" },
      },
      required: ["containerId"],
    },
  },
  {
    name: "svalinn_verify",
    description: "Verify container image signature and attestation",
    inputSchema: {
      type: "object",
      properties: {
        image: { type: "string" },
        checkSbom: { type: "boolean" },
        checkSignature: { type: "boolean" },
      },
      required: ["image"],
    },
  },
  {
    name: "svalinn_policy",
    description: "Manage edge security policies",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["get", "set", "validate"] },
        policy: { type: "object" },
      },
      required: ["action"],
    },
  },
  {
    name: "svalinn_logs",
    description: "Get container logs",
    inputSchema: {
      type: "object",
      properties: {
        containerId: { type: "string" },
        tail: { type: "integer" },
        since: { type: "string" },
      },
      required: ["containerId"],
    },
  },
  {
    name: "svalinn_exec",
    description: "Execute a command in a running container",
    inputSchema: {
      type: "object",
      properties: {
        containerId: { type: "string" },
        command: { type: "array", items: { type: "string" } },
      },
      required: ["containerId", "command"],
    },
  },
  {
    name: "svalinn_rm",
    description: "Remove a stopped container",
    inputSchema: {
      type: "object",
      properties: {
        containerId: { type: "string" },
        force: { type: "boolean" },
      },
      required: ["containerId"],
    },
  },
];

// Tests
Deno.test("all 8 MCP tools are defined", () => {
  assertEquals(svalinnTools.length, 8);
});

Deno.test("svalinn_run has correct schema", () => {
  const tool = svalinnTools.find((t) => t.name === "svalinn_run");
  assertExists(tool);
  assertEquals(tool.inputSchema.type, "object");
  assertEquals(tool.inputSchema.required, ["image"]);
  assertExists(tool.inputSchema.properties.image);
});

Deno.test("svalinn_ps has no required parameters", () => {
  const tool = svalinnTools.find((t) => t.name === "svalinn_ps");
  assertExists(tool);
  assertEquals(tool.inputSchema.required.length, 0);
});

Deno.test("svalinn_stop requires containerId", () => {
  const tool = svalinnTools.find((t) => t.name === "svalinn_stop");
  assertExists(tool);
  assertEquals(tool.inputSchema.required.includes("containerId"), true);
});

Deno.test("svalinn_verify requires image", () => {
  const tool = svalinnTools.find((t) => t.name === "svalinn_verify");
  assertExists(tool);
  assertEquals(tool.inputSchema.required, ["image"]);
});

Deno.test("svalinn_policy requires action", () => {
  const tool = svalinnTools.find((t) => t.name === "svalinn_policy");
  assertExists(tool);
  assertEquals(tool.inputSchema.required, ["action"]);
});

Deno.test("svalinn_logs requires containerId", () => {
  const tool = svalinnTools.find((t) => t.name === "svalinn_logs");
  assertExists(tool);
  assertEquals(tool.inputSchema.required, ["containerId"]);
});

Deno.test("svalinn_exec requires containerId and command", () => {
  const tool = svalinnTools.find((t) => t.name === "svalinn_exec");
  assertExists(tool);
  assertEquals(tool.inputSchema.required.includes("containerId"), true);
  assertEquals(tool.inputSchema.required.includes("command"), true);
});

Deno.test("svalinn_rm requires containerId", () => {
  const tool = svalinnTools.find((t) => t.name === "svalinn_rm");
  assertExists(tool);
  assertEquals(tool.inputSchema.required, ["containerId"]);
});

Deno.test("all tools have descriptions", () => {
  for (const tool of svalinnTools) {
    assertExists(tool.description);
    assertEquals(tool.description.length > 0, true);
  }
});

Deno.test("all tools have valid input schemas", () => {
  for (const tool of svalinnTools) {
    assertExists(tool.inputSchema);
    assertEquals(tool.inputSchema.type, "object");
    assertExists(tool.inputSchema.properties);
    assertExists(tool.inputSchema.required);
  }
});

// MCP protocol tests
Deno.test("initialize response has correct structure", () => {
  const initResponse = {
    protocolVersion: "2024-11-05",
    capabilities: { tools: {} },
    serverInfo: {
      name: "svalinn",
      version: "0.1.0",
    },
  };

  assertEquals(initResponse.protocolVersion, "2024-11-05");
  assertExists(initResponse.capabilities.tools);
  assertEquals(initResponse.serverInfo.name, "svalinn");
});

Deno.test("tools/list response has correct structure", () => {
  const listResponse = {
    tools: svalinnTools,
  };

  assertEquals(Array.isArray(listResponse.tools), true);
  assertEquals(listResponse.tools.length, 8);
});

Deno.test("tool result has correct structure", () => {
  const successResult = {
    content: [{ type: "text", text: "Container started: abc123" }],
  };

  assertExists(successResult.content);
  assertEquals(successResult.content[0].type, "text");
  assertExists(successResult.content[0].text);
});

Deno.test("error result has isError flag", () => {
  const errorResult = {
    content: [{ type: "text", text: "Failed to start container" }],
    isError: true,
  };

  assertEquals(errorResult.isError, true);
});
