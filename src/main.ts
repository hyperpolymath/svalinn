// SPDX-License-Identifier: PMPL-1.0-or-later
// Svalinn Gateway - Main Entry Point

import { Hono } from "@hono/hono";
import { cors } from "@hono/hono/cors";
import { logger } from "@hono/hono/logger";
import AjvModule from "ajv";
import addFormatsModule from "ajv-formats";

// Handle ESM/CJS default export differences
// deno-lint-ignore no-explicit-any
const Ajv = (AjvModule as any).default || AjvModule;
// deno-lint-ignore no-explicit-any
const addFormats = (addFormatsModule as any).default || addFormatsModule;

// Configuration
const config = {
  port: parseInt(Deno.env.get("SVALINN_PORT") || "8000"),
  host: Deno.env.get("SVALINN_HOST") || "0.0.0.0",
  vordrEndpoint: Deno.env.get("VORDR_ENDPOINT") || "http://localhost:8080",
  specVersion: Deno.env.get("SPEC_VERSION") || "v0.1.0",
};

// JSON Schema validator
const ajv = new Ajv({ allErrors: true });
addFormats(ajv);

// Load schemas
const schemaDir = new URL("../spec/schemas/", import.meta.url);
const schemas: Record<string, unknown> = {};

async function loadSchemas() {
  const schemaFiles = [
    "gateway-run-request.v1.json",
    "gateway-verify-request.v1.json",
    "container-info.v1.json",
    "error-response.v1.json",
  ];

  for (const file of schemaFiles) {
    try {
      const schemaPath = new URL(file, schemaDir);
      const schema = JSON.parse(await Deno.readTextFile(schemaPath));
      schemas[file] = schema;
      ajv.addSchema(schema, file);
    } catch {
      console.warn(`Warning: Could not load schema ${file}`);
    }
  }
}

// Validate request against schema
function validateRequest(schemaName: string, data: unknown): { valid: boolean; errors?: unknown[] } {
  const validate = ajv.getSchema(schemaName);
  if (!validate) {
    return { valid: false, errors: [{ message: `Schema ${schemaName} not found` }] };
  }
  const valid = validate(data);
  return { valid: !!valid, errors: validate.errors || undefined };
}

// Vörðr MCP client
async function callVordr(toolName: string, args: unknown): Promise<unknown> {
  const response = await fetch(config.vordrEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "tools/call",
      params: { name: toolName, arguments: args },
      id: Date.now(),
    }),
  });

  const result = await response.json();
  if (result.error) {
    throw new Error(result.error.message);
  }
  return result.result;
}

// Create Hono app
const app = new Hono();

// Middleware
app.use("*", logger());
app.use("*", cors());

// Health check
app.get("/healthz", async (c) => {
  let vordrConnected = false;
  try {
    await fetch(`${config.vordrEndpoint}/health`);
    vordrConnected = true;
  } catch {
    // Vörðr not available
  }

  return c.json({
    status: "healthy",
    version: "0.1.0",
    vordrConnected,
    specVersion: config.specVersion,
    timestamp: new Date().toISOString(),
  });
});

// List containers
app.get("/v1/containers", async (c) => {
  try {
    const result = await callVordr("vordr_container_list", {});
    return c.json({ containers: result });
  } catch (e) {
    return c.json({ containers: [], error: String(e) });
  }
});

// Get container info
app.get("/v1/containers/:id", async (c) => {
  const id = c.req.param("id");
  try {
    const result = await callVordr("vordr_container_inspect", { containerId: id });
    return c.json(result);
  } catch (e) {
    return c.json({ error: String(e) }, 404);
  }
});

// Inspect container
app.get("/v1/containers/:id/inspect", async (c) => {
  const id = c.req.param("id");
  try {
    const result = await callVordr("vordr_container_inspect", { containerId: id });
    return c.json({ id, data: result });
  } catch (e) {
    return c.json({ error: String(e) }, 404);
  }
});

// Run container
app.post("/v1/run", async (c) => {
  const body = await c.req.json();

  // Validate request
  const validation = validateRequest("gateway-run-request.v1.json", body);
  if (!validation.valid) {
    return c.json(
      {
        code: "VALIDATION_ERROR",
        message: "Request validation failed",
        details: validation.errors,
      },
      400
    );
  }

  try {
    // Create container
    const createResult = await callVordr("vordr_container_create", {
      image: body.imageName,
      name: body.name,
      config: {
        privileged: false,
        readOnlyRoot: true,
      },
    });

    // Start container
    const containerId = (createResult as { containerId: string }).containerId;
    await callVordr("vordr_container_start", { containerId });

    return c.json({
      containerId,
      status: "running",
      image: body.imageName,
    });
  } catch (e) {
    return c.json(
      {
        code: "RUN_ERROR",
        message: String(e),
      },
      500
    );
  }
});

// Verify image
app.post("/v1/verify", async (c) => {
  const body = await c.req.json();

  // Validate request
  const validation = validateRequest("gateway-verify-request.v1.json", body);
  if (!validation.valid) {
    return c.json(
      {
        code: "VALIDATION_ERROR",
        message: "Request validation failed",
        details: validation.errors,
      },
      400
    );
  }

  try {
    const result = await callVordr("vordr_verify_image", {
      image: body.imageRef,
      checkSbom: body.checkSbom ?? true,
      checkSignature: body.checkSignature ?? true,
    });
    return c.json(result);
  } catch (e) {
    return c.json(
      {
        code: "VERIFY_ERROR",
        message: String(e),
      },
      500
    );
  }
});

// Stop container
app.post("/v1/containers/:id/stop", async (c) => {
  const id = c.req.param("id");
  try {
    await callVordr("vordr_container_stop", { containerId: id });
    return c.json({ status: "stopped", containerId: id });
  } catch (e) {
    return c.json({ error: String(e) }, 500);
  }
});

// Remove container
app.delete("/v1/containers/:id", async (c) => {
  const id = c.req.param("id");
  try {
    await callVordr("vordr_container_remove", { containerId: id });
    return c.json({ status: "removed", containerId: id });
  } catch (e) {
    return c.json({ error: String(e) }, 500);
  }
});

// List images
app.get("/v1/images", async (c) => {
  try {
    const result = await callVordr("vordr_image_list", {});
    return c.json({ images: result });
  } catch (e) {
    return c.json({ images: [], error: String(e) });
  }
});

// Start server
await loadSchemas();

console.log(`
╔═══════════════════════════════════════════════════════════════╗
║                    Svalinn Edge Shield                         ║
║            Post-Cloud Security Architecture                    ║
╠═══════════════════════════════════════════════════════════════╣
║  Version:    0.1.0                                             ║
║  Port:       ${String(config.port).padEnd(48)}║
║  Vörðr:      ${config.vordrEndpoint.padEnd(48)}║
║  Spec:       ${config.specVersion.padEnd(48)}║
╚═══════════════════════════════════════════════════════════════╝
`);

Deno.serve({ port: config.port, hostname: config.host }, app.fetch);
