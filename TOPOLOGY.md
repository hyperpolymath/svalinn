<!-- SPDX-License-Identifier: PMPL-1.0-or-later -->
<!-- Copyright (c) 2026 Jonathan D.A. Jewell (hyperpolymath) <j.d.a.jewell@open.ac.uk> -->
# TOPOLOGY.md — Svalinn

## Purpose

Svalinn is a Deno-based HTTP edge gateway for verified container operations, implementing the hyperpolymath post-cloud security architecture. It validates container operation requests with JSON Schema, enforces configurable allow/deny policies, handles OAuth2/JWT authentication, and delegates execution to Vörðr via MCP/JSON-RPC. The `svalinn-compose` CLI adds Compose-compatible multi-container orchestration on top of the validated gateway.

## Module Map

```
svalinn/
├── src/                           # ReScript source modules
│   ├── Main.res                   # Entry point
│   ├── gateway/                   # HTTP gateway (Hono-based)
│   │   ├── GatewayServer.res      # Server lifecycle + routing
│   │   ├── Handlers.res           # Request handlers
│   │   └── Types.res              # Gateway types
│   ├── auth/                      # Authentication middleware
│   │   ├── AuthMiddleware.res     # OAuth2/JWT middleware
│   │   ├── AuthTypes.res          # Auth type definitions
│   │   ├── Jwt.res                # JWT validation
│   │   └── OAuth2.res             # OAuth2/OIDC flows
│   ├── policy/                    # Policy engine
│   │   ├── PolicyEvaluator.res    # Allow/deny rule evaluation
│   │   ├── PolicyStore.res        # Policy persistence/loading
│   │   └── PolicyTypes.res        # Policy type definitions
│   ├── validation/                # JSON Schema validation
│   │   ├── Schema.res             # Schema registry
│   │   └── Validation.res         # Request validation logic
│   ├── mcp/                       # MCP/JSON-RPC client (Vörðr bridge)
│   │   ├── McpServer.res          # MCP server implementation
│   │   ├── McpTypes.res           # MCP protocol types
│   │   └── Tools.res              # Registered MCP tools
│   ├── compose/                   # svalinn-compose CLI
│   │   ├── ComposeOrchestrator.res # Multi-container lifecycle
│   │   └── ComposeTypes.res       # Compose manifest types
│   ├── integrations/              # Third-party integrations
│   ├── vordr/                     # Vörðr delegation client
│   └── bindings/                  # Native/FFI bindings
├── lib/                           # Shared Deno library modules
├── spec/                          # Formal API specification
├── hooks/                         # Lifecycle hooks
├── tools/                         # Dev tooling
├── ui/                            # Admin/status UI
├── dist/                          # Compiled output
└── evidence/                      # Compliance evidence artifacts
```

## Data Flow

```
[HTTP Request (container operation)]
        │
        ▼
[gateway/GatewayServer.res] ──► [auth/AuthMiddleware.res] ──► OAuth2/JWT valid?
        │                                                           │ No → 401
        │                                                           ▼ Yes
        ▼
[validation/Validation.res] ──► [validation/Schema.res] ──► JSON Schema valid?
        │                                                          │ No → 400
        │                                                          ▼ Yes
        ▼
[policy/PolicyEvaluator.res] ──► [policy/PolicyStore.res] ──► allowed?
        │                                                          │ No → 403
        │                                                          ▼ Yes
        ▼
[mcp/McpServer.res] ──► [vordr/ MCP/JSON-RPC client] ──► [Vörðr execution]
        │                                                          │
        ▼                                                          ▼
[compose/ComposeOrchestrator.res]                       [Container operation result]
(multi-container sequencing)
```
