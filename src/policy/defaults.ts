// SPDX-License-Identifier: PMPL-1.0-or-later
// Default policies for Svalinn

import type { EdgePolicy } from "./types.ts";

/**
 * Strict policy - Maximum security
 * Suitable for production environments
 */
export const strictPolicy: EdgePolicy = {
  version: "1.0",
  name: "strict",
  description: "Maximum security policy for production",
  registries: {
    allow: ["docker.io", "ghcr.io", "quay.io", "gcr.io"],
    deny: [],
    requireSignature: true,
    allowedSigners: [],
  },
  images: {
    allowPatterns: ["*"],
    denyPatterns: ["*/test-*", "*/dev-*", "*:latest"],
    requireSbom: true,
    maxAgeDays: 90,
    maxVulnerabilities: {
      critical: 0,
      high: 0,
    },
  },
  resources: {
    maxMemoryMb: 2048,
    maxCpuCores: 2.0,
    maxContainers: 50,
    maxStorageGb: 10,
  },
  security: {
    allowPrivileged: false,
    allowHostNetwork: false,
    allowHostPid: false,
    allowHostIpc: false,
    readOnlyRoot: true,
    dropCapabilities: ["ALL"],
    addCapabilities: ["NET_BIND_SERVICE"],
  },
  network: {
    allowEgress: true,
    allowIngress: false,
    allowedPorts: [80, 443, 8080, 8443],
    deniedPorts: [22, 23, 3389],
    deniedHosts: ["*.internal", "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"],
  },
  verification: {
    signatureAlgorithms: ["ed25519", "ml-dsa-87"],
    transparencyLogs: {
      required: ["rekor", "sigstore"],
      quorum: 1,
    },
    sbomRequired: true,
    sbomFormats: ["spdx", "cyclonedx"],
    provenanceLevel: 3,
    maxSignatureAgeDays: 90,
    keyTrustLevel: "trusted-keyring",
    requiredPredicates: [
      "https://slsa.dev/provenance/v1",
      "https://spdx.dev/Document",
    ],
  },
};

/**
 * Standard policy - Balanced security
 * Suitable for staging environments
 */
export const standardPolicy: EdgePolicy = {
  version: "1.0",
  name: "standard",
  description: "Balanced security policy",
  registries: {
    allow: ["docker.io", "ghcr.io", "quay.io", "gcr.io"],
    deny: [],
    requireSignature: false,
  },
  images: {
    allowPatterns: ["*"],
    denyPatterns: [],
    requireSbom: false,
    maxAgeDays: 180,
    maxVulnerabilities: {
      critical: 0,
      high: 5,
    },
  },
  resources: {
    maxMemoryMb: 4096,
    maxCpuCores: 4.0,
    maxContainers: 100,
    maxStorageGb: 50,
  },
  security: {
    allowPrivileged: false,
    allowHostNetwork: false,
    allowHostPid: false,
    allowHostIpc: false,
    readOnlyRoot: false,
    dropCapabilities: ["SYS_ADMIN", "NET_ADMIN"],
    addCapabilities: [],
  },
  network: {
    allowEgress: true,
    allowIngress: true,
    allowedPorts: [],
    deniedPorts: [],
  },
  verification: {
    signatureAlgorithms: ["ed25519", "ecdsa-p256", "rsa-4096", "ml-dsa-65", "ml-dsa-87"],
    transparencyLogs: {
      required: ["rekor"],
      quorum: 1,
    },
    sbomRequired: false,
    provenanceLevel: 2,
    maxSignatureAgeDays: 180,
    keyTrustLevel: "organization",
  },
};

/**
 * Permissive policy - Development only
 * NOT suitable for production
 */
export const permissivePolicy: EdgePolicy = {
  version: "1.0",
  name: "permissive",
  description: "Permissive policy for development only - NOT FOR PRODUCTION",
  registries: {
    allow: [],
    deny: [],
    requireSignature: false,
  },
  images: {
    allowPatterns: ["*"],
    denyPatterns: [],
    requireSbom: false,
  },
  resources: {
    maxMemoryMb: 16384,
    maxCpuCores: 16.0,
    maxContainers: 500,
    maxStorageGb: 500,
  },
  security: {
    allowPrivileged: true,
    allowHostNetwork: true,
    allowHostPid: true,
    allowHostIpc: true,
    readOnlyRoot: false,
    dropCapabilities: [],
    addCapabilities: [],
  },
  network: {
    allowEgress: true,
    allowIngress: true,
  },
};

/**
 * Get policy by name
 */
export function getDefaultPolicy(name: string): EdgePolicy | null {
  switch (name) {
    case "strict":
      return strictPolicy;
    case "standard":
      return standardPolicy;
    case "permissive":
      return permissivePolicy;
    default:
      return null;
  }
}

/**
 * List available default policies
 */
export function listDefaultPolicies(): string[] {
  return ["strict", "standard", "permissive"];
}
