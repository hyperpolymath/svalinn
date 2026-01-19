// SPDX-License-Identifier: PMPL-1.0-or-later
// Authentication tests

import { assertEquals, assertExists } from "jsr:@std/assert@1";
import type { ApiKeyInfo, OIDCConfig, Role, TokenPayload } from "../auth/types.ts";
import { createAuthConfig } from "../auth/middleware.ts";
import { decodeJWT, discoverOIDC } from "../auth/jwt.ts";
import { generateNonce, generateState, getAuthorizationUrl } from "../auth/oauth2.ts";
import { defaultRoles, defaultScopes } from "../auth/types.ts";

// === Type Tests ===

Deno.test("AuthConfig has required fields", () => {
  const config = createAuthConfig();

  assertExists(config.enabled);
  assertExists(config.methods);
  assertExists(config.excludePaths);
});

Deno.test("defaultRoles contains expected roles", () => {
  assertEquals(defaultRoles.length, 4);

  const roleNames = defaultRoles.map((r) => r.name);
  assertEquals(roleNames.includes("admin"), true);
  assertEquals(roleNames.includes("operator"), true);
  assertEquals(roleNames.includes("viewer"), true);
  assertEquals(roleNames.includes("auditor"), true);
});

Deno.test("admin role has wildcard permissions", () => {
  const adminRole = defaultRoles.find((r) => r.name === "admin");
  assertExists(adminRole);
  assertEquals(adminRole!.permissions.some((p) => p.resource === "*"), true);
});

Deno.test("viewer role is read-only", () => {
  const viewerRole = defaultRoles.find((r) => r.name === "viewer");
  assertExists(viewerRole);

  for (const perm of viewerRole!.permissions) {
    assertEquals(perm.actions.every((a) => a === "read"), true);
  }
});

Deno.test("defaultScopes has container scopes", () => {
  assertExists(defaultScopes["containers:create"]);
  assertExists(defaultScopes["containers:read"]);
  assertExists(defaultScopes["containers:delete"]);
});

// === JWT Tests ===

Deno.test("decodeJWT parses valid JWT", () => {
  // Test JWT (not signed, just for parsing)
  const header = btoa(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = btoa(
    JSON.stringify({
      sub: "user123",
      iss: "https://auth.example.com",
      aud: "svalinn",
      exp: Math.floor(Date.now() / 1000) + 3600,
      iat: Math.floor(Date.now() / 1000),
    }),
  );
  const signature = "test-signature";
  const token = `${header}.${payload}.${signature}`;

  const decoded = decodeJWT(token);

  assertEquals(decoded.header.alg, "RS256");
  assertEquals(decoded.payload.sub, "user123");
  assertEquals(decoded.payload.iss, "https://auth.example.com");
});

Deno.test("decodeJWT throws on invalid format", () => {
  try {
    decodeJWT("not-a-valid-jwt");
    assertEquals(true, false, "Should have thrown");
  } catch (e) {
    assertEquals((e as Error).message, "Invalid JWT format");
  }
});

// === OAuth2 Tests ===

Deno.test("generateState creates random string", () => {
  const state1 = generateState();
  const state2 = generateState();

  assertEquals(state1.length, 64);
  assertEquals(state2.length, 64);
  assertEquals(state1 !== state2, true);
});

Deno.test("generateNonce creates random string", () => {
  const nonce = generateNonce();
  assertEquals(nonce.length, 64);
});

Deno.test("getAuthorizationUrl generates correct URL", () => {
  const config: OIDCConfig = {
    issuer: "https://auth.example.com",
    clientId: "test-client",
    clientSecret: "secret",
    authorizationEndpoint: "https://auth.example.com/authorize",
    tokenEndpoint: "https://auth.example.com/token",
    userInfoEndpoint: "https://auth.example.com/userinfo",
    jwksUri: "https://auth.example.com/.well-known/jwks.json",
    redirectUri: "https://svalinn.example.com/callback",
    scopes: ["openid", "profile", "email"],
  };

  const url = getAuthorizationUrl(config, "test-state", "test-nonce");

  assertEquals(url.includes("response_type=code"), true);
  assertEquals(url.includes("client_id=test-client"), true);
  assertEquals(url.includes("state=test-state"), true);
  assertEquals(url.includes("nonce=test-nonce"), true);
  assertEquals(url.includes("scope=openid+profile+email"), true);
});

// === Middleware Tests ===

Deno.test("createAuthConfig sets defaults", () => {
  const config = createAuthConfig();

  assertEquals(config.enabled, false);
  assertEquals(config.methods, ["oidc", "api-key"]);
  assertEquals(config.excludePaths.includes("/healthz"), true);
  assertEquals(config.excludePaths.includes("/metrics"), true);
});

Deno.test("createAuthConfig respects overrides", () => {
  const config = createAuthConfig({
    enabled: true,
    methods: ["api-key"],
    excludePaths: ["/custom"],
  });

  assertEquals(config.enabled, true);
  assertEquals(config.methods, ["api-key"]);
  assertEquals(config.excludePaths, ["/custom"]);
});

Deno.test("API key config has required fields", () => {
  const config = createAuthConfig();

  assertExists(config.apiKey);
  assertEquals(config.apiKey!.header, "X-API-Key");
  assertExists(config.apiKey!.keys);
});

// === API Key Tests ===

Deno.test("API key info structure", () => {
  const keyInfo: ApiKeyInfo = {
    id: "key-001",
    name: "Test Key",
    scopes: ["svalinn:read", "containers:read"],
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
    rateLimit: 1000,
  };

  assertExists(keyInfo.id);
  assertExists(keyInfo.name);
  assertEquals(keyInfo.scopes.length, 2);
  assertExists(keyInfo.createdAt);
  assertExists(keyInfo.expiresAt);
  assertEquals(keyInfo.rateLimit, 1000);
});

Deno.test("API key without expiry", () => {
  const keyInfo: ApiKeyInfo = {
    id: "key-002",
    name: "Never Expires",
    scopes: ["svalinn:admin"],
    createdAt: new Date().toISOString(),
  };

  assertEquals(keyInfo.expiresAt, undefined);
});

// === Token Payload Tests ===

Deno.test("token payload has required claims", () => {
  const payload: TokenPayload = {
    sub: "user-123",
    iss: "https://auth.example.com",
    aud: "svalinn",
    exp: Math.floor(Date.now() / 1000) + 3600,
    iat: Math.floor(Date.now() / 1000),
  };

  assertExists(payload.sub);
  assertExists(payload.iss);
  assertExists(payload.aud);
  assertExists(payload.exp);
  assertExists(payload.iat);
});

Deno.test("token payload supports optional claims", () => {
  const payload: TokenPayload = {
    sub: "user-123",
    iss: "https://auth.example.com",
    aud: ["svalinn", "vordr"],
    exp: Math.floor(Date.now() / 1000) + 3600,
    iat: Math.floor(Date.now() / 1000),
    scope: "openid profile email",
    email: "user@example.com",
    name: "Test User",
    groups: ["developers", "admins"],
  };

  assertEquals(Array.isArray(payload.aud), true);
  assertEquals(payload.scope, "openid profile email");
  assertEquals(payload.email, "user@example.com");
  assertEquals(payload.groups?.length, 2);
});

// === Role Tests ===

Deno.test("role structure is correct", () => {
  const role: Role = {
    name: "custom-role",
    description: "Custom test role",
    permissions: [
      { resource: "containers", actions: ["read", "create"] },
      { resource: "images", actions: ["read"] },
    ],
  };

  assertEquals(role.name, "custom-role");
  assertEquals(role.permissions.length, 2);
  assertEquals(role.permissions[0].actions.includes("read"), true);
  assertEquals(role.permissions[0].actions.includes("create"), true);
});

// === OIDC Discovery Tests (Integration) ===

Deno.test({
  name: "OIDC discovery fetches well-known config",
  ignore: true, // Requires network access to real OIDC provider
  fn: async () => {
    // Example: Google's OIDC discovery
    const config = await discoverOIDC("https://accounts.google.com");

    assertExists(config.issuer);
    assertExists(config.authorizationEndpoint);
    assertExists(config.tokenEndpoint);
    assertExists(config.jwksUri);
  },
});

// === Exclude Paths Tests ===

Deno.test("health endpoints are excluded by default", () => {
  const config = createAuthConfig();

  const excludedPaths = config.excludePaths;
  assertEquals(excludedPaths.includes("/healthz"), true);
  assertEquals(excludedPaths.includes("/health"), true);
  assertEquals(excludedPaths.includes("/ready"), true);
  assertEquals(excludedPaths.includes("/metrics"), true);
  assertEquals(excludedPaths.some((p) => p.includes("well-known")), true);
});

// === Auth Method Priority Tests ===

Deno.test("auth methods can be configured in order", () => {
  const config1 = createAuthConfig({ methods: ["oidc", "api-key"] });
  const config2 = createAuthConfig({ methods: ["api-key", "oidc"] });
  const config3 = createAuthConfig({ methods: ["mtls", "oidc", "api-key"] });

  assertEquals(config1.methods[0], "oidc");
  assertEquals(config2.methods[0], "api-key");
  assertEquals(config3.methods[0], "mtls");
});

// === Scope Checks Tests ===

Deno.test("scopes can be checked for containment", () => {
  const userScopes = ["svalinn:read", "containers:read", "containers:create"];

  const hasRead = userScopes.includes("svalinn:read");
  const hasAdmin = userScopes.includes("svalinn:admin");
  const hasContainerCreate = userScopes.includes("containers:create");

  assertEquals(hasRead, true);
  assertEquals(hasAdmin, false);
  assertEquals(hasContainerCreate, true);
});

Deno.test("admin scope grants all permissions", () => {
  const userScopes = ["svalinn:admin"];

  // Check if admin or specific scope
  const canRead = userScopes.includes("svalinn:read") ||
    userScopes.includes("svalinn:admin");
  const canWrite = userScopes.includes("svalinn:write") ||
    userScopes.includes("svalinn:admin");

  assertEquals(canRead, true);
  assertEquals(canWrite, true);
});
