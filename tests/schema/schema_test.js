// SPDX-License-Identifier: PMPL-1.0-or-later
/**
 * JSON Schema Validation Tests for Svalinn
 *
 * Verifies that each of the policy JSON schemas in spec/schemas/ is:
 *   a) Valid JSON (parseable without error).
 *   b) A well-formed JSON Schema (has $schema, $id, type, required).
 *   c) Rejects clearly invalid documents.
 *   d) Accepts the documented examples from the schema's own "examples" field.
 *
 * Uses a minimal in-process structural validator so tests run fully offline
 * without importing ajv over the network.
 *
 * Run with:
 *   deno test --allow-read tests/schema/schema_test.js
 *
 * Author: Jonathan D.A. Jewell <6759885+hyperpolymath@users.noreply.github.com>
 */

// @ts-nocheck
import { assertEquals, assertExists } from "jsr:@std/assert@1";
import { join, dirname, fromFileUrl } from "jsr:@std/path@^1";

// ─── Path helpers ─────────────────────────────────────────────────────────────

const TEST_DIR = dirname(fromFileUrl(import.meta.url));
const REPO_ROOT = join(TEST_DIR, "..", "..");
const SCHEMAS_DIR = join(REPO_ROOT, "spec", "schemas");

/**
 * Load and parse a JSON schema file from spec/schemas/.
 *
 * @param {string} filename
 * @returns {Promise<Record<string, unknown>>}
 */
async function loadSchema(filename) {
  const path = join(SCHEMAS_DIR, filename);
  const text = await Deno.readTextFile(path);
  return JSON.parse(text);
}

// ─── Minimal structural schema validator ─────────────────────────────────────

/**
 * Validate a document against a JSON Schema's required + properties type
 * declarations. Returns a list of error strings (empty = valid).
 *
 * Supports: required fields, type, enum, minimum, minItems, pattern.
 *
 * @param {Record<string, unknown>} schema
 * @param {Record<string, unknown>} doc
 * @returns {string[]}
 */
function validateAgainstSchema(schema, doc) {
  const errors = [];
  const required = schema.required;
  const properties = schema.properties;

  if (Array.isArray(required)) {
    for (const field of required) {
      if (!(field in doc)) {
        errors.push(`Missing required field: ${field}`);
      }
    }
  }

  if (properties && typeof properties === "object") {
    for (const [field, def] of Object.entries(properties)) {
      if (!(field in doc)) continue;
      const value = doc[field];

      // Type check — JSON Schema "integer" maps to JS "number" with no fraction
      if (def.type) {
        const types = Array.isArray(def.type) ? def.type : [def.type];
        let actualType;
        if (Array.isArray(value)) {
          actualType = "array";
        } else if (value === null) {
          actualType = "null";
        } else {
          actualType = typeof value;
        }
        // Normalise: JSON Schema "integer" is satisfied by JS "number" values
        // that have no fractional part (i.e. Number.isInteger).
        const typeMatches = types.some((t) => {
          if (t === actualType) return true;
          if (t === "integer" && actualType === "number" && Number.isInteger(value)) return true;
          return false;
        });
        if (!typeMatches) {
          errors.push(
            `Field '${field}': expected type ${types.join("|")}, got ${actualType}`,
          );
        }
      }

      // Enum check
      if (Array.isArray(def.enum) && !def.enum.includes(value)) {
        errors.push(
          `Field '${field}': value ${JSON.stringify(value)} not in enum ${JSON.stringify(def.enum)}`,
        );
      }

      // Minimum for numbers
      if (def.minimum !== undefined && typeof value === "number" && value < def.minimum) {
        errors.push(`Field '${field}': value ${value} is less than minimum ${def.minimum}`);
      }

      // minItems for arrays
      if (def.minItems !== undefined && Array.isArray(value) && value.length < def.minItems) {
        errors.push(
          `Field '${field}': array has ${value.length} items, minimum is ${def.minItems}`,
        );
      }

      // Pattern for strings
      if (def.pattern && typeof value === "string") {
        if (!new RegExp(def.pattern).test(value)) {
          errors.push(
            `Field '${field}': value '${value}' does not match pattern ${def.pattern}`,
          );
        }
      }
    }
  }

  return errors;
}

// ─── Schema file list ─────────────────────────────────────────────────────────

const SCHEMA_FILES = [
  "compose.v1.json",
  "container-info.v1.json",
  "containers.v1.json",
  "error-response.v1.json",
  "gatekeeper-policy.v1.json",
  "gateway-run-request.v1.json",
  "gateway-verify-request.v1.json",
];

// ─── Meta-validation tests ────────────────────────────────────────────────────

Deno.test("schemas: all 7 schema files are valid JSON", async () => {
  for (const file of SCHEMA_FILES) {
    const schema = await loadSchema(file);
    assertExists(schema, `${file} should parse as a JSON object`);
    assertEquals(typeof schema, "object");
  }
});

Deno.test("schemas: all schemas have $schema field", async () => {
  for (const file of SCHEMA_FILES) {
    const schema = await loadSchema(file);
    assertExists(schema.$schema, `${file} must have a $schema field`);
    assertEquals(typeof schema.$schema, "string", `${file}.$schema must be a string`);
  }
});

Deno.test("schemas: all schemas have $id field", async () => {
  for (const file of SCHEMA_FILES) {
    const schema = await loadSchema(file);
    assertExists(schema.$id, `${file} must have a $id field`);
  }
});

Deno.test("schemas: all schemas have title field", async () => {
  for (const file of SCHEMA_FILES) {
    const schema = await loadSchema(file);
    assertExists(schema.title, `${file} must have a title`);
  }
});

Deno.test("schemas: all schemas specify type: object", async () => {
  for (const file of SCHEMA_FILES) {
    const schema = await loadSchema(file);
    assertEquals(schema.type, "object", `${file} should have type: "object"`);
  }
});

// ─── gateway-run-request.v1.json ──────────────────────────────────────────────

Deno.test("gateway-run-request: valid document passes (imageName + imageDigest)", async () => {
  const schema = await loadSchema("gateway-run-request.v1.json");
  const doc = {
    imageName: "docker.io/library/alpine:3.18",
    imageDigest: "sha256:abcdef0123456789",
  };
  const errors = validateAgainstSchema(schema, doc);
  assertEquals(errors, []);
});

Deno.test("gateway-run-request: missing imageName is rejected", async () => {
  const schema = await loadSchema("gateway-run-request.v1.json");
  const doc = { imageDigest: "sha256:abc" };
  const errors = validateAgainstSchema(schema, doc);
  assertEquals(errors.some((e) => e.includes("imageName")), true);
});

Deno.test("gateway-run-request: missing imageDigest is rejected", async () => {
  const schema = await loadSchema("gateway-run-request.v1.json");
  const doc = { imageName: "alpine:3.18" };
  const errors = validateAgainstSchema(schema, doc);
  assertEquals(errors.some((e) => e.includes("imageDigest")), true);
});

Deno.test("gateway-run-request: full valid document with optional fields", async () => {
  const schema = await loadSchema("gateway-run-request.v1.json");
  const doc = {
    imageName: "ghcr.io/hyperpolymath/svalinn:latest",
    imageDigest: "sha256:cafebabe",
    profile: "strict",
    removeOnExit: true,
    detach: false,
    vordrArgs: ["--no-network"],
    runCommand: ["/bin/sh", "-c", "echo hello"],
    useCommandSeparator: true,
  };
  const errors = validateAgainstSchema(schema, doc);
  assertEquals(errors, []);
});

// ─── gateway-verify-request.v1.json ──────────────────────────────────────────

Deno.test("gateway-verify-request: valid document passes (imageDigest only)", async () => {
  const schema = await loadSchema("gateway-verify-request.v1.json");
  const doc = { imageDigest: "sha256:abcdef" };
  const errors = validateAgainstSchema(schema, doc);
  assertEquals(errors, []);
});

Deno.test("gateway-verify-request: missing imageDigest is rejected", async () => {
  const schema = await loadSchema("gateway-verify-request.v1.json");
  const doc = { bundlePath: "/tmp/bundle.json" };
  const errors = validateAgainstSchema(schema, doc);
  assertEquals(errors.some((e) => e.includes("imageDigest")), true);
});

// ─── error-response.v1.json ───────────────────────────────────────────────────

Deno.test("error-response: valid error document passes", async () => {
  const schema = await loadSchema("error-response.v1.json");
  const doc = {
    error: {
      code: 401,
      id: "ERR_UNAUTHENTICATED",
      message: "No valid token provided",
    },
  };
  const errors = validateAgainstSchema(schema, doc);
  assertEquals(errors, []);
});

Deno.test("error-response: missing error field is rejected", async () => {
  const schema = await loadSchema("error-response.v1.json");
  const doc = { message: "Unauthorized" };
  const errors = validateAgainstSchema(schema, doc);
  assertEquals(errors.some((e) => e.includes("error")), true);
});

// ─── gatekeeper-policy.v1.json ────────────────────────────────────────────────

Deno.test("gatekeeper-policy: schema examples array is present and non-empty", async () => {
  const schema = await loadSchema("gatekeeper-policy.v1.json");
  const examples = schema.examples;
  assertExists(examples);
  assertEquals(Array.isArray(examples), true);
  assertEquals(examples.length > 0, true);
});

Deno.test("gatekeeper-policy: first schema example passes validation", async () => {
  const schema = await loadSchema("gatekeeper-policy.v1.json");
  const firstExample = schema.examples[0];
  const errors = validateAgainstSchema(schema, firstExample);
  assertEquals(errors, [], `First example failed: ${JSON.stringify(errors)}`);
});

Deno.test("gatekeeper-policy: missing requiredPredicates is rejected", async () => {
  const schema = await loadSchema("gatekeeper-policy.v1.json");
  const doc = {
    version: 1,
    allowedSigners: ["sha256:0000000000000000000000000000000000000000000000000000000000000000"],
    logQuorum: 1,
  };
  const errors = validateAgainstSchema(schema, doc);
  assertEquals(errors.some((e) => e.includes("requiredPredicates")), true);
});

Deno.test("gatekeeper-policy: version must be 1 (enum check)", async () => {
  const schema = await loadSchema("gatekeeper-policy.v1.json");
  const doc = {
    version: 2,
    requiredPredicates: ["https://slsa.dev/provenance/v1"],
    allowedSigners: ["sha256:0000000000000000000000000000000000000000000000000000000000000000"],
    logQuorum: 1,
  };
  const errors = validateAgainstSchema(schema, doc);
  assertEquals(errors.some((e) => e.includes("version")), true);
});

Deno.test("gatekeeper-policy: logQuorum minimum 1 enforced", async () => {
  const schema = await loadSchema("gatekeeper-policy.v1.json");
  const doc = {
    version: 1,
    requiredPredicates: ["https://slsa.dev/provenance/v1"],
    allowedSigners: ["sha256:0000000000000000000000000000000000000000000000000000000000000000"],
    logQuorum: 0,
  };
  const errors = validateAgainstSchema(schema, doc);
  assertEquals(errors.some((e) => e.includes("logQuorum")), true);
});

// ─── container-info.v1.json ───────────────────────────────────────────────────

Deno.test("container-info: valid document passes", async () => {
  const schema = await loadSchema("container-info.v1.json");
  const doc = {
    id: "a".repeat(64),
    name: "my-container",
    image_id: "docker.io/library/alpine:3.18",
    state: "running",
    created_at: "2026-01-01T00:00:00Z",
  };
  const errors = validateAgainstSchema(schema, doc);
  assertEquals(errors, []);
});

Deno.test("container-info: missing id is rejected", async () => {
  const schema = await loadSchema("container-info.v1.json");
  const doc = {
    name: "my-container",
    image_id: "alpine",
    state: "running",
    created_at: "2026-01-01T00:00:00Z",
  };
  const errors = validateAgainstSchema(schema, doc);
  assertEquals(errors.some((e) => e.includes("id")), true);
});

Deno.test("container-info: state enum is enforced", async () => {
  const schema = await loadSchema("container-info.v1.json");
  const doc = {
    id: "a".repeat(64),
    name: "my-container",
    image_id: "alpine:latest",
    state: "exploded",
    created_at: "2026-01-01T00:00:00Z",
  };
  const errors = validateAgainstSchema(schema, doc);
  assertEquals(errors.some((e) => e.includes("state")), true);
});

// ─── Schema count guard ───────────────────────────────────────────────────────

Deno.test("schemas: at least 7 schema files exist in spec/schemas/ (count guard)", async () => {
  const entries = [];
  for await (const entry of Deno.readDir(SCHEMAS_DIR)) {
    if (entry.isFile && entry.name.endsWith(".json")) {
      entries.push(entry.name);
    }
  }
  assertEquals(
    entries.length >= 7,
    true,
    `Expected at least 7 schema files, found ${entries.length}: ${entries.join(", ")}`,
  );
});
