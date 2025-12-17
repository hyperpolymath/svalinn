;; SPDX-License-Identifier: MIT OR AGPL-3.0-or-later
;; Svalinn Core — Project State
;; Format: S-expression for LLM context injection

(project
  (name "Svalinn Core / Vordr")
  (version "0.1.0")
  (status "implementation-in-progress")
  (updated "2025-12-17"))

(implementation-status
  (architecture . complete)
  (gatekeeper-design . complete)
  (gatekeeper-spark . complete)
  (rust-ffi . complete)
  (state-manager . complete)
  (cli-skeleton . complete)
  (oci-config . complete)
  (lifecycle . complete)
  (runtime-shim . complete)
  (networking . complete)
  (registry-client . complete)
  (mcp-server . complete)
  (security-validation . complete)
  (integration-testing . pending)
  (documentation . pending))

(recent-changes
  (2025-12-17
    ("Fixed OCI capability type handling for oci-spec 0.7")
    ("Fixed rusqlite lifetime issues in list_containers")
    ("Added security validation module with path traversal protection")
    ("Added TOCTOU race condition mitigations")
    ("Fixed unsafe unwrap calls with proper error handling")))

(decisions-locked
  (languages
    (primary "Rust" "CLI, I/O, async, ecosystem")
    (verified "Ada/SPARK" "security policy, OCI validation")
    (build "Justfile" "orchestration")
    (scripts-simple "Bash" "<50 lines")
    (scripts-complex "Oil Shell" ">50 lines")
    (prohibited "Python" "TypeScript" "C" "C++" "Go"))

  (storage-communication
    (database "SQLite" "WAL mode, DELETE fallback for NFS")
    (ipc "TTRPC" "Unix domain sockets")
    (runtime "youki" "Rust OCI runtime")
    (networking "Netavark" "Rust network stack"))

  (naming
    (ecosystem "Svalinn Project")
    (edge-layer "Svalinn" "The Shield" "Rescript/Deno")
    (core-layer "Vordr" "The Warden" "Rust/SPARK")
    (docs-layer "Words" "AsciiDoc only")
    (domain "svalinnproject.org"))

  (security-model
    (perimeter-1 "Core" "GPG commits, 2-person review")
    (perimeter-2 "Edge" "High scrutiny")
    (perimeter-3 "Public" "Open contribution")
    (gatekeeper "All OCI configs validated through SPARK before execution")
    (proof-level "gnatprove --level=2")
    (validation "Input validation for names, paths, and image references")))

(rust-crates
  (oci-spec "0.7" "OCI runtime/image spec types")
  (ttrpc "0.8" "Lightweight RPC for shims")
  (rusqlite "0.32" "SQLite bindings, bundled")
  (tokio "1.x" "Async runtime")
  (clap "4.x" "CLI argument parsing with env support")
  (serde "1.x" "Serialisation")
  (serde_json "1.x" "JSON serialisation")
  (thiserror "2.x" "Error derive macro")
  (anyhow "1.x" "Error handling")
  (reqwest "0.12" "HTTP client for registry")
  (uuid "1.x" "UUID generation")
  (sha2 "0.10" "SHA-256 hashing")
  (hex "0.4" "Hex encoding"))

(spark-packages
  (Container_Policy "Security predicate definitions, capability validation")
  (OCI_Parser "JSON parsing with AoRTE guarantees")
  (Policy_Interface "C-compatible FFI exports for Rust"))

(roadmap
  (milestone-0.1 "Foundation" "complete"
    (tasks
      ("Core architecture design" . complete)
      ("CLI skeleton with clap 4" . complete)
      ("SQLite state management" . complete)
      ("SPARK gatekeeper design" . complete)
      ("Security validation module" . complete)))

  (milestone-0.2 "Runtime Integration"
    (tasks
      ("youki runtime integration" . in-progress)
      ("Container lifecycle management" . complete)
      ("Image layer extraction" . pending)
      ("TTRPC shim communication" . pending)))

  (milestone-0.3 "Networking & Storage"
    (tasks
      ("Netavark network management" . in-progress)
      ("Volume management" . complete)
      ("Port publishing" . pending)
      ("DNS resolution" . pending)))

  (milestone-0.4 "Registry & Images"
    (tasks
      ("OCI registry client" . in-progress)
      ("Image pulling with auth" . pending)
      ("Layer caching" . pending)
      ("Image verification" . pending)))

  (milestone-0.5 "Production Readiness"
    (tasks
      ("SPARK formal verification" . pending)
      ("Integration testing" . pending)
      ("Performance optimization" . pending)
      ("Documentation" . pending)
      ("Security audit" . complete))))

(next-steps
  (immediate
    ("Install GNAT/SPARK toolchain for full verification")
    ("Write integration tests with youki runtime")
    ("Complete image layer extraction"))
  (short-term
    ("Add image pulling from registries")
    ("Implement TTRPC shim communication")
    ("Add port publishing support"))
  (medium-term
    ("Run gnatprove for formal verification")
    ("Performance benchmarking")
    ("Complete documentation")))

(references
  (oci-runtime-spec "https://github.com/opencontainers/runtime-spec")
  (oci-image-spec "https://github.com/opencontainers/image-spec")
  (spark-user-guide "https://docs.adacore.com/spark2014-docs/html/ug/")
  (youki-docs "https://youki-dev.github.io/youki/")
  (netavark "https://github.com/containers/netavark")
  (ttrpc-rust "https://github.com/containerd/ttrpc-rust")
  (sqlite-wal "https://sqlite.org/wal.html"))

;; End of STATE.scm
