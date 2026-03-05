// SPDX-License-Identifier: PMPL-1.0-or-later
/**
 * Svalinn Integration - Poly Container MCP
 * Fully ported to ReScript v12
 */

module Types = {
  type containerRuntime = [ #nerdctl | #podman | #docker ]

  type containerResult = {
    success: bool,
    runtime: containerRuntime,
    containerId?: string,
    output?: string,
    error?: string,
  }

  type imageResult = {
    success: bool,
    runtime: containerRuntime,
    imageId?: string,
    digest?: string,
    size?: int,
    error?: string,
  }

  type runtimeInfo = {
    runtime: containerRuntime,
    version: string,
    available: bool,
    path?: string,
    rootless?: bool,
  }
}

let runtimePriority: array<Types.containerRuntime> = [#nerdctl, #podman, #docker]

module PolyContainerMcp = {
  type t = {
    mcpEndpoint: string,
    mutable preferredRuntime: option<Types.containerRuntime>,
    availableRuntimes: Map.t<Types.containerRuntime, Types.runtimeInfo>,
  }

  let make = (~endpoint="http://localhost:3000") => {
    {
      mcpEndpoint: endpoint,
      preferredRuntime: None,
      availableRuntimes: Map.make(),
    }
  }

  let callTool = async (self: t, tool: string, args: JSON.t, ~runtime: option<Types.containerRuntime>=?) => {
    let targetRuntime = switch (runtime, self.preferredRuntime) {
    | (Some(r), _) => Some(r)
    | (_, Some(r)) => Some(r)
    | _ => None
    }

    let payload = Obj.magic({
      "jsonrpc": "2.0",
      "method": "tools/call",
      "params": {
        "name": tool,
        "arguments": {
          "args": args,
          "runtime": targetRuntime,
        },
      },
      "id": Date.now(),
    })

    let response = await Fetch.fetch(
      self.mcpEndpoint,
      {
        "method": #POST,
        "headers": Fetch.Headers.fromObject({"Content-Type": "application/json"}),
        "body": Fetch.Body.string(JSON.stringify(payload)),
      },
    )

    if !Fetch.Response.ok(response) {
      failwith("MCP API error")
    }
    
    let result = await Fetch.Response.json(response)
    %raw(`result.result`)
  }

  // Operation implementations...
  let run = async (self: t, image: string): Types.containerResult => {
    let result = await self->callTool("container_run", Obj.magic({"image": image}))
    Obj.magic(result)
  }
}
