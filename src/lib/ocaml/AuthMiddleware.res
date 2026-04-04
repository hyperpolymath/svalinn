// SPDX-License-Identifier: PMPL-1.0-or-later
/**
 * Authentication Middleware for Svalinn
 * Fully ported to ReScript v12
 */

open AuthTypes
open Jwt
open OAuth2

module Hono = {
  type context
  type next = unit => promise<unit>
  @send external set: (context, string, 'a) => unit = "set"
  @send external get: (context, string) => 'a = "get"
  @send external json: (context, JSON.t, int) => promise<unit> = "json"
  @send external header: (context, string) => option<string> = "req.header"
}

let authenticateBearerToken = async (c: Hono.context, config: AuthTypes.Types.authConfig): AuthTypes.Types.authResult => {
  let auth = c->Hono.header("Authorization")
  switch auth {
  | Some(a) if String.startsWith(a, "Bearer ") => {
      let token = String.substring(a, ~start=7, ~end=String.length(a))
      try {
        let payload = switch config.oidc {
        | Some(oidc) => await Jwt.verifyJwt(token, (oidc :> Jwt.Types.oidcConfig))
        | None => {
            let decoded = Jwt.decodeJwt(token)
            %raw(`decoded.payload`)
          }
        }
        {
          authenticated: true,
          method: #oidc,
          subject: %raw("payload.sub"),
          scopes: %raw("payload.scope")->Option.map(s => String.split(s, " "))->Option.getOr([]),
          token: Obj.magic(payload),
        }
      } catch {
      | _ => {authenticated: false, method: #oidc, error: "Token verification failed"}
      }
    }
  | _ => {authenticated: false, method: #oidc, error: "No bearer token provided"}
  }
}

let authMiddleware = (config: AuthTypes.Types.authConfig) => {
  async (c: Hono.context, next: Hono.next) => {
    if !config.enabled {
      await next()
    } else {
      let result: ref<AuthTypes.Types.authResult> = ref({
        AuthTypes.Types.authenticated: false,
        method: #none,
        error: "No authentication provided",
      })

      for i in 0 to Array.length(config.methods) - 1 {
        let method = Belt.Array.getExn(config.methods, i)
        let res = switch method {
        | #oidc | #oauth2 => await authenticateBearerToken(c, config)
        | #none => {authenticated: true, method: #none}
        | _ => {authenticated: false, method: #none, error: "Method not implemented"}
        }
        
        if res.authenticated {
          result := res
        }
      }

      c->Hono.set("authResult", result.contents)

      if !result.contents.authenticated {
        await c->Hono.json(
          Obj.magic({"error": "Unauthorized", "message": result.contents.error}),
          401,
        )
      } else {
        await next()
      }
    }
  }
}
