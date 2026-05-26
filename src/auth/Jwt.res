// SPDX-License-Identifier: MPL-2.0
// JWT verification for Svalinn
// Fully ported to ReScript v12

module Types = {
  type jwk = {
    kty: string,
    use: option<string>,
    alg: option<string>,
    kid: string,
    n: option<string>,
    e: option<string>,
    x: option<string>,
    y: option<string>,
    crv: option<string>,
  }

  type jwks = {keys: array<jwk>}

  type cachedJwks = {
    jwks: jwks,
    expiresAt: float,
  }

  type oidcConfig = {
    issuer: string,
    clientId: string,
    jwksUri: string,
  }

  type tokenPayload = {
    iss: string,
    sub: string,
    aud: JSON.t, // Can be string or array
    exp: option<float>,
    iat: option<float>,
  }
}

// Web Crypto API bindings
module Crypto = {
  type cryptoKey
  module Subtle = {
    @val @scope(("crypto", "subtle"))
    external importKey: (JSON.t, JSON.t, JSON.t, bool, array<string>) => promise<cryptoKey> =
      "importKey"

    @val @scope(("crypto", "subtle"))
    external verify: (JSON.t, cryptoKey, Uint8Array.t, Uint8Array.t) => promise<bool> = "verify"
  }
}

// TextEncoder for building the signing-input bytes.
type textEncoder
@new external makeTextEncoder: unit => textEncoder = "TextEncoder"
@send external textEncoderEncode: (textEncoder, string) => Uint8Array.t = "encode"

@val external atob: string => string = "atob"

let jwksCache: Map.t<string, Types.cachedJwks> = Map.make()
let jwksCacheTtl = 3600000.0 // 1 hour

let fetchJwks = async (jwksUri: string): Types.jwks => {
  let now = Date.now()
  switch Map.get(jwksCache, jwksUri) {
  | Some(cached) if cached.expiresAt > now => cached.jwks
  | _ => {
      let response = await Fetch.fetch(jwksUri, {"method": #GET})
      if !Fetch.Response.ok(response) {
        failwith(`Failed to fetch JWKS: ${Int.toString(Fetch.Response.status(response))}`)
      }
      let jwks: Types.jwks = %raw("await response.json()")
      Map.set(jwksCache, jwksUri, {jwks, expiresAt: now +. jwksCacheTtl})
      jwks
    }
  }
}

// Base64url-decode a string into a Uint8Array.
let base64UrlDecode = (str: string): Uint8Array.t => {
  let base64 = str
    ->String.replaceRegExp(%re("/-/g"), "+")
    ->String.replaceRegExp(%re("/_/g"), "/")
  let mod4 = mod(String.length(base64), 4)
  let padding = if mod4 > 0 {
    String.repeat("=", 4 - mod4)
  } else {
    ""
  }
  let binary = atob(base64 ++ padding)
  let len = String.length(binary)
  let bytes = Uint8Array.fromLength(len)
  %raw(`(function() { for (var i = 0; i < len; i++) { bytes[i] = binary.charCodeAt(i); } })()`)
  bytes
}

// Result of decoding a JWT without verifying.
// Carries the raw base64url segments so verifyJwt can reconstruct the signing
// input.
type decoded = {
  headerB64: string,
  payloadB64: string,
  signatureB64: string,
  header: JSON.t,
  payload: JSON.t,
}

let decodeJwt = (token: string): decoded => {
  let parts = String.split(token, ".")
  if Array.length(parts) != 3 {
    failwith("Invalid JWT format")
  }
  let headerB64 = Array.getUnsafe(parts, 0)
  let payloadB64 = Array.getUnsafe(parts, 1)
  let signatureB64 = Array.getUnsafe(parts, 2)

  let decodePart = (p: string): JSON.t => {
    p
    ->String.replaceRegExp(%re("/-/g"), "+")
    ->String.replaceRegExp(%re("/_/g"), "/")
    ->atob
    ->JSON.parseExn
  }

  {
    headerB64,
    payloadB64,
    signatureB64,
    header: decodePart(headerB64),
    payload: decodePart(payloadB64),
  }
}

// Map a JWT `alg` to a (importKey-algorithm, verify-algorithm) pair.
// 'none' and any unrecognised algorithm are rejected.
let algToWebCrypto = (alg: string): result<(JSON.t, JSON.t), string> => {
  switch alg {
  | "none" => Error("Algorithm 'none' is rejected for security reasons")
  | "RS256" =>
    Ok((
      %raw(`{name: "RSASSA-PKCS1-v1_5", hash: "SHA-256"}`),
      %raw(`{name: "RSASSA-PKCS1-v1_5"}`),
    ))
  | "RS384" =>
    Ok((
      %raw(`{name: "RSASSA-PKCS1-v1_5", hash: "SHA-384"}`),
      %raw(`{name: "RSASSA-PKCS1-v1_5"}`),
    ))
  | "RS512" =>
    Ok((
      %raw(`{name: "RSASSA-PKCS1-v1_5", hash: "SHA-512"}`),
      %raw(`{name: "RSASSA-PKCS1-v1_5"}`),
    ))
  | "PS256" =>
    Ok((
      %raw(`{name: "RSA-PSS", hash: "SHA-256"}`),
      %raw(`{name: "RSA-PSS", saltLength: 32}`),
    ))
  | "PS384" =>
    Ok((
      %raw(`{name: "RSA-PSS", hash: "SHA-384"}`),
      %raw(`{name: "RSA-PSS", saltLength: 48}`),
    ))
  | "PS512" =>
    Ok((
      %raw(`{name: "RSA-PSS", hash: "SHA-512"}`),
      %raw(`{name: "RSA-PSS", saltLength: 64}`),
    ))
  | "ES256" =>
    Ok((
      %raw(`{name: "ECDSA", namedCurve: "P-256", hash: "SHA-256"}`),
      %raw(`{name: "ECDSA", hash: "SHA-256"}`),
    ))
  | "ES384" =>
    Ok((
      %raw(`{name: "ECDSA", namedCurve: "P-384", hash: "SHA-384"}`),
      %raw(`{name: "ECDSA", hash: "SHA-384"}`),
    ))
  | "ES512" =>
    Ok((
      %raw(`{name: "ECDSA", namedCurve: "P-521", hash: "SHA-512"}`),
      %raw(`{name: "ECDSA", hash: "SHA-512"}`),
    ))
  | "EdDSA" => Ok((%raw(`{name: "Ed25519"}`), %raw(`{name: "Ed25519"}`)))
  | other => Error(`Unsupported JWT algorithm: ${other}`)
  }
}

// Verify a JWT against the JWKS at `config.jwksUri`. Throws on:
//   - malformed token
//   - 'none' alg or unsupported alg
//   - exp in the past
//   - issuer mismatch
//   - kid not found in JWKS
//   - JWK→CryptoKey import failure
//   - SIGNATURE INVALID (the central guarantee)
//
// Returns the payload only when the signature is valid.
let verifyJwt = async (token: string, config: Types.oidcConfig): Types.tokenPayload => {
  let decoded = decodeJwt(token)

  let alg: string = %raw(`decoded.header.alg`)
  let kid: string = %raw(`decoded.header.kid`)

  // Map alg first so we reject 'none' / unsupported BEFORE doing any other work.
  let (importAlg, verifyAlg) = switch algToWebCrypto(alg) {
  | Ok(pair) => pair
  | Error(msg) => failwith(msg)
  }

  let payload: Types.tokenPayload = %raw(`decoded.payload`)

  let now = Date.now() /. 1000.0
  switch payload.exp {
  | Some(exp) if exp < now => failwith("Token expired")
  | _ => ()
  }

  if payload.iss != config.issuer {
    failwith(`Invalid issuer: expected ${config.issuer}, got ${payload.iss}`)
  }

  let jwks = await fetchJwks(config.jwksUri)
  let keyOpt = jwks.keys->Array.find(k => k.kid == kid)
  let jwk = switch keyOpt {
  | None => failwith(`Key not found: ${kid}`)
  | Some(j) => j
  }

  // Import the JWK as a CryptoKey usable for verification only.
  let jwkJson: JSON.t = Obj.magic(jwk)
  let formatJwk: JSON.t = %raw(`"jwk"`)
  let cryptoKey = await Crypto.Subtle.importKey(formatJwk, jwkJson, importAlg, false, ["verify"])

  // Build the signing input: "<headerB64>.<payloadB64>" as UTF-8 bytes.
  let signingInput =
    makeTextEncoder()->textEncoderEncode(decoded.headerB64 ++ "." ++ decoded.payloadB64)

  // Base64url-decode the signature segment.
  let signatureBytes = base64UrlDecode(decoded.signatureB64)

  // The central check.
  let ok = await Crypto.Subtle.verify(verifyAlg, cryptoKey, signatureBytes, signingInput)
  if !ok {
    failwith("JWT signature verification failed")
  }

  payload
}
