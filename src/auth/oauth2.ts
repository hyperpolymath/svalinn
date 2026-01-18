// SPDX-License-Identifier: PMPL-1.0-or-later
// OAuth2 flow handlers for Svalinn

import type { Context } from "npm:hono@4";
import type { OAuth2Config, OIDCConfig } from "./types.ts";

/**
 * Token response from OAuth2 token endpoint
 */
export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  id_token?: string;
}

/**
 * Generate authorization URL
 */
export function getAuthorizationUrl(
  config: OAuth2Config | OIDCConfig,
  state: string,
  nonce?: string
): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: config.scopes.join(" "),
    state,
  });

  // Add nonce for OIDC
  if (nonce) {
    params.set("nonce", nonce);
  }

  return `${config.authorizationEndpoint}?${params.toString()}`;
}

/**
 * Exchange authorization code for tokens
 */
export async function exchangeCode(
  config: OAuth2Config,
  code: string
): Promise<TokenResponse> {
  const params = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: config.redirectUri,
    client_id: config.clientId,
    client_secret: config.clientSecret,
  });

  const response = await fetch(config.tokenEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Token exchange failed: ${error}`);
  }

  return await response.json();
}

/**
 * Refresh access token
 */
export async function refreshToken(
  config: OAuth2Config,
  refreshToken: string
): Promise<TokenResponse> {
  const params = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: config.clientId,
    client_secret: config.clientSecret,
  });

  const response = await fetch(config.tokenEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Token refresh failed: ${error}`);
  }

  return await response.json();
}

/**
 * Get user info from OIDC provider
 */
export async function getUserInfo(
  config: OIDCConfig,
  accessToken: string
): Promise<Record<string, unknown>> {
  const response = await fetch(config.userInfoEndpoint, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`User info request failed: ${error}`);
  }

  return await response.json();
}

/**
 * Logout (end OIDC session)
 */
export function getLogoutUrl(
  config: OIDCConfig,
  idToken: string,
  postLogoutRedirectUri: string
): string | null {
  if (!config.endSessionEndpoint) {
    return null;
  }

  const params = new URLSearchParams({
    id_token_hint: idToken,
    post_logout_redirect_uri: postLogoutRedirectUri,
  });

  return `${config.endSessionEndpoint}?${params.toString()}`;
}

/**
 * Generate secure random state
 */
export function generateState(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Generate secure nonce for OIDC
 */
export function generateNonce(): string {
  return generateState();
}

/**
 * OAuth2 callback handler
 */
export async function handleCallback(
  c: Context,
  config: OAuth2Config | OIDCConfig,
  expectedState: string
): Promise<TokenResponse> {
  const code = c.req.query("code");
  const state = c.req.query("state");
  const error = c.req.query("error");

  if (error) {
    const description = c.req.query("error_description") || error;
    throw new Error(`OAuth error: ${description}`);
  }

  if (!code) {
    throw new Error("No authorization code received");
  }

  if (state !== expectedState) {
    throw new Error("Invalid state parameter");
  }

  return await exchangeCode(config, code);
}

/**
 * Client credentials flow (machine-to-machine)
 */
export async function clientCredentials(
  config: OAuth2Config,
  scopes?: string[]
): Promise<TokenResponse> {
  const params = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: config.clientId,
    client_secret: config.clientSecret,
  });

  if (scopes) {
    params.set("scope", scopes.join(" "));
  }

  const response = await fetch(config.tokenEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Client credentials flow failed: ${error}`);
  }

  return await response.json();
}

/**
 * Token introspection (RFC 7662)
 */
export async function introspectToken(
  introspectionEndpoint: string,
  token: string,
  clientId: string,
  clientSecret: string
): Promise<Record<string, unknown>> {
  const params = new URLSearchParams({
    token,
  });

  const auth = btoa(`${clientId}:${clientSecret}`);

  const response = await fetch(introspectionEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${auth}`,
    },
    body: params.toString(),
  });

  if (!response.ok) {
    throw new Error(`Token introspection failed: ${response.status}`);
  }

  return await response.json();
}

/**
 * Token revocation (RFC 7009)
 */
export async function revokeToken(
  revocationEndpoint: string,
  token: string,
  clientId: string,
  clientSecret: string,
  tokenTypeHint?: "access_token" | "refresh_token"
): Promise<void> {
  const params = new URLSearchParams({
    token,
  });

  if (tokenTypeHint) {
    params.set("token_type_hint", tokenTypeHint);
  }

  const auth = btoa(`${clientId}:${clientSecret}`);

  const response = await fetch(revocationEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${auth}`,
    },
    body: params.toString(),
  });

  if (!response.ok) {
    throw new Error(`Token revocation failed: ${response.status}`);
  }
}
