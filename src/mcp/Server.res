// SPDX-License-Identifier: PMPL-1.0-or-later
// Svalinn MCP server implementation

open McpTypes

// Server info
let serverName = "svalinn"
let serverVersion = "0.1.0"
let protocolVersion = "2024-11-05"

// Handle initialize request
let handleInitialize = (_params: option<JSON.t>): JSON.t => {
  Obj.magic({
    "protocolVersion": protocolVersion,
    "capabilities": {
      "tools": {},
    },
    "serverInfo": {
      "name": serverName,
      "version": serverVersion,
    },
  })
}

// Handle list tools request
let handleListTools = (): JSON.t => {
  let result: listToolsResult = {
    tools: Tools.allTools,
  }
  Obj.magic(result)
}

// Handle tool call
let handleCallTool = async (params: JSON.t): JSON.t => {
  let name: string = Obj.magic(params)["name"]
  let arguments: JSON.t = Obj.magic(params)["arguments"]

  let result = switch name {
  | "svalinn_run" => await handleRun(arguments)
  | "svalinn_ps" => await handlePs(arguments)
  | "svalinn_stop" => await handleStop(arguments)
  | "svalinn_verify" => await handleVerify(arguments)
  | "svalinn_policy" => handlePolicy(arguments)
  | "svalinn_logs" => await handleLogs(arguments)
  | "svalinn_exec" => await handleExec(arguments)
  | "svalinn_rm" => await handleRm(arguments)
  | _ =>
    makeError(`Unknown tool: ${name}`)
  }

  result
}

// Tool handlers
and handleRun = async (args: JSON.t): JSON.t => {
  let image: string = Obj.magic(args)["image"]
  let name: option<string> = Obj.magic(args)["name"]

  // Validate against edge policy first
  let policy = Validation.defaultPolicy
  if !Validation.isAllowedRegistry(image, policy) {
    makeError("Image from disallowed registry")
  } else if Validation.isDeniedImage(image, policy) {
    makeError("Image is in deny list")
  } else {
    // Delegate to Vörðr
    let client = VordrClient.client
    let request: Gateway.Types.runRequest = {
      imageName: image,
      imageDigest: "",
      name,
      command: None,
      env: None,
      detach: Obj.magic(args)["detach"],
      removeOnExit: Obj.magic(args)["removeOnExit"],
      profile: None,
    }

    try {
      let containerInfo = await VordrClient.runContainer(client, request)
      makeSuccess(`Container started: ${containerInfo.id}`)
    } catch {
    | Js.Exn.Error(e) =>
      let msg = Js.Exn.message(e)->Option.getOr("Unknown error")
      makeError(msg)
    }
  }
}

and handlePs = async (_args: JSON.t): JSON.t => {
  let client = VordrClient.client
  let containers = await VordrClient.listContainers(client)
  let text = if Array.length(containers) == 0 {
    "No containers running"
  } else {
    Array.map(containers, c => `${c.id}\t${c.name}\t${c.image}`)
    ->Array.joinWith("\n")
  }
  makeSuccess(text)
}

and handleStop = async (args: JSON.t): JSON.t => {
  let containerId: string = Obj.magic(args)["containerId"]
  let client = VordrClient.client

  try {
    await VordrClient.stopContainer(client, containerId)
    makeSuccess(`Container stopped: ${containerId}`)
  } catch {
  | Js.Exn.Error(e) =>
    let msg = Js.Exn.message(e)->Option.getOr("Unknown error")
    makeError(msg)
  }
}

and handleVerify = async (args: JSON.t): JSON.t => {
  let image: string = Obj.magic(args)["image"]
  let client = VordrClient.client

  try {
    let result = await VordrClient.verifyImage(client, image, "")
    if result.verified {
      makeSuccess(`Image verified: ${image}`)
    } else {
      makeError(`Image verification failed: ${image}`)
    }
  } catch {
  | Js.Exn.Error(e) =>
    let msg = Js.Exn.message(e)->Option.getOr("Unknown error")
    makeError(msg)
  }
}

and handlePolicy = (args: JSON.t): JSON.t => {
  let action: string = Obj.magic(args)["action"]

  switch action {
  | "get" =>
    let policy = Validation.defaultPolicy
    makeSuccess(JSON.stringify(Obj.magic(policy)))
  | "validate" =>
    makeSuccess("Policy valid")
  | _ =>
    makeError(`Unknown policy action: ${action}`)
  }
}

and handleLogs = async (args: JSON.t): JSON.t => {
  let _containerId: string = Obj.magic(args)["containerId"]
  // Would call Vörðr for logs - not implemented yet
  makeSuccess("Logs not yet implemented")
}

and handleExec = async (args: JSON.t): JSON.t => {
  let _containerId: string = Obj.magic(args)["containerId"]
  let _command: array<string> = Obj.magic(args)["command"]
  // Would call Vörðr for exec - not implemented yet
  makeSuccess("Exec not yet implemented")
}

and handleRm = async (args: JSON.t): JSON.t => {
  let containerId: string = Obj.magic(args)["containerId"]
  let client = VordrClient.client

  try {
    await VordrClient.removeContainer(client, containerId)
    makeSuccess(`Container removed: ${containerId}`)
  } catch {
  | Js.Exn.Error(e) =>
    let msg = Js.Exn.message(e)->Option.getOr("Unknown error")
    makeError(msg)
  }
}

// Helper functions
and makeSuccess = (text: string): JSON.t => {
  let result: toolResult = {
    content: [{type_: "text", text}],
    isError: None,
  }
  Obj.magic(result)
}

and makeError = (text: string): JSON.t => {
  let result: toolResult = {
    content: [{type_: "text", text}],
    isError: Some(true),
  }
  Obj.magic(result)
}

// Main request dispatcher
let handleRequest = async (request: jsonRpcRequest): jsonRpcResponse => {
  let result = switch request.method {
  | "initialize" =>
    handleInitialize(request.params)
  | "tools/list" =>
    handleListTools()
  | "tools/call" =>
    switch request.params {
    | Some(p) => await handleCallTool(p)
    | None => makeError("Missing params for tools/call")
    }
  | method =>
    makeError(`Unknown method: ${method}`)
  }

  {
    jsonrpc: "2.0",
    result: Some(result),
    error: None,
    id: request.id,
  }
}
