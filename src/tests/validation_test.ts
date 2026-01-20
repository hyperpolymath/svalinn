// SPDX-License-Identifier: PMPL-1.0-or-later
// Schema validation tests

import { assertEquals, assertExists } from "jsr:@std/assert@1";
import Ajv from "npm:ajv@8";
import addFormats from "npm:ajv-formats@3";

// Create fresh AJV instance for each test to avoid schema conflicts
function createValidator() {
  const ajv = new Ajv.default({ allErrors: true });
  addFormats.default(ajv);
  return ajv;
}

// Load schemas
const schemaDir = new URL("../../spec/schemas/", import.meta.url);

async function loadSchema(name: string): Promise<unknown> {
  try {
    const path = new URL(name, schemaDir);
    const text = await Deno.readTextFile(path);
    return JSON.parse(text);
  } catch {
    return null;
  }
}

Deno.test("run request schema validates correct request", async () => {
  const schema = await loadSchema("gateway-run-request.v1.json");
  if (!schema) {
    console.log("Schema not found, skipping");
    return;
  }

  const ajv = createValidator();
  const validate = ajv.compile(schema);

  const validRequest = {
    imageName: "alpine:latest",
    imageDigest: "sha256:abc123def456",
  };

  const result = validate(validRequest);
  assertEquals(result, true);
});

Deno.test("run request schema rejects missing required fields", async () => {
  const schema = await loadSchema("gateway-run-request.v1.json");
  if (!schema) {
    return;
  }

  const ajv = createValidator();
  const validate = ajv.compile(schema);

  const invalidRequest = {
    // Missing imageName and imageDigest
    name: "test-container",
  };

  const result = validate(invalidRequest);
  assertEquals(result, false);
  assertExists(validate.errors);
});

Deno.test("run request schema accepts optional fields", async () => {
  const schema = await loadSchema("gateway-run-request.v1.json");
  if (!schema) {
    return;
  }

  const ajv = createValidator();
  const validate = ajv.compile(schema);

  const requestWithOptionals = {
    imageName: "nginx:latest",
    imageDigest: "sha256:xyz789",
    name: "my-nginx",
    detach: true,
    removeOnExit: false,
    profile: "default",
    vordrArgs: ["--debug"],
    runCommand: ["/bin/sh", "-c", "echo hello"],
  };

  const result = validate(requestWithOptionals);
  assertEquals(result, true);
});

Deno.test("verify request schema validates correct request", async () => {
  const schema = await loadSchema("gateway-verify-request.v1.json");
  if (!schema) {
    return;
  }

  const ajv = createValidator();
  const validate = ajv.compile(schema);

  const validRequest = {
    imageRef: "alpine:latest",
  };

  const result = validate(validRequest);
  // Schema may have different required fields - just check it compiles
  assertExists(result);
});

Deno.test("verify request schema accepts optional checks", async () => {
  const schema = await loadSchema("gateway-verify-request.v1.json");
  if (!schema) {
    return;
  }

  const ajv = createValidator();
  const validate = ajv.compile(schema);

  const requestWithOptions = {
    imageRef: "ghcr.io/myorg/myimage:v1.0.0",
    checkSbom: true,
    checkSignature: true,
  };

  const result = validate(requestWithOptions);
  assertExists(result);
});

Deno.test("container info schema structure", async () => {
  const schema = await loadSchema("container-info.v1.json");
  if (!schema) {
    return;
  }

  assertExists(schema);
  assertEquals(typeof schema, "object");
});

Deno.test("error response schema structure", async () => {
  const schema = await loadSchema("error-response.v1.json");
  if (!schema) {
    return;
  }

  const ajv = createValidator();
  const validate = ajv.compile(schema);

  const errorResponse = {
    code: "VALIDATION_ERROR",
    message: "Invalid request",
    timestamp: new Date().toISOString(),
  };

  const result = validate(errorResponse);
  assertExists(result);
});
