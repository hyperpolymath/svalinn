;; SPDX-License-Identifier: PMPL-1.0-or-later
;; ECOSYSTEM.scm - Svalinn's position in the verified container ecosystem

(ecosystem
  ((version . 1)
   (name . "Svalinn Edge Shield")
   (type . "HTTP Gateway")
   (purpose . "Type-safe edge gateway for verified container operations with authentication and policy enforcement")

   (position-in-ecosystem
     . "Svalinn sits between external clients (CLI tools, web UIs) and the Vörðr container runtime. It validates requests, enforces policies, handles authentication, and delegates verified operations to Vörðr via MCP.")

   (related-projects
     ((vordr
        ((relationship . "sibling-standard")
         (nature . "MCP client → server")
         (description . "Svalinn delegates all container operations to Vörðr via JSON-RPC 2.0 MCP protocol")
         (integration-status . "complete")
         (dependencies
           ((protocol . "MCP (Model Context Protocol)")
            (endpoint . "VORDR_ENDPOINT environment variable")
            (retry-logic . "exponential backoff, 3 retries, 30s timeout")))))

      (cerro-torre
        ((relationship . "sibling-standard")
         (nature . "bundle verification consumer")
         (description . "Svalinn validates .ctp bundle policies before forwarding to Vörðr for verification")
         (integration-status . "partial")
         (dependencies
           ((bundle-format . ".ctp (Cerro Torre Package)")
            (verification . "delegated to Vörðr")
            (policy-validation . "gateway validates policy format")))))

      (verified-container-spec
        ((relationship . "protocol-specification")
         (nature . "specification consumer")
         (description . "Svalinn implements JSON Schema validation against verified-container-spec schemas")
         (integration-status . "complete")
         (dependencies
           ((schemas . "gateway-run-request.v1.json, gateway-verify-request.v1.json, gatekeeper-policy.v1.json")
            (validator . "Ajv (JSON Schema Draft 07)")
            (spec-version . "SPEC_VERSION environment variable")))))

      (rescript
        ((relationship . "potential-consumer")
         (nature . "implementation language")
         (description . "All Svalinn modules written in ReScript, compiled to JavaScript for Deno runtime")
         (integration-status . "complete")
         (dependencies
           ((compiler . "rescript@11.x")
            (stdlib . "@rescript/core")
            (output-format . "ES6 modules (.res.js)")))))

      (deno
        ((relationship . "potential-consumer")
         (nature . "runtime environment")
         (description . "Svalinn runs on Deno for security-first execution with explicit permissions")
         (integration-status . "complete")
         (dependencies
           ((version . ">=2.0")
            (permissions . "read, write, net, env")
            (imports . "npm:hono, npm:ajv")))))

      (hono
        ((relationship . "potential-consumer")
         (nature . "HTTP framework")
         (description . "Svalinn uses Hono for edge-optimized HTTP server with middleware support")
         (integration-status . "complete")
         (dependencies
           ((version . "^4.0")
            (middleware . "CORS, auth, error handling, logging")
            (routing . "12+ REST API endpoints")))))))

   (what-this-is
     ("Type-safe HTTP gateway for container operations"
      "Authentication layer (OAuth2/OIDC/JWT/API keys/mTLS)"
      "Request validation layer (JSON Schema)"
      "Policy enforcement layer (Gatekeeper format validation)"
      "MCP client for Vörðr communication"
      "Edge entry point for verified container ecosystem"))

   (what-this-is-not
     ("Container runtime (that's Vörðr)"
      "Image builder (that's Cerro Torre)"
      "Formal verification engine (that's Vörðr's Ada/SPARK layer)"
      "Multi-node orchestrator (planned for future)"
      "Service mesh (out of scope)"
      "Package registry (delegates to OCI registries)"))))
