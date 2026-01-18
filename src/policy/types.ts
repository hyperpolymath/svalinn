// SPDX-License-Identifier: PMPL-1.0-or-later
// Policy DSL types for Svalinn

/**
 * Registry rules control which container registries are allowed
 */
export interface RegistryRules {
  allow: string[];
  deny: string[];
  requireSignature: boolean;
  allowedSigners?: string[];
}

/**
 * Image rules control which images are allowed
 */
export interface ImageRules {
  allowPatterns: string[];
  denyPatterns: string[];
  requireSbom: boolean;
  maxAgeDays?: number;
  maxVulnerabilities?: {
    critical: number;
    high: number;
    medium?: number;
  };
}

/**
 * Resource limits for containers
 */
export interface ResourceRules {
  maxMemoryMb: number;
  maxCpuCores: number;
  maxContainers?: number;
  maxStorageGb?: number;
}

/**
 * Security constraints
 */
export interface SecurityRules {
  allowPrivileged: boolean;
  allowHostNetwork: boolean;
  allowHostPid: boolean;
  allowHostIpc: boolean;
  readOnlyRoot: boolean;
  dropCapabilities: string[];
  addCapabilities: string[];
  seccompProfile?: string;
  apparmorProfile?: string;
}

/**
 * Network access rules
 */
export interface NetworkRules {
  allowEgress: boolean;
  allowIngress: boolean;
  allowedPorts?: number[];
  deniedPorts?: number[];
  allowedHosts?: string[];
  deniedHosts?: string[];
}

/**
 * Complete edge policy
 */
export interface EdgePolicy {
  version: string;
  name: string;
  description?: string;
  extends?: string[];
  registries: RegistryRules;
  images: ImageRules;
  resources: ResourceRules;
  security: SecurityRules;
  network?: NetworkRules;
}

/**
 * Policy violation
 */
export interface PolicyViolation {
  rule: string;
  severity: "critical" | "high" | "medium" | "low";
  message: string;
  field?: string;
  actual?: unknown;
  expected?: unknown;
}

/**
 * Policy evaluation result
 */
export interface PolicyResult {
  allowed: boolean;
  violations: PolicyViolation[];
  appliedPolicy: string;
  evaluatedAt: string;
}

/**
 * Container request for policy evaluation
 */
export interface ContainerRequest {
  image: string;
  registry?: string;
  name?: string;
  privileged?: boolean;
  hostNetwork?: boolean;
  hostPid?: boolean;
  hostIpc?: boolean;
  readOnlyRoot?: boolean;
  memory?: number;
  cpu?: number;
  capabilities?: {
    add?: string[];
    drop?: string[];
  };
  ports?: number[];
  env?: Record<string, string>;
}
