// SPDX-License-Identifier: PMPL-1.0-or-later
// JWT verification for Svalinn

import type { TokenPayload, OIDCConfig } from "./types.ts";

/**
 * JWKS key
 */
interface JWK {
  kty: string;
  use?: string;
  alg?: string;
  kid: string;
  n?: string;
  e?: string;
  x?: string;
  y?: string;
  crv?: string;
}

/**
 * JWKS response
 */
interface JWKS {
  keys: JWK[];
}

/**
 * Cached JWKS with expiry
 */
interface CachedJWKS {
  jwks: JWKS;
  expiresAt: number;
}

// JWKS cache
const jwksCache = new Map<string, CachedJWKS>();
const JWKS_CACHE_TTL = 3600000; // 1 hour

/**
 * Fetch JWKS from issuer
 */
export async function fetchJWKS(jwksUri: string): Promise<JWKS> {
  // Check cache
  const cached = jwksCache.get(jwksUri);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.jwks;
  }

  // Fetch JWKS
  const response = await fetch(jwksUri);
  if (!response.ok) {
    throw new Error(`Failed to fetch JWKS: ${response.status}`);
  }

  const jwks = await response.json() as JWKS;

  // Cache
  jwksCache.set(jwksUri, {
    jwks,
    expiresAt: Date.now() + JWKS_CACHE_TTL,
  });

  return jwks;
}

/**
 * Decode JWT without verification (for header inspection)
 */
export function decodeJWT(token: string): { header: Record<string, unknown>; payload: TokenPayload } {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new Error("Invalid JWT format");
  }

  const header = JSON.parse(atob(parts[0].replace(/-/g, "+").replace(/_/g, "/")));
  const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));

  return { header, payload };
}

/**
 * Verify JWT signature using Web Crypto API
 */
export async function verifyJWT(
  token: string,
  config: OIDCConfig
): Promise<TokenPayload> {
  const { header, payload } = decodeJWT(token);

  // Validate basic claims
  const now = Math.floor(Date.now() / 1000);

  if (payload.exp && payload.exp < now) {
    throw new Error("Token expired");
  }

  if (payload.iat && payload.iat > now + 60) {
    throw new Error("Token issued in the future");
  }

  if (payload.iss !== config.issuer) {
    throw new Error(`Invalid issuer: expected ${config.issuer}, got ${payload.iss}`);
  }

  // Validate audience
  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!audiences.includes(config.clientId)) {
    throw new Error(`Invalid audience: ${payload.aud}`);
  }

  // Fetch JWKS and verify signature
  const jwks = await fetchJWKS(config.jwksUri);
  const kid = header.kid as string;
  const key = jwks.keys.find((k) => k.kid === kid);

  if (!key) {
    throw new Error(`Key not found: ${kid}`);
  }

  // Import key and verify
  const cryptoKey = await importJWK(key, header.alg as string);
  const valid = await verifySignature(token, cryptoKey);

  if (!valid) {
    throw new Error("Invalid signature");
  }

  return payload;
}

/**
 * Import JWK to CryptoKey
 */
async function importJWK(jwk: JWK, alg: string): Promise<CryptoKey> {
  const algorithm = getAlgorithm(alg);

  return await crypto.subtle.importKey(
    "jwk",
    jwk as JsonWebKey,
    algorithm,
    true,
    ["verify"]
  );
}

/**
 * Get algorithm parameters from alg string
 */
function getAlgorithm(alg: string): RsaHashedImportParams | EcKeyImportParams {
  switch (alg) {
    case "RS256":
      return { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" };
    case "RS384":
      return { name: "RSASSA-PKCS1-v1_5", hash: "SHA-384" };
    case "RS512":
      return { name: "RSASSA-PKCS1-v1_5", hash: "SHA-512" };
    case "ES256":
      return { name: "ECDSA", namedCurve: "P-256" };
    case "ES384":
      return { name: "ECDSA", namedCurve: "P-384" };
    case "ES512":
      return { name: "ECDSA", namedCurve: "P-521" };
    default:
      throw new Error(`Unsupported algorithm: ${alg}`);
  }
}

/**
 * Verify JWT signature
 */
async function verifySignature(token: string, key: CryptoKey): Promise<boolean> {
  const parts = token.split(".");
  const data = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  const signature = base64UrlDecode(parts[2]);

  const algorithm = key.algorithm.name === "ECDSA"
    ? { name: "ECDSA", hash: getECDSAHash(key) }
    : key.algorithm;

  return await crypto.subtle.verify(
    algorithm,
    key,
    signature.buffer as ArrayBuffer,
    data.buffer as ArrayBuffer
  );
}

/**
 * Get ECDSA hash algorithm from key
 */
function getECDSAHash(key: CryptoKey): string {
  const algo = key.algorithm as EcKeyAlgorithm;
  switch (algo.namedCurve) {
    case "P-256":
      return "SHA-256";
    case "P-384":
      return "SHA-384";
    case "P-521":
      return "SHA-512";
    default:
      return "SHA-256";
  }
}

/**
 * Base64 URL decode
 */
function base64UrlDecode(str: string): Uint8Array {
  const base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(base64 + padding);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Discover OIDC configuration from issuer
 */
export async function discoverOIDC(issuer: string): Promise<Partial<OIDCConfig>> {
  const wellKnown = `${issuer.replace(/\/$/, "")}/.well-known/openid-configuration`;

  const response = await fetch(wellKnown);
  if (!response.ok) {
    throw new Error(`OIDC discovery failed: ${response.status}`);
  }

  const config = await response.json();

  return {
    issuer: config.issuer,
    authorizationEndpoint: config.authorization_endpoint,
    tokenEndpoint: config.token_endpoint,
    userInfoEndpoint: config.userinfo_endpoint,
    jwksUri: config.jwks_uri,
    endSessionEndpoint: config.end_session_endpoint,
  };
}
