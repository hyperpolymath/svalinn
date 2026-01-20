// SPDX-License-Identifier: PMPL-1.0-or-later
// MCP types for Svalinn edge tools

// MCP protocol types
type toolInput = {
  name: string,
  description: option<string>,
  type_: string,
  required: bool,
}

type tool = {
  name: string,
  description: string,
  inputSchema: {
    type_: string,
    properties: JSON.t,
    required: array<string>,
  },
}

type textContent = {
  type_: string,
  text: string,
}

type toolResult = {
  content: array<textContent>,
  isError: option<bool>,
}

type listToolsResult = {
  tools: array<tool>,
}

// JSON-RPC types
type jsonRpcRequest = {
  jsonrpc: string,
  method: string,
  params: option<JSON.t>,
  id: option<int>,
}

type jsonRpcResponse = {
  jsonrpc: string,
  result: option<JSON.t>,
  error: option<{
    code: int,
    message: string,
  }>,
  id: option<int>,
}

// Method names
let methodInitialize = "initialize"
let methodListTools = "tools/list"
let methodCallTool = "tools/call"
let methodNotification = "notifications/message"
