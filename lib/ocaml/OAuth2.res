// SPDX-License-Identifier: PMPL-1.0-or-later
/**
 * OAuth2 Flow Handlers for Svalinn
 * Fully ported to ReScript v12
 */

open AuthTypes

module URLSearchParams = {
  type t
  @new external make: JSON.t => t = "URLSearchParams"
  @send external toString: t => string = "toString"
  @send external set: (t, string, string) => unit = "set"
}

type tokenResponse = {
  access_token: string,
  token_type: string,
  expires_in: int,
  refresh_token?: string,
  scope?: string,
  id_token?: string,
}

let getAuthorizationUrl = (config: Types.oauth2Config, state: string, ~nonce: option<string>=?) => {
  let params = URLSearchParams.make(
    Obj.magic({
      "response_type": "code",
      "client_id": config.clientId,
      "redirect_uri": config.redirectUri,
      "scope": config.scopes->Array.joinUnsafe(" "),
      "state": state,
    }),
  )

  switch nonce {
  | Some(n) => params->URLSearchParams.set("nonce", n)
  | None => ()
  }

  `${config.authorizationEndpoint}?${params->URLSearchParams.toString}`
}

let exchangeCode = async (config: Types.oauth2Config, code: string): tokenResponse => {
  let params = URLSearchParams.make(
    Obj.magic({
      "grant_type": "authorization_code",
      "code": code,
      "redirect_uri": config.redirectUri,
      "client_id": config.clientId,
      "client_secret": config.clientSecret,
    }),
  )

  let response = await Fetch.fetch(
    config.tokenEndpoint,
    {
      "method": #POST,
      "headers": Fetch.Headers.fromObject({"Content-Type": "application/x-www-form-urlencoded"}),
      "body": Fetch.Body.string(params->URLSearchParams.toString),
    },
  )

  if !Fetch.Response.ok(response) {
    let error = await Fetch.Response.text(response)
    failwith(`Token exchange failed: ${error}`)
  }

  await Fetch.Response.json(response)->Promise.then(json => Promise.resolve(Obj.magic(json)))
}

let generateState = (): string => {
  let _array = Uint8Array.fromLength(32)
  %raw(`crypto.getRandomValues(array)`)
  Array.fromInitializer(~length=32, _i => %raw("_array[_i]")->Int.toStringWithRadix(~radix=16)->String.padStart(2, "0"))
  ->Array.joinUnsafe("")
}

let generateNonce = () => generateState()
