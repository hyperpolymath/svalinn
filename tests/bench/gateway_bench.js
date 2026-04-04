// SPDX-License-Identifier: PMPL-1.0-or-later
/**
 * Gateway Benchmarks for Svalinn
 *
 * Baselines performance of the three main hot-paths in the security gateway:
 *   1. JWT decode + structural validation latency.
 *   2. Policy evaluation throughput (decisions / second).
 *   3. End-to-end HTTP request pipeline latency (in-process Hono handler).
 *   4. Registry extraction utility throughput.
 *
 * Run with:
 *   deno bench --allow-read --allow-net tests/bench/gateway_bench.js
 *
 * All benchmarks use in-process implementations — no network I/O, no external
 * dependencies. Results are comparable across runs given similar machine load.
 *
 * Author: Jonathan D.A. Jewell <6759885+hyperpolymath@users.noreply.github.com>
 */

// @ts-nocheck
import { Hono } from "jsr:@hono/hono@^4";

// ─── Shared helpers ───────────────────────────────────────────────────────────

/**
 * Encode a string to base64url (URL-safe, no padding).
 *
 * @param {string} str
 * @returns {string}
 */
function b64url(str) {
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Construct a structurally valid (but mock-signed) JWT token.
 * Used to drive JWT parsing benchmarks without real cryptography.
 *
 * @param {string} sub - Subject claim
 * @param {number} expOffsetSecs - Seconds from now until expiry
 * @returns {string}
 */
function makeToken(sub = "bench-user", expOffsetSecs = 3600) {
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT", kid: "bench-key" }));
  const now = Math.floor(Date.now() / 1000);
  const payload = b64url(
    JSON.stringify({
      sub,
      iss: "https://auth.example.com",
      aud: "svalinn",
      exp: now + expOffsetSecs,
      iat: now,
    }),
  );
  return `${header}.${payload}.benchmark-signature`;
}

/**
 * Parse and structurally validate a JWT token.
 * Matches Jwt.decodeJwt logic from src/auth/Jwt.res.
 *
 * @param {string} token
 * @returns {{ header: object, payload: object }}
 */
function decodeJwt(token) {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Invalid JWT format");

  const decodePart = (p) => {
    const base64 = p.replace(/-/g, "+").replace(/_/g, "/");
    const mod4 = base64.length % 4;
    const padded = mod4 > 0 ? base64 + "=".repeat(4 - mod4) : base64;
    return JSON.parse(atob(padded));
  };

  return {
    header: decodePart(parts[0]),
    payload: decodePart(parts[1]),
  };
}

// ─── Policy evaluator (mirrors PolicyEvaluator.res) ──────────────────────────

/**
 * Extract registry hostname from an image reference.
 * Matches PolicyEvaluator.Helpers.extractRegistry.
 *
 * @param {string} image
 * @returns {string}
 */
function extractRegistry(image) {
  const parts = image.split("/");
  if (parts.length === 1) return "docker.io";
  const first = parts[0];
  return (first.includes(".") || first.includes(":")) ? first : "docker.io";
}

/**
 * Glob pattern matching — matches PolicyEvaluator.Helpers.matchGlob.
 *
 * @param {string} pattern
 * @param {string} value
 * @returns {boolean}
 */
function matchGlob(pattern, value) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const regexStr = escaped.replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${regexStr}$`).test(value);
}

/**
 * Evaluate an image + privilege request against a policy.
 *
 * @param {string} image - Image reference
 * @param {boolean} privileged - Privileged request flag
 * @param {string[]} allowList - Registry allow list
 * @param {string[]} denyList - Registry deny list
 * @returns {{ allowed: boolean, violations: Array<object>, appliedPolicy: string, evaluatedAt: string }}
 */
function evaluatePolicy(image, privileged, allowList, denyList) {
  const violations = [];
  const registry = extractRegistry(image);

  if (denyList.length > 0 && denyList.some((d) => matchGlob(d, registry))) {
    violations.push({
      rule: "registries.deny",
      severity: "critical",
      message: `Registry '${registry}' is in the deny list`,
    });
  }

  if (allowList.length > 0 && !allowList.some((a) => matchGlob(a, registry))) {
    violations.push({
      rule: "registries.allow",
      severity: "critical",
      message: `Registry '${registry}' is not in the allow list`,
    });
  }

  if (privileged) {
    violations.push({
      rule: "security.allowPrivileged",
      severity: "critical",
      message: "Privileged containers are not allowed",
    });
  }

  const hasCritical = violations.some((v) => v.severity === "critical");
  return {
    allowed: !hasCritical,
    violations,
    appliedPolicy: "bench-policy",
    evaluatedAt: String(Date.now()),
  };
}

// ─── In-process Hono app ──────────────────────────────────────────────────────

/**
 * Build the benchmark Hono app with auth middleware and run handler.
 * Matches the production gateway structure without external dependencies.
 *
 * @returns {Hono}
 */
function buildBenchApp() {
  const app = new Hono();

  // Auth middleware
  app.use("/api/*", async (c, next) => {
    const auth = c.req.header("Authorization") ?? "";
    if (!auth.startsWith("Bearer ")) {
      return c.json(
        { error: { code: 401, id: "ERR_UNAUTHENTICATED", message: "No token" } },
        401,
      );
    }
    const token = auth.slice(7);
    const parts = token.split(".");
    if (parts.length !== 3) {
      return c.json(
        { error: { code: 401, id: "ERR_TOKEN_INVALID", message: "Malformed token" } },
        401,
      );
    }
    try {
      const raw = parts[1].replace(/-/g, "+").replace(/_/g, "/");
      const payload = JSON.parse(atob(raw));
      const now = Math.floor(Date.now() / 1000);
      if (typeof payload.exp === "number" && payload.exp < now) {
        return c.json(
          { error: { code: 401, id: "ERR_TOKEN_EXPIRED", message: "Token expired" } },
          401,
        );
      }
    } catch {
      return c.json(
        { error: { code: 401, id: "ERR_TOKEN_INVALID", message: "Parse error" } },
        401,
      );
    }
    await next();
  });

  // Run handler
  app.post("/api/v1/run", async (c) => {
    const body = await c.req.json();
    const imageName = body.imageName;
    const privileged = body.privileged === true;
    const result = evaluatePolicy(
      imageName, privileged,
      ["docker.io", "ghcr.io"],
      ["evil.registry.com"],
    );
    if (!result.allowed) {
      return c.json(
        {
          error: {
            code: 403,
            id: "ERR_POLICY_DENIED",
            message: "Policy denied",
            details: { violations: result.violations },
          },
        },
        403,
      );
    }
    return c.json(
      {
        id: "bench-container",
        state: "created",
        image_id: imageName,
        name: "bench",
        created_at: new Date().toISOString(),
      },
      201,
    );
  });

  return app;
}

// ─── Bench fixtures ───────────────────────────────────────────────────────────

const VALID_TOKEN = makeToken();
const EXPIRED_TOKEN = makeToken("expired-user", -3600);
const ALLOW_IMAGES = [
  "docker.io/library/alpine:3.18",
  "ghcr.io/hyperpolymath/app:1.0",
  "alpine:latest",
];
const DENY_IMAGES = [
  "evil.registry.com/malware:latest",
  "unknown.example.com/app:1.0",
];

// ─── Benchmark 1: JWT decode latency ─────────────────────────────────────────

Deno.bench({
  name: "JWT decode: valid token (3-part structural parse)",
  group: "jwt",
  baseline: true,
  fn() {
    decodeJwt(VALID_TOKEN);
  },
});

Deno.bench({
  name: "JWT decode: expired token (still valid structure)",
  group: "jwt",
  fn() {
    decodeJwt(EXPIRED_TOKEN);
  },
});

Deno.bench({
  name: "JWT decode: token generation (makeToken overhead)",
  group: "jwt",
  fn() {
    makeToken("bench-user-" + Math.random().toString(36).slice(2));
  },
});

// ─── Benchmark 2: Policy evaluation throughput ───────────────────────────────

Deno.bench({
  name: "policy eval: allowed image (docker.io, no violations)",
  group: "policy",
  baseline: true,
  fn() {
    evaluatePolicy(ALLOW_IMAGES[0], false, ["docker.io", "ghcr.io"], []);
  },
});

Deno.bench({
  name: "policy eval: denied registry (evil.registry.com)",
  group: "policy",
  fn() {
    evaluatePolicy(DENY_IMAGES[0], false, ["docker.io", "ghcr.io"], ["evil.registry.com"]);
  },
});

Deno.bench({
  name: "policy eval: privileged flag rejection",
  group: "policy",
  fn() {
    evaluatePolicy(ALLOW_IMAGES[0], true, ["docker.io"], []);
  },
});

Deno.bench({
  name: "policy eval: multiple violations (registry deny + privileged)",
  group: "policy",
  fn() {
    evaluatePolicy(DENY_IMAGES[0], true, ["docker.io"], ["evil.registry.com"]);
  },
});

Deno.bench({
  name: "policy eval: wildcard allow list (*)",
  group: "policy",
  fn() {
    evaluatePolicy(ALLOW_IMAGES[2], false, ["*"], []);
  },
});

Deno.bench({
  name: "policy eval: batch 100 decisions (throughput)",
  group: "policy",
  fn() {
    for (let i = 0; i < 100; i++) {
      const image = i % 3 === 0 ? DENY_IMAGES[0] : ALLOW_IMAGES[i % ALLOW_IMAGES.length];
      evaluatePolicy(image, i % 5 === 0, ["docker.io", "ghcr.io"], ["evil.registry.com"]);
    }
  },
});

// ─── Benchmark 3: E2E HTTP pipeline ──────────────────────────────────────────

const benchApp = buildBenchApp();
const RUN_URL = "http://localhost/api/v1/run";

Deno.bench({
  name: "E2E pipeline: allowed request (auth + policy + response)",
  group: "e2e",
  baseline: true,
  async fn() {
    const req = new Request(RUN_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${VALID_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        imageName: "docker.io/library/alpine:3.18",
        imageDigest: "sha256:abcdef",
      }),
    });
    const res = await benchApp.fetch(req);
    await res.arrayBuffer(); // consume body
  },
});

Deno.bench({
  name: "E2E pipeline: denied request (policy reject path)",
  group: "e2e",
  async fn() {
    const req = new Request(RUN_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${VALID_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        imageName: "evil.registry.com/malware:latest",
        imageDigest: "sha256:abc",
      }),
    });
    const res = await benchApp.fetch(req);
    await res.arrayBuffer();
  },
});

Deno.bench({
  name: "E2E pipeline: unauthenticated request (auth reject path)",
  group: "e2e",
  async fn() {
    const req = new Request(RUN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageName: "docker.io/x:1", imageDigest: "sha256:abc" }),
    });
    const res = await benchApp.fetch(req);
    await res.arrayBuffer();
  },
});

Deno.bench({
  name: "E2E pipeline: expired token (auth reject path)",
  group: "e2e",
  async fn() {
    const req = new Request(RUN_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${EXPIRED_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ imageName: "docker.io/x:1", imageDigest: "sha256:abc" }),
    });
    const res = await benchApp.fetch(req);
    await res.arrayBuffer();
  },
});

// ─── Benchmark 4: Registry extraction utility ─────────────────────────────────

Deno.bench({
  name: "registry extract: bare image name → docker.io",
  group: "util",
  baseline: true,
  fn() {
    extractRegistry("alpine:3.18");
  },
});

Deno.bench({
  name: "registry extract: fully qualified image with hostname",
  group: "util",
  fn() {
    extractRegistry("ghcr.io/hyperpolymath/svalinn:latest");
  },
});

Deno.bench({
  name: "registry extract: localhost with port",
  group: "util",
  fn() {
    extractRegistry("localhost:5000/myapp:dev");
  },
});
