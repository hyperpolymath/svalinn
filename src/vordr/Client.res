// SPDX-License-Identifier: PMPL-1.0-or-later
// Vörðr MCP client for Svalinn

open Types

// Client configuration
type clientConfig = {
  endpoint: string,
  timeout: int,
}

// Client instance
type t = {
  config: clientConfig,
  mutable requestId: int,
}

// Create client
let make = (config: clientConfig): t => {
  {config, requestId: 0}
}

// Default client configuration
let defaultConfig: clientConfig = {
  endpoint: "http://localhost:8080",
  timeout: 30000,
}

// Create from environment
let fromEnv = (): t => {
  let endpoint = switch Js.Dict.get(%raw(`Deno.env.toObject()`), "VORDR_ENDPOINT") {
  | Some(e) => e
  | None => defaultConfig.endpoint
  }
  make({...defaultConfig, endpoint})
}

// Generate next request ID
let nextId = (client: t): int => {
  client.requestId = client.requestId + 1
  client.requestId
}

// Make MCP request
let callTool = async (client: t, toolName: string, args: JSON.t): JSON.t => {
  let request: mcpRequest = {
    jsonrpc: "2.0",
    method: "tools/call",
    params: Obj.magic({
      "name": toolName,
      "arguments": args,
    }),
    id: nextId(client),
  }

  // Make HTTP request to Vörðr
  let response = await Fetch.fetch(
    client.config.endpoint,
    {
      method: #POST,
      headers: Fetch.Headers.fromObject({
        "Content-Type": "application/json",
      }),
      body: Fetch.Body.string(JSON.stringify(Obj.magic(request))),
    },
  )

  let json = await Fetch.Response.json(response)
  let mcpResp: mcpResponse = Obj.magic(json)

  switch mcpResp.error {
  | Some(err) => Js.Exn.raiseError(err.message)
  | None =>
    switch mcpResp.result {
    | Some(r) => r
    | None => JSON.Encode.null
    }
  }
}

// Ping Vörðr to check connectivity
let ping = async (client: t): bool => {
  try {
    let _ = await Fetch.fetch(
      `${client.config.endpoint}/health`,
      {method: #GET},
    )
    true
  } catch {
  | _ => false
  }
}

// Container operations
let listContainers = async (client: t): array<Gateway.Types.containerInfo> => {
  // Vörðr doesn't have a list tool, we'd need to track locally
  // For now return empty
  []
}

let listImages = async (_client: t): array<Gateway.Types.imageInfo> => {
  // Same as above - would need local tracking
  []
}

let runContainer = async (
  client: t,
  request: Gateway.Types.runRequest,
): Gateway.Types.containerInfo => {
  // First create
  let createArgs = Obj.magic({
    "image": request.imageName,
    "name": request.name,
    "config": {
      "privileged": false,
      "readOnlyRoot": true,
    },
  })
  let createResult = await callTool(client, toolContainerCreate, createArgs)

  // Then start
  let containerId = Obj.magic(createResult)["containerId"]
  let _ = await callTool(client, toolContainerStart, Obj.magic({"containerId": containerId}))

  {
    id: containerId,
    name: Option.getOr(request.name, containerId),
    image: request.imageName,
    imageDigest: request.imageDigest,
    state: Gateway.Types.Running,
    policyVerdict: "allowed",
    createdAt: Some(Date.now()->Float.toString),
    startedAt: Some(Date.now()->Float.toString),
  }
}

let verifyImage = async (
  client: t,
  imageRef: string,
  _digest: string,
): Gateway.Types.verificationResult => {
  let args = Obj.magic({
    "image": imageRef,
    "checkSbom": true,
    "checkSignature": true,
  })
  let result = await callTool(client, toolVerifyImage, args)
  Obj.magic(result)
}

let stopContainer = async (client: t, containerId: string): unit => {
  let _ = await callTool(client, toolContainerStop, Obj.magic({"containerId": containerId}))
}

let removeContainer = async (client: t, containerId: string): unit => {
  let _ = await callTool(client, toolContainerRemove, Obj.magic({"containerId": containerId}))
}

let inspectContainer = async (_client: t, containerId: string): Gateway.Types.containerInfo => {
  // Placeholder - would call Vörðr's inspect if available
  {
    id: containerId,
    name: containerId,
    image: "unknown",
    imageDigest: "",
    state: Gateway.Types.Running,
    policyVerdict: "unknown",
    createdAt: None,
    startedAt: None,
  }
}

// Authorization operations
let requestAuthorization = async (
  client: t,
  operation: string,
  threshold: int,
  signers: int,
): JSON.t => {
  let args = Obj.magic({
    "operation": operation,
    "threshold": threshold,
    "signers": signers,
  })
  await callTool(client, toolRequestAuth, args)
}

let submitSignature = async (
  client: t,
  share: signatureShare,
): JSON.t => {
  let args = Obj.magic(share)
  await callTool(client, toolSubmitSignature, args)
}

// Monitoring operations
let startMonitor = async (client: t, config: monitorConfig): JSON.t => {
  await callTool(client, toolMonitorStart, Obj.magic(config))
}

let stopMonitor = async (client: t, containerId: string): JSON.t => {
  await callTool(client, toolMonitorStop, Obj.magic({"containerId": containerId}))
}

let getAnomalies = async (
  client: t,
  containerId: string,
  severity: string,
): JSON.t => {
  let args = Obj.magic({
    "containerId": containerId,
    "severity": severity,
  })
  await callTool(client, toolGetAnomalies, args)
}

// Reversibility operations
let rollback = async (client: t, containerId: string, steps: int): JSON.t => {
  let args = Obj.magic({
    "containerId": containerId,
    "steps": steps,
  })
  await callTool(client, toolRollback, args)
}

let previewRollback = async (client: t, containerId: string): JSON.t => {
  let args = Obj.magic({"containerId": containerId})
  await callTool(client, toolPreviewRollback, args)
}

// Export default client instance
let client = fromEnv()
