// SPDX-License-Identifier: PMPL-1.0-or-later
/**
 * Authentication Types for Svalinn
 * Fully ported to ReScript v12
 */

module Types = {
  type authMethod = [ #oauth2 | #oidc | #"api-key" | #mtls | #none ]

  type oauth2Config = {
    clientId: string,
    clientSecret: string,
    authorizationEndpoint: string,
    tokenEndpoint: string,
    redirectUri: string,
    scopes: array<string>,
  }

  type oidcConfig = {
    issuer: string,
    clientId: string,
    clientSecret: string,
    authorizationEndpoint: string,
    tokenEndpoint: string,
    userInfoEndpoint: string,
    jwksUri: string,
    redirectUri: string,
    scopes: array<string>,
    endSessionEndpoint?: string,
  }

  type apiKeyInfo = {
    id: string,
    name: string,
    scopes: array<string>,
    createdAt: string,
    expiresAt?: string,
    rateLimit?: int,
  }

  type apiKeyConfig = {
    header: string,
    prefix?: string,
    keys: Map.t<string, apiKeyInfo>,
  }

  type mtlsConfig = {
    caCert: string,
    requireClientCert: bool,
    verifyDepth: int,
  }

  type authConfig = {
    enabled: bool,
    methods: array<authMethod>,
    oauth2?: oauth2Config,
    oidc?: oidcConfig,
    apiKey?: apiKeyConfig,
    mtls?: mtlsConfig,
    excludePaths: array<string>,
  }

  type tokenPayload = {
    sub: string,
    iss: string,
    aud: JSON.t,
    exp: float,
    iat: float,
    scope?: string,
    email?: string,
    name?: string,
    groups?: array<string>,
  }

  type authResult = {
    authenticated: bool,
    method: authMethod,
    subject?: string,
    scopes?: array<string>,
    token?: tokenPayload,
    error?: string,
  }

  type userContext = {
    id: string,
    email?: string,
    name?: string,
    groups: array<string>,
    scopes: array<string>,
    method: authMethod,
    issuedAt: float,
    expiresAt?: float,
  }

  type action = [ #create | #read | #update | #delete | #execute ]

  type permission = {
    resource: string,
    actions: array<action>,
  }

  type role = {
    name: string,
    permissions: array<permission>,
    description?: string,
  }
}

let defaultRoles: array<Types.role> = [
  {
    name: "admin",
    description: "Full access to all resources",
    permissions: [{resource: "*", actions: [#create, #read, #update, #delete, #execute]}],
  },
  {
    name: "operator",
    description: "Can manage containers but not policies",
    permissions: [
      {resource: "containers", actions: [#create, #read, #update, #delete, #execute]},
      {resource: "images", actions: [#read]},
      {resource: "policies", actions: [#read]},
    ],
  },
  {
    name: "viewer",
    description: "Read-only access",
    permissions: [
      {resource: "containers", actions: [#read]},
      {resource: "images", actions: [#read]},
      {resource: "policies", actions: [#read]},
    ],
  },
]
