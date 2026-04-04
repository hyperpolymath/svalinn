// SPDX-License-Identifier: PMPL-1.0-or-later
/**
 * Authentication Tests for Svalinn
 * Fully ported to ReScript v12
 */

open AuthTypes
open Jwt
open OAuth2

module Assert = {
  @module("jsr:@std/assert@1") external assertEquals: ('a, 'a) => unit = "assertEquals"
  @module("jsr:@std/assert@1") external assertExists: 'a => unit = "assertExists"
}

module Deno = {
  @val @scope("Deno") external test: (string, unit => promise<unit>) => unit = "test"
  @val @scope("Deno") external testSync: (string, unit => unit) => unit = "test"
}

@val external btoa: string => string = "btoa"

// === Type Tests ===

Deno.testSync("defaultRoles contains expected roles", () => {
  Assert.assertEquals(Array.length(defaultRoles), 3)

  let roleNames = defaultRoles->Array.map(r => r.name)
  Assert.assertEquals(roleNames->Array.includes("admin"), true)
  Assert.assertEquals(roleNames->Array.includes("operator"), true)
  Assert.assertEquals(roleNames->Array.includes("viewer"), true)
})

Deno.testSync("admin role has wildcard permissions", () => {
  let adminRole = defaultRoles->Array.find(r => r.name == "admin")
  Assert.assertExists(adminRole)
  switch adminRole {
  | Some(role) => Assert.assertEquals(role.permissions->Array.some(p => p.resource == "*"), true)
  | None => ()
  }
})

// === JWT Tests ===

Deno.testSync("decodeJwt parses valid JWT", () => {
  let headerObj = {"alg": "RS256", "typ": "JWT"}
  let header = btoa(JSON.stringify(Obj.magic(headerObj)))
  
  let payloadObj = {
    "sub": "user123",
    "iss": "https://auth.example.com",
    "aud": "svalinn",
    "exp": Date.now() /. 1000.0 +. 3600.0,
    "iat": Date.now() /. 1000.0,
  }
  let payload = btoa(JSON.stringify(Obj.magic(payloadObj)))
  
  let signature = "test-signature"
  let token = `${header}.${payload}.${signature}`

  let decoded = Jwt.decodeJwt(token)
  let decodedHeader = decoded["header"]
  let decodedPayload: AuthTypes.Types.tokenPayload = %raw(`decoded.payload`)

  Assert.assertEquals(%raw(`decodedHeader.alg`), "RS256")
  Assert.assertEquals(decodedPayload.sub, "user123")
  Assert.assertEquals(decodedPayload.iss, "https://auth.example.com")
})

// === OAuth2 Tests ===

Deno.testSync("generateState creates random string", () => {
  let state1 = generateState()
  let state2 = generateState()

  Assert.assertEquals(String.length(state1), 64)
  Assert.assertEquals(String.length(state2), 64)
  Assert.assertEquals(state1 != state2, true)
})

Deno.testSync("getAuthorizationUrl generates correct URL", () => {
  let config: AuthTypes.Types.oidcConfig = {
    issuer: "https://auth.example.com",
    clientId: "test-client",
    clientSecret: "secret",
    userInfoEndpoint: "https://auth.example.com/userinfo",
    jwksUri: "https://auth.example.com/.well-known/jwks.json",
    authorizationEndpoint: "https://auth.example.com/authorize",
    tokenEndpoint: "https://auth.example.com/token",
    redirectUri: "https://svalinn.example.com/callback",
    scopes: ["openid", "profile", "email"],
  }

  let url = getAuthorizationUrl((config :> AuthTypes.Types.oauth2Config), "test-state", ~nonce="test-nonce")

  Assert.assertEquals(String.includes(url, "response_type=code"), true)
  Assert.assertEquals(String.includes(url, "client_id=test-client"), true)
  Assert.assertEquals(String.includes(url, "state=test-state"), true)
  Assert.assertEquals(String.includes(url, "nonce=test-nonce"), true)
  Assert.assertEquals(String.includes(url, "scope=openid+profile+email"), true)
})
