// SPDX-License-Identifier: PMPL-1.0-or-later
// OAuth2 flow handlers for Svalinn

open Types

// Token response from OAuth2 token endpoint
type tokenResponse = {
  @as("access_token") accessToken: string,
  @as("token_type") tokenType: string,
  @as("expires_in") expiresIn: int,
  @as("refresh_token") refreshToken: option<string>,
  scope: option<string>,
  @as("id_token") idToken: option<string>,
}

// Generate authorization URL
let getAuthorizationUrl = (
  config: oauth2Config,
  state: string,
  ~nonce: option<string>=?,
  ()
): string => {
  let params = [
    ("response_type", "code"),
    ("client_id", config.clientId),
    ("redirect_uri", config.redirectUri),
    ("scope", Belt.Array.joinWith(config.scopes, " ", x => x)),
    ("state", state),
  ]

  let paramsWithNonce = switch nonce {
  | Some(n) => Belt.Array.concat(params, [("nonce", n)])
  | None => params
  }

  let query = paramsWithNonce
    ->Belt.Array.map(((key, value)) => {
      let encoded = Js.Global.encodeURIComponent(value)
      `${key}=${encoded}`
    })
    ->Belt.Array.joinWith("&", x => x)

  `${config.authorizationEndpoint}?${query}`
}

// Exchange authorization code for tokens
let exchangeCode = async (config: oauth2Config, code: string): tokenResponse => {
  let params = [
    ("grant_type", "authorization_code"),
    ("code", code),
    ("redirect_uri", config.redirectUri),
    ("client_id", config.clientId),
    ("client_secret", config.clientSecret),
  ]

  let body = params
    ->Belt.Array.map(((key, value)) => {
      let encoded = Js.Global.encodeURIComponent(value)
      `${key}=${encoded}`
    })
    ->Belt.Array.joinWith("&", x => x)

  let response = await Fetch.fetchWithInit(
    config.tokenEndpoint,
    Fetch.RequestInit.make(
      ~method_=#POST,
      ~headers=Fetch.HeadersInit.make({"Content-Type": "application/x-www-form-urlencoded"}),
      ~body=body,
      ()
    )
  )

  if !response.ok {
    let error = await response.text()
    raise(Js.Exn.raiseError(`Token exchange failed: ${error}`))
  }

  let json = await response.json()
  let obj = json->Js.Json.decodeObject->Belt.Option.getExn

  {
    accessToken: obj->Js.Dict.get("access_token")->Belt.Option.flatMap(Js.Json.decodeString)->Belt.Option.getExn,
    tokenType: obj->Js.Dict.get("token_type")->Belt.Option.flatMap(Js.Json.decodeString)->Belt.Option.getExn,
    expiresIn: obj->Js.Dict.get("expires_in")->Belt.Option.flatMap(Js.Json.decodeNumber)->Belt.Option.map(Belt.Float.toInt)->Belt.Option.getExn,
    refreshToken: obj->Js.Dict.get("refresh_token")->Belt.Option.flatMap(Js.Json.decodeString),
    scope: obj->Js.Dict.get("scope")->Belt.Option.flatMap(Js.Json.decodeString),
    idToken: obj->Js.Dict.get("id_token")->Belt.Option.flatMap(Js.Json.decodeString),
  }
}

// Refresh access token
let refreshToken = async (config: oauth2Config, refreshToken: string): tokenResponse => {
  let params = [
    ("grant_type", "refresh_token"),
    ("refresh_token", refreshToken),
    ("client_id", config.clientId),
    ("client_secret", config.clientSecret),
  ]

  let body = params
    ->Belt.Array.map(((key, value)) => {
      let encoded = Js.Global.encodeURIComponent(value)
      `${key}=${encoded}`
    })
    ->Belt.Array.joinWith("&", x => x)

  let response = await Fetch.fetchWithInit(
    config.tokenEndpoint,
    Fetch.RequestInit.make(
      ~method_=#POST,
      ~headers=Fetch.HeadersInit.make({"Content-Type": "application/x-www-form-urlencoded"}),
      ~body=body,
      ()
    )
  )

  if !response.ok {
    let error = await response.text()
    raise(Js.Exn.raiseError(`Token refresh failed: ${error}`))
  }

  let json = await response.json()
  let obj = json->Js.Json.decodeObject->Belt.Option.getExn

  {
    accessToken: obj->Js.Dict.get("access_token")->Belt.Option.flatMap(Js.Json.decodeString)->Belt.Option.getExn,
    tokenType: obj->Js.Dict.get("token_type")->Belt.Option.flatMap(Js.Json.decodeString)->Belt.Option.getExn,
    expiresIn: obj->Js.Dict.get("expires_in")->Belt.Option.flatMap(Js.Json.decodeNumber)->Belt.Option.map(Belt.Float.toInt)->Belt.Option.getExn,
    refreshToken: obj->Js.Dict.get("refresh_token")->Belt.Option.flatMap(Js.Json.decodeString),
    scope: obj->Js.Dict.get("scope")->Belt.Option.flatMap(Js.Json.decodeString),
    idToken: obj->Js.Dict.get("id_token")->Belt.Option.flatMap(Js.Json.decodeString),
  }
}

// Get user info from OIDC provider
let getUserInfo = async (config: oidcConfig, accessToken: string): Js.Json.t => {
  let response = await Fetch.fetchWithInit(
    config.userInfoEndpoint,
    Fetch.RequestInit.make(
      ~headers=Fetch.HeadersInit.make({"Authorization": `Bearer ${accessToken}`}),
      ()
    )
  )

  if !response.ok {
    let error = await response.text()
    raise(Js.Exn.raiseError(`User info request failed: ${error}`))
  }

  await response.json()
}

// Logout (end OIDC session)
let getLogoutUrl = (
  config: oidcConfig,
  idToken: string,
  postLogoutRedirectUri: string
): option<string> => {
  switch config.endSessionEndpoint {
  | None => None
  | Some(endpoint) => {
      let params = [
        ("id_token_hint", idToken),
        ("post_logout_redirect_uri", postLogoutRedirectUri),
      ]

      let query = params
        ->Belt.Array.map(((key, value)) => {
          let encoded = Js.Global.encodeURIComponent(value)
          `${key}=${encoded}`
        })
        ->Belt.Array.joinWith("&", x => x)

      Some(`${endpoint}?${query}`)
    }
  }
}

// Generate secure random state
@val external getRandomValues: Js.TypedArray2.Uint8Array.t => unit = "crypto.getRandomValues"

let generateState = (): string => {
  let array = Js.TypedArray2.Uint8Array.fromLength(32)
  getRandomValues(array)

  Belt.Array.reduceWithIndex(
    Js.TypedArray2.Uint8Array.slice(array, ~start=0, ~end_=32),
    "",
    (acc, byte, _) => {
      let hex = Js.Int.toStringWithRadix(byte, ~radix=16)
      let padded = Js.String2.padStart(hex, 2, "0")
      acc ++ padded
    }
  )
}

// Generate secure nonce for OIDC
let generateNonce = (): string => generateState()

// Client credentials flow (machine-to-machine)
let clientCredentials = async (
  config: oauth2Config,
  ~scopes: option<array<string>>=?,
  ()
): tokenResponse => {
  let baseParams = [
    ("grant_type", "client_credentials"),
    ("client_id", config.clientId),
    ("client_secret", config.clientSecret),
  ]

  let params = switch scopes {
  | Some(s) => Belt.Array.concat(baseParams, [("scope", Belt.Array.joinWith(s, " ", x => x))])
  | None => baseParams
  }

  let body = params
    ->Belt.Array.map(((key, value)) => {
      let encoded = Js.Global.encodeURIComponent(value)
      `${key}=${encoded}`
    })
    ->Belt.Array.joinWith("&", x => x)

  let response = await Fetch.fetchWithInit(
    config.tokenEndpoint,
    Fetch.RequestInit.make(
      ~method_=#POST,
      ~headers=Fetch.HeadersInit.make({"Content-Type": "application/x-www-form-urlencoded"}),
      ~body=body,
      ()
    )
  )

  if !response.ok {
    let error = await response.text()
    raise(Js.Exn.raiseError(`Client credentials flow failed: ${error}`))
  }

  let json = await response.json()
  let obj = json->Js.Json.decodeObject->Belt.Option.getExn

  {
    accessToken: obj->Js.Dict.get("access_token")->Belt.Option.flatMap(Js.Json.decodeString)->Belt.Option.getExn,
    tokenType: obj->Js.Dict.get("token_type")->Belt.Option.flatMap(Js.Json.decodeString)->Belt.Option.getExn,
    expiresIn: obj->Js.Dict.get("expires_in")->Belt.Option.flatMap(Js.Json.decodeNumber)->Belt.Option.map(Belt.Float.toInt)->Belt.Option.getExn,
    refreshToken: obj->Js.Dict.get("refresh_token")->Belt.Option.flatMap(Js.Json.decodeString),
    scope: obj->Js.Dict.get("scope")->Belt.Option.flatMap(Js.Json.decodeString),
    idToken: obj->Js.Dict.get("id_token")->Belt.Option.flatMap(Js.Json.decodeString),
  }
}

// Token introspection (RFC 7662)
let introspectToken = async (
  introspectionEndpoint: string,
  token: string,
  clientId: string,
  clientSecret: string
): Js.Json.t => {
  let params = [("token", token)]

  let body = params
    ->Belt.Array.map(((key, value)) => {
      let encoded = Js.Global.encodeURIComponent(value)
      `${key}=${encoded}`
    })
    ->Belt.Array.joinWith("&", x => x)

  let auth = Js.Global.btoa(`${clientId}:${clientSecret}`)

  let response = await Fetch.fetchWithInit(
    introspectionEndpoint,
    Fetch.RequestInit.make(
      ~method_=#POST,
      ~headers=Fetch.HeadersInit.make({
        "Content-Type": "application/x-www-form-urlencoded",
        "Authorization": `Basic ${auth}`,
      }),
      ~body=body,
      ()
    )
  )

  if !response.ok {
    let status = response.status->Belt.Int.toString
    raise(Js.Exn.raiseError(`Token introspection failed: ${status}`))
  }

  await response.json()
}

// Token revocation (RFC 7009)
let revokeToken = async (
  revocationEndpoint: string,
  token: string,
  clientId: string,
  clientSecret: string,
  ~tokenTypeHint: option<string>=?,
  ()
): unit => {
  let baseParams = [("token", token)]

  let params = switch tokenTypeHint {
  | Some(hint) => Belt.Array.concat(baseParams, [("token_type_hint", hint)])
  | None => baseParams
  }

  let body = params
    ->Belt.Array.map(((key, value)) => {
      let encoded = Js.Global.encodeURIComponent(value)
      `${key}=${encoded}`
    })
    ->Belt.Array.joinWith("&", x => x)

  let auth = Js.Global.btoa(`${clientId}:${clientSecret}`)

  let response = await Fetch.fetchWithInit(
    revocationEndpoint,
    Fetch.RequestInit.make(
      ~method_=#POST,
      ~headers=Fetch.HeadersInit.make({
        "Content-Type": "application/x-www-form-urlencoded",
        "Authorization": `Basic ${auth}`,
      }),
      ~body=body,
      ()
    )
  )

  if !response.ok {
    let status = response.status->Belt.Int.toString
    raise(Js.Exn.raiseError(`Token revocation failed: ${status}`))
  }
}
