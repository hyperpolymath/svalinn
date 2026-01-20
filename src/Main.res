// SPDX-License-Identifier: PMPL-1.0-or-later
module Config = {
  let port = Belt.Int.fromString(Deno.env.get("SVALINN_PORT")->Belt.Option.getWithDefault("8000"))
  let host = Deno.env.get("SVALINN_HOST")->Belt.Option.getWithDefault("0.0.0.0")
  let vordrEndpoint = Deno.env.get("VORDR_ENDPOINT")->Belt.Option.getWithDefault("http://localhost:8080")
  let specVersion = Deno.env.get("SPEC_VERSION")->Belt.Option.getWithDefault("v0.1.0")
}

module Ajv = {
  @val external make: (~allErrors: bool) => {..} = "Ajv"
  @send external addSchema: ({..}, string, 'a) => unit = "addSchema"
  @send external getSchema: ({..}, string) => option<{..}> = "getSchema"
  @send external validate: ({..}, 'a) => bool = ""
  @get external errors: option<array<{message: string}>> = "errors"
}

module Schema = {
  let schemas = Belt.Map.String.make()
  let loadSchemas = async (_) => {
    let schemaFiles = [
      "gateway-run-request.v1.json",
      "gateway-verify-request.v1.json",
      "container-info.v1.json",
      "error-response.v1.json",
    ]
    for file in schemaFiles {
      try {
        let schemaPath = "../spec/schemas/" ++ file
        let schema = JSON.parse(await Deno.readTextFile(schemaPath))
        schemas->Belt.Map.String.set(file, schema)
        ajv->Ajv.addSchema(schema, file)
      } catch _ => Js.log2("Warning: Could not load schema", file)
    }
  }
}

module Vordr = {
  let call = async (toolName: string, args: 'a) => {
    let response = await Fetch.fetchWithInit(
      Config.vordrEndpoint,
      Fetch.RequestInit.make(
        ~method_=#POST,
        ~headers=Fetch.HeadersInit.make({"Content-Type": "application/json"}),
        ~body=Js.Json.stringify({
          "jsonrpc": "2.0",
          "method": "tools/call",
          "params": {"name": toolName, "arguments": args},
          "id": Js.Date.now(),
        }),
        (),
      ),
    )
    let result = await response->Fetch.Response.json
    if Js.Dict.get(result, "error")->Belt.Option.isSome {
      Belt.Result.Error(Js.Dict.get(result, "error")->Belt.Option.flatMap(error => Js.Dict.get(error, "message")))
    } else {
      Belt.Result.Ok(Js.Dict.get(result, "result"))
    }
  }
}

module Validation = {
  let validateRequest = (schemaName: string, data: 'a) => {
    let validate = ajv->Ajv.getSchema(schemaName)
    switch validate {
    | None => {valid: false, errors: Some([{"message": "Schema " ++ schemaName ++ " not found"}])}
    | Some(validate) => {
      let valid = validate->Ajv.validate(data)
      {valid, errors: validate->Ajv.errors}
    }
  }
}

module HealthCheck = {
  let handler = async (_req) => {
    let vordrConnected = try {
      let _ = await Fetch.fetch(Config.vordrEndpoint ++ "/health")
      true
    } catch _ => false
    Response.make(
      ~status=#OK,
      ~headers=Fetch.HeadersInit.make({"Content-Type": "application/json"}),
      ~body=Js.Json.stringify({
        "status": "healthy",
        "version": "0.1.0",
        "vordrConnected,
        "specVersion": Config.specVersion,
        "timestamp": Js.Date.toISOString(Js.Date.now()),
      }),
      (),
    )
  }
}

module Containers = {
  let list = async (_req) => {
    let result = await Vordr.call("vordr_container_list", {})
    switch result {
    | Belt.Result.Ok(containers) => Response.make(~status=#OK, ~body=Js.Json.stringify({"containers"}), ())
    | Belt.Result.Error(error) => Response.make(~status=#OK, ~body=Js.Json.stringify({"containers": [], "error"}), ())
    }
  }
}

let ajv = Ajv.make(~allErrors=true)
let _ = Schema.loadSchemas()

Deno.serve({port: Config.port, hostname: Config.host}, Router.app->Router.handleRequest)
