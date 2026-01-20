// SPDX-License-Identifier: PMPL-1.0-or-later
// Svalinn Gateway - Main Entry Point in ReScript

module Ajv = {
  @val external make: (~allErrors: bool) => {..} = "Ajv"
  @send external addSchema: ({..}, string, 'a) => unit = "addSchema"
  @send external getSchema: ({..}, string) => option<{..}> = "getSchema"
  @send external validate: ({..}, 'a) => bool = "validate"
  @get external errors: option<array<{message: string}>> = "errors"
}

module AjvFormats = {
  @val external default: {..} => unit = "default"
}

module Config = {
  let port = Belt.Int.fromString(Deno.env.get("SVALINN_PORT")->Belt.Option.getWithDefault("8000"))
  let host = Deno.env.get("SVALINN_HOST")->Belt.Option.getWithDefault("0.0.0.0")
  let vordrEndpoint = Deno.env.get("VORDR_ENDPOINT")->Belt.Option.getWithDefault("http://localhost:8080")
  let specVersion = Deno.env.get("SPEC_VERSION")->Belt.Option.getWithDefault("v0.1.0")
}

module Schema = {
  type t
  let schemas: Belt.Map.String.t<t> = Belt.Map.String.make()

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

  let get = async (req) => {
    let id = req->Request.url->Url.pathname->Js.String.split("/")->Belt.Array.getExn(3)
    let result = await Vordr.call("vordr_container_inspect", {"containerId": id})
    switch result {
    | Belt.Result.Ok(data) => Response.make(~status=#OK, ~body=Js.Json.stringify(data), ())
    | Belt.Result.Error(error) => Response.make(~status=#NotFound, ~body=Js.Json.stringify({"error"}), ())
    }
  }

  let inspect = async (req) => {
    let id = req->Request.url->Url.pathname->Js.String.split("/")->Belt.Array.getExn(3)
    let result = await Vordr.call("vordr_container_inspect", {"containerId": id})
    switch result {
    | Belt.Result.Ok(data) => Response.make(~status=#OK, ~body=Js.Json.stringify({"id", "data"}), ())
    | Belt.Result.Error(error) => Response.make(~status=#NotFound, ~body=Js.Json.stringify({"error"}), ())
    }
  }

  let run = async (req) => {
    let body = await req->Request.json
    let validation = Validation.validateRequest("gateway-run-request.v1.json", body)
    if !validation.valid {
      Response.make(
        ~status=#BadRequest,
        ~body=Js.Json.stringify({
          "code": "VALIDATION_ERROR",
          "message": "Request validation failed",
          "details": validation.errors,
        }),
        (),
      )
    } else {
      try {
        let createResult = await Vordr.call("vordr_container_create", {
          "image": body["imageName"],
          "name": body["name"],
          "config": {"privileged": false, "readOnlyRoot": true},
        })
        let containerId = createResult["containerId"]
        let _ = await Vordr.call("vordr_container_start", {"containerId"})
        Response.make(
          ~status=#OK,
          ~body=Js.Json.stringify({"containerId", "status": "running", "image": body["imageName"]}),
          (),
        )
      } catch error => Response.make(~status=#InternalServerError, ~body=Js.Json.stringify({"code": "RUN_ERROR", "message": error}), ())
    }
  }

  let stop = async (req) => {
    let id = req->Request.url->Url.pathname->Js.String.split("/")->Belt.Array.getExn(3)
    let result = await Vordr.call("vordr_container_stop", {"containerId": id})
    switch result {
    | Belt.Result.Ok(_) => Response.make(~status=#OK, ~body=Js.Json.stringify({"status": "stopped", "containerId": id}), ())
    | Belt.Result.Error(error) => Response.make(~status=#InternalServerError, ~body=Js.Json.stringify({"error"}), ())
    }
  }

  let remove = async (req) => {
    let id = req->Request.url->Url.pathname->Js.String.split("/")->Belt.Array.getExn(3)
    let result = await Vordr.call("vordr_container_remove", {"containerId": id})
    switch result {
    | Belt.Result.Ok(_) => Response.make(~status=#OK, ~body=Js.Json.stringify({"status": "removed", "containerId": id}), ())
    | Belt.Result.Error(error) => Response.make(~status=#InternalServerError, ~body=Js.Json.stringify({"error"}), ())
    }
  }
}

module Images = {
  let list = async (_req) => {
    let result = await Vordr.call("vordr_image_list", {})
    switch result {
    | Belt.Result.Ok(images) => Response.make(~status=#OK, ~body=Js.Json.stringify({"images"}), ())
    | Belt.Result.Error(error) => Response.make(~status=#OK, ~body=Js.Json.stringify({"images": [], "error"}), ())
    }
  }
}

module Verify = {
  let handler = async (req) => {
    let body = await req->Request.json
    let validation = Validation.validateRequest("gateway-verify-request.v1.json", body)
    if !validation.valid {
      Response.make(
        ~status=#BadRequest,
        ~body=Js.Json.stringify({
          "code": "VALIDATION_ERROR",
          "message": "Request validation failed",
          "details": validation.errors,
        }),
        (),
      )
    } else {
      let result = await Vordr.call("vordr_verify_image", {
        "image": body["imageRef"],
        "checkSbom": body["checkSbom"]->Belt.Option.getWithDefault(true),
        "checkSignature": body["checkSignature"]->Belt.Option.getWithDefault(true),
      })
      switch result {
      | Belt.Result.Ok(data) => Response.make(~status=#OK, ~body=Js.Json.stringify(data), ())
      | Belt.Result.Error(error) => Response.make(~status=#InternalServerError, ~body=Js.Json.stringify({"code": "VERIFY_ERROR", "message": error}), ())
      }
    }
  }
}

module Router = {
  let app = Router.make()

  // Middleware
  app->Router.use(Router.Middleware.logger)
  app->Router.use(Router.Middleware.cors)

  // Routes
  app->Router.get("/healthz", HealthCheck.handler)
  app->Router.get("/v1/containers", Containers.list)
  app->Router.get("/v1/containers/:id", Containers.get)
  app->Router.get("/v1/containers/:id/inspect", Containers.inspect)
  app->Router.post("/v1/run", Containers.run)
  app->Router.post("/v1/verify", Verify.handler)
  app->Router.post("/v1/containers/:id/stop", Containers.stop)
  app->Router.delete("/v1/containers/:id", Containers.remove)
  app->Router.get("/v1/images", Images.list)
}

let ajv = Ajv.make(~allErrors=true)
AjvFormats.default(ajv)

let _ = Schema.loadSchemas()

Js.log(`
╔═══════════════════════════════════════════════════════════════╗
║                    Svalinn Edge Shield                         ║
║            Post-Cloud Security Architecture                    ║
╠═══════════════════════════════════════════════════════════════╣
║  Version:    0.1.0                                             ║
║  Port:       ${String.make(Config.port)->Js.String.padEnd(48)}║
║  Vörðr:      ${Config.vordrEndpoint->Js.String.padEnd(48)}║
║  Spec:       ${Config.specVersion->Js.String.padEnd(48)}║
╚═══════════════════════════════════════════════════════════════╝
`)

Deno.serve({port: Config.port, hostname: Config.host}, Router.app->Router.handleRequest)
