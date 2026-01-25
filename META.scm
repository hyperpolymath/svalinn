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
            (negative . "Schema maintenance overhead"))))
       (adr-006
         (status . accepted)
         (date . "2026-01-25")
         (context . "30 TypeScript files remained in codebase (CLAUDE.md bans TypeScript)")
         (decision . "Delete all TypeScript files use ReScript exclusively")
         (consequences
           ((positive . "Language policy compliance (no TypeScript)")
            (positive . "Removed 8309 lines of TypeScript")
            (positive . "No duplicate implementations (TS + ReScript)")
            (negative . "Tests need rewriting in ReScript")
            (negative . "Benchmarks need rewriting"))))
       (adr-007
         (status . accepted)
         (date . "2026-01-25")
         (context . "BuckleScript (bs) naming deprecated in ReScript ecosystem")
         (decision . "Use modern .res.js suffix instead of .bs.js remove bs artifacts")
         (consequences
           ((positive . "Future-proof naming conventions")
            (positive . "Aligns with ReScript 11+ standards")
            (positive . "Clearer separation from legacy BuckleScript")
            (negative . "Breaking change for existing builds")
            (negative . "Requires rebuild of all modules"))))))
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
         . "Compile-time type safety with sound type system. TypeScript types erased at runtime. BANNED per CLAUDE.md language policy.")
       (why-deno-not-node
         . "Secure by default, no node_modules, explicit permissions, web standard APIs. No npm/Bun per CLAUDE.md.")
       (why-hono-not-express
         . "Edge-first design, faster than Express, better ReScript bindings, Deno compatible.")
       (why-mcp-not-grpc
         . "AI assistant ecosystem compatibility, simpler than gRPC, JSON-RPC 2.0 based.")
       (why-gateway-pattern
         . "Separates HTTP concerns from container runtime, allows other runtimes to use Vörðr.")
       (why-policy-at-runtime
         . "Runtime has access to attestations and image metadata, gateway only validates format.")
       (why-res-js-not-bs-js
         . "BuckleScript naming deprecated in ReScript 11+. Modern .res.js aligns with ecosystem standards.")
       (why-delete-typescript
         . "Language policy violation. 30 TS files (8,309 lines) removed. ReScript provides same functionality with better type safety.")))))
