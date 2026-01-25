;; SPDX-License-Identifier: AGPL-3.0-or-later
;; META.scm - Project metadata and architectural decisions

(define project-meta
  `((version . "0.2.0-rc1")
    (last-updated . "2026-01-25")
    (architecture-decisions
      ((adr-001
         (status . accepted)
         (date . "2026-01-25")
         (context . "Edge gateway needs type-safe HTTP server")
         (decision . "Use ReScript + Hono framework on Deno runtime")
         (consequences
           ((positive . "Compile-time type safety, no runtime errors")
            (positive . "Deno security model (explicit permissions)")
            (negative . "ReScript learning curve for contributors"))))
       (adr-002
         (status . accepted)
         (date . "2026-01-25")
         (context . "Gateway and Vörðr need communication protocol")
         (decision . "Use MCP (Model Context Protocol) with JSON-RPC 2.0")
         (consequences
           ((positive . "Standard protocol, AI assistant compatible")
            (positive . "Extensible tool definitions")
            (negative . "HTTP overhead compared to raw sockets"))))
       (adr-003
         (status . accepted)
         (date . "2026-01-25")
         (context . "Policy enforcement can happen at gateway or runtime")
         (decision . "Validate policy format at gateway, enforce at Vörðr")
         (consequences
           ((positive . "Single source of truth (Vörðr has attestations)")
            (positive . "Gateway catches malformed policies early")
            (negative . "Requires MCP call even for validation errors"))))
       (adr-004
         (status . accepted)
         (date . "2026-01-25")
         (context . "Authentication required for production deployment")
         (decision . "Support OAuth2/OIDC + JWT + API keys + mTLS")
         (consequences
           ((positive . "Flexible auth for different use cases")
            (positive . "Standards-compliant (RFC 6749, OpenID Connect)")
            (negative . "Complex testing (needs OIDC provider)"))))
       (adr-005
         (status . accepted)
         (date . "2026-01-25")
         (context . "Request validation needed before forwarding to Vörðr")
         (decision . "Use JSON Schema with Ajv validator")
         (consequences
           ((positive . "Industry standard validation")
            (positive . "Schema-driven API documentation")
            (negative . "Schema maintenance overhead"))))))
    (development-practices
      ((code-style . "rescript")
       (security . "openssf-scorecard")
       (testing . "integration-tests")
       (versioning . "semver")
       (documentation . "asciidoc")
       (branching . "trunk-based")
       (language-policy . "rescript-only")))
    (design-rationale
      ((why-rescript-not-typescript
         . "Compile-time type safety with sound type system. TypeScript types erased at runtime.")
       (why-deno-not-node
         . "Secure by default, no node_modules, explicit permissions, native TypeScript support.")
       (why-hono-not-express
         . "Edge-first design, faster than Express, better TypeScript support, Deno compatible.")
       (why-mcp-not-grpc
         . "AI assistant ecosystem compatibility, simpler than gRPC, JSON-RPC 2.0 based.")
       (why-gateway-pattern
         . "Separates HTTP concerns from container runtime, allows other runtimes to use Vörðr.")
       (why-policy-at-runtime
         . "Runtime has access to attestations and image metadata, gateway only validates format.")))))
