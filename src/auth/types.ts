// SPDX-License-Identifier: PMPL-1.0-or-later
// Authentication types for Svalinn

/**
 * Authentication method types
 */
export type AuthMethod = "oauth2" | "oidc" | "api-key" | "mtls" | "none";

/**
 * OAuth2 configuration
 */
export interface OAuth2Config {
  clientId: string;
  clientSecret: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  redirectUri: string;
  scopes: string[];
}

/**
 * OIDC configuration (extends OAuth2)
 */
export interface OIDCConfig extends OAuth2Config {
  issuer: string;
  userInfoEndpoint: string;
  jwksUri: string;
  endSessionEndpoint?: string;
}

/**
 * API key configuration
 */
export interface ApiKeyConfig {
  header: string;
  prefix?: string;
  keys: Map<string, ApiKeyInfo>;
}

/**
 * API key information
 */
export interface ApiKeyInfo {
  id: string;
  name: string;
  scopes: string[];
  createdAt: string;
  expiresAt?: string;
  rateLimit?: number;
}

/**
 * mTLS configuration
 */
export interface MTLSConfig {
  caCert: string;
  requireClientCert: boolean;
  verifyDepth: number;
}

/**
 * Authentication configuration
 */
export interface AuthConfig {
  enabled: boolean;
  methods: AuthMethod[];
  oauth2?: OAuth2Config;
  oidc?: OIDCConfig;
  apiKey?: ApiKeyConfig;
  mtls?: MTLSConfig;
  excludePaths: string[];
}

/**
 * Token payload (decoded JWT)
 */
export interface TokenPayload {
  sub: string;
  iss: string;
  aud: string | string[];
  exp: number;
  iat: number;
  scope?: string;
  email?: string;
  name?: string;
  groups?: string[];
  [key: string]: unknown;
}

/**
 * Authentication result
 */
export interface AuthResult {
  authenticated: boolean;
  method: AuthMethod;
  subject?: string;
  scopes?: string[];
  token?: TokenPayload;
  error?: string;
}

/**
 * User context attached to requests
 */
export interface UserContext {
  id: string;
  email?: string;
  name?: string;
  groups: string[];
  scopes: string[];
  method: AuthMethod;
  issuedAt: number;
  expiresAt?: number;
}

/**
 * Authorization check result
 */
export interface AuthzResult {
  allowed: boolean;
  reason?: string;
  requiredScopes?: string[];
  missingScopes?: string[];
}

/**
 * RBAC role definition
 */
export interface Role {
  name: string;
  permissions: Permission[];
  description?: string;
}

/**
 * Permission definition
 */
export interface Permission {
  resource: string;
  actions: ("create" | "read" | "update" | "delete" | "execute")[];
}

/**
 * Default roles
 */
export const defaultRoles: Role[] = [
  {
    name: "admin",
    description: "Full access to all resources",
    permissions: [
      { resource: "*", actions: ["create", "read", "update", "delete", "execute"] },
    ],
  },
  {
    name: "operator",
    description: "Can manage containers but not policies",
    permissions: [
      { resource: "containers", actions: ["create", "read", "update", "delete", "execute"] },
      { resource: "images", actions: ["read"] },
      { resource: "policies", actions: ["read"] },
    ],
  },
  {
    name: "viewer",
    description: "Read-only access",
    permissions: [
      { resource: "containers", actions: ["read"] },
      { resource: "images", actions: ["read"] },
      { resource: "policies", actions: ["read"] },
    ],
  },
  {
    name: "auditor",
    description: "Can view logs and audit trail",
    permissions: [
      { resource: "containers", actions: ["read"] },
      { resource: "logs", actions: ["read"] },
      { resource: "audit", actions: ["read"] },
    ],
  },
];

/**
 * Default scopes
 */
export const defaultScopes = {
  "svalinn:read": "Read access to Svalinn resources",
  "svalinn:write": "Write access to Svalinn resources",
  "svalinn:admin": "Administrative access",
  "containers:create": "Create containers",
  "containers:read": "View containers",
  "containers:delete": "Delete containers",
  "images:verify": "Verify images",
  "policies:manage": "Manage policies",
};
