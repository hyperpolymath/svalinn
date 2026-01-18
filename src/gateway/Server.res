// SPDX-License-Identifier: PMPL-1.0-or-later
// HTTP server for Svalinn edge shield

open Types

// Server configuration
type serverConfig = {
  port: int,
  host: string,
  vordrEndpoint: string,
  specVersion: string,
}

// Default configuration
let defaultConfig: serverConfig = {
  port: 8000,
  host: "0.0.0.0",
  vordrEndpoint: "http://localhost:8080",
  specVersion: "v0.1.0",
}

// Configuration from environment
let configFromEnv = (): serverConfig => {
  let getEnvOr = (key, default) => {
    switch Js.Dict.get(Deno.env, key) {
    | Some(v) => v
    | None => default
    }
  }

  {
    port: Int.fromString(getEnvOr("SVALINN_PORT", "8000"))->Option.getOr(8000),
    host: getEnvOr("SVALINN_HOST", "0.0.0.0"),
    vordrEndpoint: getEnvOr("VORDR_ENDPOINT", "http://localhost:8080"),
    specVersion: getEnvOr("SPEC_VERSION", "v0.1.0"),
  }
}

// Route handlers (external implementations)
@module("./handlers.mjs")
external healthHandler: unit => Promise.t<healthResponse> = "healthHandler"

@module("./handlers.mjs")
external containersHandler: unit => Promise.t<array<containerInfo>> = "containersHandler"

@module("./handlers.mjs")
external imagesHandler: unit => Promise.t<array<imageInfo>> = "imagesHandler"

@module("./handlers.mjs")
external runHandler: runRequest => Promise.t<containerInfo> = "runHandler"

@module("./handlers.mjs")
external verifyHandler: verifyRequest => Promise.t<verificationResult> = "verifyHandler"

@module("./handlers.mjs")
external stopHandler: string => Promise.t<unit> = "stopHandler"

@module("./handlers.mjs")
external removeHandler: string => Promise.t<unit> = "removeHandler"

@module("./handlers.mjs")
external inspectHandler: string => Promise.t<containerInfo> = "inspectHandler"

// Deno bindings (simplified)
module Deno = {
  @scope("Deno") @val external env: Js.Dict.t<string> = "env"
}
