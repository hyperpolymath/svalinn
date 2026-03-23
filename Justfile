# SPDX-License-Identifier: PMPL-1.0-or-later
# Justfile - Svalinn edge shield build orchestration

default:
    @just --list

# Development server with hot reload
dev:
    cd src && deno run --allow-net --allow-read --allow-env --watch main.ts

# Start production server
serve:
    cd src && deno run --allow-net --allow-read --allow-env main.ts

# Build ReScript sources
build-res:
    cd src && npx rescript build

# Build compiled binary
build:
    cd src && deno compile --allow-net --allow-read --allow-env -o ../dist/svalinn main.ts

# Run tests (ReScript compiled to .res.mjs — needs node_modules for @rescript/core resolution)
test:
    cd src && deno test --no-check --allow-all --node-modules-dir=auto tests/AuthTest.res.mjs tests/PolicyEvaluatorTest.res.mjs

# Type check
check:
    cd src && deno check main.ts

# Format code
fmt:
    cd src && deno fmt
    cd ui && npx rescript format src/*.res

# Check formatting without modifying
fmt-check:
    cargo fmt --all --check
# Lint code
lint:
    cd src && deno lint

# Clean build artifacts
clean:
    rm -rf dist/
    rm -rf src/**/*.res.mjs
    rm -rf ui/src/**/*.res.mjs

# Run all checks
precommit: fmt lint check test

# Build UI
build-ui:
    cd ui && npm install && npx rescript build

# Serve UI for development
dev-ui:
    cd ui && npx rescript build -w &
    cd ui && python3 -m http.server 3000 || deno run --allow-net --allow-read jsr:@std/http/file-server

# Start everything (gateway + UI)
start-all:
    just serve &
    just dev-ui

# Docker build
docker-build:
    docker build -t svalinn:latest .

# Show configuration
config:
    @echo "SVALINN_PORT=${SVALINN_PORT:-8000}"
    @echo "SVALINN_HOST=${SVALINN_HOST:-0.0.0.0}"
    @echo "VORDR_ENDPOINT=${VORDR_ENDPOINT:-http://localhost:8080}"
    @echo "SPEC_VERSION=${SPEC_VERSION:-v0.1.0}"

# Generate MCP schema
mcp-schema:
    cd src && deno run --allow-read --allow-write scripts/generate-mcp-schema.ts

# Validate spec schemas
validate-schemas:
    cd spec/schemas && for f in *.json; do echo "Validating $f..."; deno run --allow-read jsr:@std/json/validate "$f"; done

# Release a new version
release VERSION:
    @echo "Releasing {{VERSION}}..."
    git tag -a "v{{VERSION}}" -m "Release v{{VERSION}}"
    git push origin "v{{VERSION}}"

# Run panic-attacker pre-commit scan
assail:
    @command -v panic-attack >/dev/null 2>&1 && panic-attack assail . || echo "panic-attack not found — install from https://github.com/hyperpolymath/panic-attacker"
