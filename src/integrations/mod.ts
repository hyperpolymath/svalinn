// SPDX-License-Identifier: PMPL-1.0-or-later
// Svalinn Integrations - Ecosystem Connectors
//
// This module wires Svalinn to the hyperpolymath container ecosystem:
// - verified-container-spec: Protocol schemas for attestation verification
// - poly-container-mcp: AI-assisted container operations
// - cerro-torre: Supply-chain verified image building
// - vordr: Formally verified container runtime

export { VerifiedContainerSpec, type TrustStore, type AttestationBundle } from "./verified-container-spec.ts";
export { PolyContainerMcp, type ContainerRuntime } from "./poly-container-mcp.ts";
export { CerroTorre, type CtpBundle, type CtpManifest } from "./cerro-torre.ts";
