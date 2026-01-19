// SPDX-License-Identifier: PMPL-1.0-or-later
// Authentication middleware for Svalinn

import type { Context, Next } from "npm:hono@4";
import type { AuthConfig, AuthMethod, AuthResult, TokenPayload, UserContext } from "./types.ts";
import { decodeJWT, verifyJWT } from "./jwt.ts";

/**
 * Extended context with user info
 */
declare module "npm:hono@4" {
  interface ContextVariableMap {
    user: UserContext;
    authResult: AuthResult;
  }
}

/**
 * Create authentication middleware
 */
export function authMiddleware(config: AuthConfig) {
  return async (c: Context, next: Next) => {
    // Skip if auth disabled
    if (!config.enabled) {
      await next();
      return;
    }

    // Check excluded paths
    const path = new URL(c.req.url).pathname;
    if (config.excludePaths.some((p) => path.startsWith(p))) {
      await next();
      return;
    }

    // Try authentication methods in order
    let result: AuthResult = {
      authenticated: false,
      method: "none",
      error: "No authentication provided",
    };

    for (const method of config.methods) {
      result = await tryAuthenticate(c, config, method);
      if (result.authenticated) {
        break;
      }
    }

    // Store result
    c.set("authResult", result);

    if (!result.authenticated) {
      return c.json(
        {
          error: "Unauthorized",
          message: result.error,
        },
        401,
      );
    }

    // Create user context
    const user: UserContext = {
      id: result.subject || "anonymous",
      email: result.token?.email as string | undefined,
      name: result.token?.name as string | undefined,
      groups: (result.token?.groups as string[]) || [],
      scopes: result.scopes || [],
      method: result.method,
      issuedAt: result.token?.iat || Date.now() / 1000,
      expiresAt: result.token?.exp,
    };

    c.set("user", user);

    await next();
  };
}

/**
 * Try a specific authentication method
 */
async function tryAuthenticate(
  c: Context,
  config: AuthConfig,
  method: AuthMethod,
): Promise<AuthResult> {
  switch (method) {
    case "oauth2":
    case "oidc":
      return await authenticateBearerToken(c, config);
    case "api-key":
      return authenticateApiKey(c, config);
    case "mtls":
      return authenticateMTLS(c);
    case "none":
      return { authenticated: true, method: "none" };
    default:
      return { authenticated: false, method: "none", error: "Unknown method" };
  }
}

/**
 * Authenticate via Bearer token (OAuth2/OIDC)
 */
async function authenticateBearerToken(
  c: Context,
  config: AuthConfig,
): Promise<AuthResult> {
  const auth = c.req.header("Authorization");
  if (!auth || !auth.startsWith("Bearer ")) {
    return {
      authenticated: false,
      method: "oidc",
      error: "No bearer token provided",
    };
  }

  const token = auth.substring(7);

  try {
    let payload: TokenPayload;

    if (config.oidc) {
      // Full OIDC verification
      payload = await verifyJWT(token, config.oidc);
    } else {
      // Basic decode (for dev/testing)
      const decoded = decodeJWT(token);
      payload = decoded.payload;
    }

    // Extract scopes
    const scopes = payload.scope ? payload.scope.split(" ") : [];

    return {
      authenticated: true,
      method: "oidc",
      subject: payload.sub,
      scopes,
      token: payload,
    };
  } catch (e) {
    return {
      authenticated: false,
      method: "oidc",
      error: `Token verification failed: ${(e as Error).message}`,
    };
  }
}

/**
 * Authenticate via API key
 */
function authenticateApiKey(
  c: Context,
  config: AuthConfig,
): AuthResult {
  if (!config.apiKey) {
    return {
      authenticated: false,
      method: "api-key",
      error: "API key auth not configured",
    };
  }

  const header = config.apiKey.header || "X-API-Key";
  const apiKey = c.req.header(header);

  if (!apiKey) {
    return {
      authenticated: false,
      method: "api-key",
      error: `No API key in ${header} header`,
    };
  }

  // Remove prefix if configured
  let key = apiKey;
  if (config.apiKey.prefix && apiKey.startsWith(config.apiKey.prefix)) {
    key = apiKey.substring(config.apiKey.prefix.length);
  }

  // Look up key
  const keyInfo = config.apiKey.keys.get(key);
  if (!keyInfo) {
    return {
      authenticated: false,
      method: "api-key",
      error: "Invalid API key",
    };
  }

  // Check expiry
  if (keyInfo.expiresAt && new Date(keyInfo.expiresAt) < new Date()) {
    return {
      authenticated: false,
      method: "api-key",
      error: "API key expired",
    };
  }

  return {
    authenticated: true,
    method: "api-key",
    subject: keyInfo.id,
    scopes: keyInfo.scopes,
    token: {
      sub: keyInfo.id,
      iss: "svalinn",
      aud: "svalinn",
      exp: keyInfo.expiresAt ? new Date(keyInfo.expiresAt).getTime() / 1000 : 0,
      iat: new Date(keyInfo.createdAt).getTime() / 1000,
      name: keyInfo.name,
    },
  };
}

/**
 * Authenticate via mTLS client certificate
 */
function authenticateMTLS(c: Context): AuthResult {
  // Client certificate info would be set by reverse proxy
  const clientCert = c.req.header("X-Client-Cert-DN");
  const clientCertVerify = c.req.header("X-Client-Cert-Verify");

  if (!clientCert || clientCertVerify !== "SUCCESS") {
    return {
      authenticated: false,
      method: "mtls",
      error: "No valid client certificate",
    };
  }

  // Parse CN from DN
  const cnMatch = clientCert.match(/CN=([^,]+)/);
  const subject = cnMatch ? cnMatch[1] : clientCert;

  return {
    authenticated: true,
    method: "mtls",
    subject,
    scopes: ["svalinn:read", "svalinn:write"],
  };
}

/**
 * Require specific scopes middleware
 */
export function requireScopes(...requiredScopes: string[]) {
  return async (c: Context, next: Next) => {
    const user = c.get("user");

    if (!user) {
      return c.json({ error: "Not authenticated" }, 401);
    }

    const missingScopes = requiredScopes.filter(
      (s) => !user.scopes.includes(s) && !user.scopes.includes("svalinn:admin"),
    );

    if (missingScopes.length > 0) {
      return c.json(
        {
          error: "Forbidden",
          message: "Insufficient scopes",
          required: requiredScopes,
          missing: missingScopes,
        },
        403,
      );
    }

    await next();
  };
}

/**
 * Require specific groups middleware
 */
export function requireGroups(...requiredGroups: string[]) {
  return async (c: Context, next: Next) => {
    const user = c.get("user");

    if (!user) {
      return c.json({ error: "Not authenticated" }, 401);
    }

    const hasGroup = requiredGroups.some((g) => user.groups.includes(g));

    if (!hasGroup) {
      return c.json(
        {
          error: "Forbidden",
          message: "Not a member of required groups",
          required: requiredGroups,
        },
        403,
      );
    }

    await next();
  };
}

/**
 * Create default auth config
 */
export function createAuthConfig(options: Partial<AuthConfig> = {}): AuthConfig {
  return {
    enabled: options.enabled ?? false,
    methods: options.methods ?? ["oidc", "api-key"],
    oauth2: options.oauth2,
    oidc: options.oidc,
    apiKey: options.apiKey ?? {
      header: "X-API-Key",
      keys: new Map(),
    },
    mtls: options.mtls,
    excludePaths: options.excludePaths ?? [
      "/healthz",
      "/health",
      "/ready",
      "/metrics",
      "/.well-known/",
    ],
  };
}

/**
 * Load auth config from environment
 */
export function loadAuthConfigFromEnv(): AuthConfig {
  const enabled = Deno.env.get("AUTH_ENABLED") === "true";

  const config = createAuthConfig({
    enabled,
    methods: (Deno.env.get("AUTH_METHODS")?.split(",") as AuthMethod[]) || ["oidc", "api-key"],
  });

  // Load OIDC config
  const oidcIssuer = Deno.env.get("OIDC_ISSUER");
  if (oidcIssuer) {
    config.oidc = {
      issuer: oidcIssuer,
      clientId: Deno.env.get("OIDC_CLIENT_ID") || "",
      clientSecret: Deno.env.get("OIDC_CLIENT_SECRET") || "",
      authorizationEndpoint: Deno.env.get("OIDC_AUTH_ENDPOINT") || "",
      tokenEndpoint: Deno.env.get("OIDC_TOKEN_ENDPOINT") || "",
      userInfoEndpoint: Deno.env.get("OIDC_USERINFO_ENDPOINT") || "",
      jwksUri: Deno.env.get("OIDC_JWKS_URI") || "",
      redirectUri: Deno.env.get("OIDC_REDIRECT_URI") || "",
      scopes: (Deno.env.get("OIDC_SCOPES") || "openid profile email").split(" "),
    };
  }

  // Load API keys from environment (comma-separated id:key:scopes format)
  const apiKeys = Deno.env.get("API_KEYS");
  if (apiKeys) {
    for (const entry of apiKeys.split(",")) {
      const [id, key, scopesStr] = entry.split(":");
      if (id && key) {
        config.apiKey!.keys.set(key, {
          id,
          name: id,
          scopes: scopesStr ? scopesStr.split("+") : ["svalinn:read"],
          createdAt: new Date().toISOString(),
        });
      }
    }
  }

  return config;
}
