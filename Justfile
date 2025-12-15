# Svalinn Ecosystem - Root Justfile
# SPDX-License-Identifier: MIT OR AGPL-3.0-or-later

set shell := ["bash", "-euo", "pipefail", "-c"]

default:
    @just --list --unsorted

# === BOOTSTRAP ===

# Create the complete directory structure
genesis:
    #!/usr/bin/env bash
    set -euo pipefail
    echo "SVALINN ECOSYSTEM - Genesis"
    echo "============================"
    mkdir -p vordr/src/{cli,engine,ffi,runtime,network,registry,mcp}
    mkdir -p vordr/spark_core/src
    mkdir -p vordr/proto
    mkdir -p svalinn/src
    mkdir -p shared/policies
    mkdir -p words/styles
    mkdir -p .meta
    mkdir -p config/dns
    mkdir -p scripts
    echo "Directory structure created"
    touch vordr/src/main.rs
    touch vordr/spark_core/src/.gitkeep
    touch svalinn/src/Main.res
    touch shared/schema.cue
    touch .meta/META.scm
    touch .meta/ECOSYSTEM.scm
    touch .meta/STATE.scm
    echo "Placeholder files created"
    echo ""
    echo "Next steps:"
    echo "  1. cd vordr && cargo init --name vordr"
    echo "  2. Create vordr/spark_core/policy.gpr"
    echo "  3. just check-toolchain"

# Verify required tools are installed
check-toolchain:
    #!/usr/bin/env bash
    set -euo pipefail
    echo "Checking toolchain..."
    if command -v rustc &> /dev/null; then
        echo "Rust: $(rustc --version)"
    else
        echo "Rust not found - install via rustup"
        exit 1
    fi
    if command -v gnatprove &> /dev/null; then
        echo "GNATprove: $(gnatprove --version | head -1)"
    else
        echo "GNATprove not found - SPARK verification unavailable"
    fi
    if command -v gprbuild &> /dev/null; then
        echo "GPRbuild: $(gprbuild --version | head -1)"
    else
        echo "GPRbuild not found - Ada compilation unavailable"
    fi
    if pkg-config --exists sqlite3 2>/dev/null; then
        echo "SQLite: $(pkg-config --modversion sqlite3)"
    else
        echo "SQLite dev headers not found"
    fi
    if command -v netavark &> /dev/null; then
        echo "Netavark: $(netavark --version)"
    else
        echo "Netavark not found (optional)"
    fi
    if command -v youki &> /dev/null; then
        echo "youki: $(youki --version)"
    else
        echo "youki not found (optional, will use runc)"
    fi
    echo "Toolchain check complete."

# === VORDR (Core) ===

# Build Vordr (includes SPARK verification if available)
build-vordr:
    cd vordr && cargo build --release

# Build Vordr without SPARK verification (faster iteration)
build-vordr-quick:
    cd vordr && SKIP_SPARK_VERIFY=1 cargo build

# Run SPARK proofs only
prove:
    cd vordr/spark_core && gnatprove -P policy.gpr --level=2 --prover=all

# Run all Vordr tests
test-vordr:
    cd vordr && cargo test

# === CODE QUALITY ===

# Format all Rust code
fmt:
    cd vordr && cargo fmt

# Lint all Rust code
lint:
    cd vordr && cargo clippy -- -D warnings

# Check Ada style
ada-style:
    cd vordr/spark_core && gnatpp -P policy.gpr --check

# Full verification pipeline
verify: prove lint test-vordr
    @echo "All verifications passed"

# === DOCUMENTATION ===

# Build documentation
docs:
    cd vordr && cargo doc --no-deps --open

# === DEVELOPMENT ===

# Watch for changes and rebuild
watch:
    cd vordr && cargo watch -x build

# Run Vordr in debug mode
run-debug *ARGS:
    cd vordr && cargo run -- {{ARGS}}

# === META ===

# Dump project context for AI assistants
reflect:
    @echo "=== PROJECT CONTEXT ==="
    @echo ""
    @echo "--- META ---"
    @cat .meta/META.scm 2>/dev/null || echo "(not yet created)"
    @echo ""
    @echo "--- STATE ---"
    @cat .meta/STATE.scm 2>/dev/null || echo "(not yet created)"
    @echo ""
    @echo "--- ECOSYSTEM ---"
    @cat .meta/ECOSYSTEM.scm 2>/dev/null || echo "(not yet created)"

# === DEPLOYMENT ===

# Deploy Vordr to VPS
deploy-warden user host:
    scp vordr/target/release/vordr {{user}}@{{host}}:/usr/local/bin/
    ssh {{user}}@{{host}} 'sudo systemctl daemon-reload && sudo systemctl restart vordr'

# === CLEANUP ===

# Clean all build artifacts
clean:
    cd vordr && cargo clean
    rm -rf vordr/spark_core/obj vordr/spark_core/lib vordr/spark_core/.gnatprove
