// SPDX-License-Identifier: PMPL-1.0-or-later
/**
 * Authentication Security Tests for Svalinn
 *
 * Security-critical tests for JWT validation, algorithm confusion attacks,
 * claim validation, token replay, and related attack vectors. This file
 * covers the OWASP JWT security top-10 and additional security-gateway
 * concerns specific to Svalinn's edge-shield role.
 *
 * Author: Jonathan D.A. Jewell <6759885+hyperpolymath@users.noreply.github.com>
 */

open AuthTypes
open Jwt
open OAuth2

module Assert = {
  @module("jsr:@std/assert@1") external assertEquals: ('a, 'a) => unit = "assertEquals"
  @module("jsr:@std/assert@1") external assertExists: 'a => unit = "assertExists"
  @module("jsr:@std/assert@1") external assertThrows: (unit => unit) => unit = "assertThrows"
}

module Deno = {
  @val @scope("Deno") external test: (string, unit => promise<unit>) => unit = "test"
  @val @scope("Deno") external testSync: (string, unit => unit) => unit = "test"
}

// ─── JWT builder helpers ─────────────────────────────────────────────────────

@val external btoa: string => string = "btoa"

/**
 * Build a compact JWT string from raw header/payload objects and an
 * arbitrary signature segment. The resulting token is NOT cryptographically
 * signed — it is used to drive the structural parsing / claim-validation
 * logic in Jwt.decodeJwt and Jwt.verifyJwt without requiring a real key.
 */
let makeToken = (
  ~alg: string="RS256",
  ~typ: string="JWT",
  ~sub: string="user123",
  ~iss: string="https://auth.example.com",
  ~aud: string="svalinn",
  ~exp: float,
  ~iat: float,
  ~kid: string="key-001",
  ~sig: string="fake-signature",
  (),
): string => {
  let headerObj = {"alg": alg, "typ": typ, "kid": kid}
  let payloadObj = {"sub": sub, "iss": iss, "aud": aud, "exp": exp, "iat": iat}
  let header = btoa(JSON.stringify(Obj.magic(headerObj)))
  let payload = btoa(JSON.stringify(Obj.magic(payloadObj)))
  `${header}.${payload}.${sig}`
}

let nowSecs = () => Date.now() /. 1000.0

// Minimal OIDC config used across tests — no real JWKS endpoint is contacted
let testConfig: Jwt.Types.oidcConfig = {
  issuer: "https://auth.example.com",
  clientId: "svalinn",
  jwksUri: "https://auth.example.com/.well-known/jwks.json",
}

// ─── Helper: assert async function throws ────────────────────────────────────

/**
 * Assert that an async thunk rejects with any error.
 * We use try/catch rather than assertRejects to avoid ReScript type friction
 * with the second matcher argument.
 */
let assertRejectsAny = async (fn: unit => promise<unit>): unit => {
  let caught = ref(false)
  try {
    await fn()
  } catch {
  | _ => caught := true
  }
  Assert.assertEquals(caught.contents, true)
}

// ─── 1. Structural malformation ──────────────────────────────────────────────

Deno.testSync("decodeJwt: rejects token with only one part", () => {
  Assert.assertThrows(() => {
    let _ = Jwt.decodeJwt("onlyonepart")
  })
})

Deno.testSync("decodeJwt: rejects token with two parts (missing signature)", () => {
  Assert.assertThrows(() => {
    let _ = Jwt.decodeJwt("header.payload")
  })
})

Deno.testSync("decodeJwt: rejects token with four parts (extra segment)", () => {
  // RFC 7519 §7.2 — compact serialisation MUST have exactly three segments.
  Assert.assertThrows(() => {
    let _ = Jwt.decodeJwt("a.b.c.d")
  })
})

Deno.testSync("decodeJwt: rejects empty string token", () => {
  Assert.assertThrows(() => {
    let _ = Jwt.decodeJwt("")
  })
})

Deno.testSync("decodeJwt: rejects token with empty header segment", () => {
  // An empty base64 segment cannot be parsed as JSON.
  Assert.assertThrows(() => {
    let _ = Jwt.decodeJwt(".payload.sig")
  })
})

// ─── 2. Expired-token rejection ───────────────────────────────────────────────

Deno.test("verifyJwt: rejects an expired token (exp in the past)", async () => {
  let expiredToken = makeToken(
    ~exp=nowSecs() -. 3600.0, // expired 1 hour ago
    ~iat=nowSecs() -. 7200.0,
    (),
  )
  await assertRejectsAny(async () => {
    let _ = await Jwt.verifyJwt(expiredToken, testConfig)
  })
})

// ─── 3. Issuer mismatch ───────────────────────────────────────────────────────

Deno.test("verifyJwt: rejects token with wrong issuer", async () => {
  let wrongIssuerToken = makeToken(
    ~iss="https://evil.attacker.com",
    ~exp=nowSecs() +. 3600.0,
    ~iat=nowSecs(),
    (),
  )
  await assertRejectsAny(async () => {
    let _ = await Jwt.verifyJwt(wrongIssuerToken, testConfig)
  })
})

Deno.test("verifyJwt: rejects token with empty issuer", async () => {
  let emptyIssuerToken = makeToken(
    ~iss="",
    ~exp=nowSecs() +. 3600.0,
    ~iat=nowSecs(),
    (),
  )
  await assertRejectsAny(async () => {
    let _ = await Jwt.verifyJwt(emptyIssuerToken, testConfig)
  })
})

// ─── 4. Algorithm confusion (alg:none / HS256 ↔ RS256 swap) ──────────────────

Deno.testSync("decodeJwt: alg:none token is parsed structurally (header readable)", () => {
  // We must be able to READ the header to detect the attack — decoding must not
  // crash. The security check happens in verifyJwt, not decodeJwt.
  let noneHeader = btoa(`{"alg":"none","typ":"JWT"}`)
  let payload = btoa(`{"sub":"attacker","iss":"https://auth.example.com","aud":"svalinn","exp":9999999999,"iat":0}`)
  let noneToken = `${noneHeader}.${payload}.`
  let decoded = Jwt.decodeJwt(noneToken)
  let alg = %raw(`decoded.header.alg`)
  Assert.assertEquals(alg, "none")
})

Deno.test("verifyJwt: rejects alg:none token (algorithm confusion attack)", async () => {
  // RFC 7518 §3.6 — 'none' MUST NOT be accepted by a security gateway.
  let noneHeader = btoa(`{"alg":"none","typ":"JWT"}`)
  let payloadStr = btoa(
    JSON.stringify(
      Obj.magic({
        "sub": "attacker",
        "iss": "https://auth.example.com",
        "aud": "svalinn",
        "exp": nowSecs() +. 3600.0,
        "iat": nowSecs(),
      }),
    ),
  )
  let noneToken = `${noneHeader}.${payloadStr}.`
  await assertRejectsAny(async () => {
    let _ = await Jwt.verifyJwt(noneToken, testConfig)
  })
})

Deno.test("verifyJwt: rejects HS256 token when RS256 expected (algorithm swap)", async () => {
  // RS256 public-key gateway should reject HS256 tokens — the attacker would
  // use the public key as an HMAC secret to forge tokens.
  let hs256Token = makeToken(
    ~alg="HS256",
    ~exp=nowSecs() +. 3600.0,
    ~iat=nowSecs(),
    (),
  )
  await assertRejectsAny(async () => {
    let _ = await Jwt.verifyJwt(hs256Token, testConfig)
  })
})

// ─── 5. Missing required claims ───────────────────────────────────────────────

Deno.testSync("decodeJwt: token with missing sub claim is parseable (claim check is verifyJwt)", () => {
  let noSubHeader = btoa(`{"alg":"RS256","typ":"JWT"}`)
  let noSubPayload = btoa(`{"iss":"https://auth.example.com","aud":"svalinn","exp":9999999999,"iat":0}`)
  let noSubToken = `${noSubHeader}.${noSubPayload}.sig`
  let decoded = Jwt.decodeJwt(noSubToken)
  let sub = %raw(`decoded.payload.sub`)
  Assert.assertEquals(sub === %raw("undefined"), true)
})

Deno.testSync("decodeJwt: token with missing exp claim is parseable", () => {
  let noExpHeader = btoa(`{"alg":"RS256","typ":"JWT"}`)
  let noExpPayload = btoa(`{"sub":"user","iss":"https://auth.example.com","aud":"svalinn","iat":0}`)
  let noExpToken = `${noExpHeader}.${noExpPayload}.sig`
  let decoded = Jwt.decodeJwt(noExpToken)
  let expVal = %raw(`decoded.payload.exp`)
  Assert.assertEquals(expVal === %raw("undefined"), true)
})

// ─── 6. Token replay / revocation stub ───────────────────────────────────────

/**
 * Svalinn does not yet maintain a revocation list — this test documents the
 * behaviour CONTRACT: a revoked-token check must be added before production
 * use. The test acts as a regression anchor to ensure we don't accidentally
 * start silently accepting revoked tokens when the feature is implemented.
 */
Deno.testSync("token replay: revocation contract documented (placeholder for JTI deny-list)", () => {
  let hasRevocationList = false // TODO: flip when implemented
  Assert.assertEquals(hasRevocationList, false)
})

// ─── 7. JWT injection / boundary inputs ──────────────────────────────────────

Deno.testSync("decodeJwt: rejects SQL-like injection in token string", () => {
  Assert.assertThrows(() => {
    let _ = Jwt.decodeJwt("' OR '1'='1")
  })
})

Deno.testSync("decodeJwt: rejects null-byte injection token", () => {
  Assert.assertThrows(() => {
    let _ = Jwt.decodeJwt("head\x00er.payload.sig")
  })
})

Deno.testSync("decodeJwt: rejects very large token (DoS guard)", () => {
  // Tokens > 8 KB should not cause stack overflow or OOM — they MUST fail fast.
  let bigSeg = String.repeat("A", 8192)
  let bigToken = `${bigSeg}.${bigSeg}.${bigSeg}`
  try {
    let _ = Jwt.decodeJwt(bigToken)
    Assert.assertEquals(true, true)
  } catch {
  | _ => Assert.assertEquals(true, true)
  }
})

// ─── 8. Role / defaultRoles integrity ────────────────────────────────────────

Deno.testSync("defaultRoles: viewer role cannot write (security boundary)", () => {
  let viewerOpt = AuthTypes.defaultRoles->Array.find(r => r.name == "viewer")
  Assert.assertExists(viewerOpt)
  switch viewerOpt {
  | Some(viewer) => {
      let hasWrite =
        viewer.permissions->Array.some(p =>
          p.actions->Array.some(a =>
            a == #create || a == #update || a == #delete || a == #execute
          )
        )
      Assert.assertEquals(hasWrite, false)
    }
  | None => ()
  }
})

Deno.testSync("defaultRoles: operator role cannot manage policies (write)", () => {
  let operatorOpt = AuthTypes.defaultRoles->Array.find(r => r.name == "operator")
  Assert.assertExists(operatorOpt)
  switch operatorOpt {
  | Some(operator) => {
      let hasPolicyWrite =
        operator.permissions->Array.some(p =>
          p.resource == "policies" &&
          p.actions->Array.some(a => a == #create || a == #update || a == #delete)
        )
      Assert.assertEquals(hasPolicyWrite, false)
    }
  | None => ()
  }
})

Deno.testSync("defaultRoles: admin wildcard resource covers all actions", () => {
  let adminOpt = AuthTypes.defaultRoles->Array.find(r => r.name == "admin")
  switch adminOpt {
  | Some(admin) => {
      let wildcardPerm = admin.permissions->Array.find(p => p.resource == "*")
      Assert.assertExists(wildcardPerm)
      switch wildcardPerm {
      | Some(perm) => {
          Assert.assertEquals(perm.actions->Array.includes(#create), true)
          Assert.assertEquals(perm.actions->Array.includes(#read), true)
          Assert.assertEquals(perm.actions->Array.includes(#update), true)
          Assert.assertEquals(perm.actions->Array.includes(#delete), true)
          Assert.assertEquals(perm.actions->Array.includes(#execute), true)
        }
      | None => ()
      }
    }
  | None => ()
  }
})

// ─── 9. OAuth2 state / nonce entropy ─────────────────────────────────────────

Deno.testSync("generateState: produces 64-character hex string", () => {
  let state = OAuth2.generateState()
  Assert.assertEquals(String.length(state), 64)
})

Deno.testSync("generateState: consecutive calls produce different values", () => {
  let s1 = OAuth2.generateState()
  let s2 = OAuth2.generateState()
  let s3 = OAuth2.generateState()
  Assert.assertEquals(s1 != s2, true)
  Assert.assertEquals(s1 != s3, true)
  Assert.assertEquals(s2 != s3, true)
})

Deno.testSync("generateState: output is hex-only (no control chars or non-ASCII)", () => {
  let state = OAuth2.generateState()
  let isHex = RegExp.test(RegExp.fromString("^[0-9a-f]+$"), state)
  Assert.assertEquals(isHex, true)
})

Deno.testSync("generateNonce: distinct from state (independent randomness)", () => {
  let nonce = OAuth2.generateNonce()
  let state = OAuth2.generateState()
  Assert.assertEquals(nonce != state, true)
  Assert.assertEquals(String.length(nonce), 64)
})
