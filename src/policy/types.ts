// SPDX-License-Identifier: PMPL-1.0-or-later
// Policy DSL types for Svalinn

/**
 * Supported signature algorithms for verification
 */
export type SignatureAlgorithm =
  | "ed25519"
  | "ecdsa-p256"
  | "ecdsa-p384"
  | "rsa-2048"
  | "rsa-4096"
  | "ml-dsa-44"
  | "ml-dsa-65"
  | "ml-dsa-87"
  | "ct-sig-02"
  | "slh-dsa-shake-128f"
  | "slh-dsa-shake-256f";

/**
 * Supported transparency logs
 */
export type TransparencyLog =
  | "rekor"
  | "ct-tlog"
  | "sigstore"
  | "trillian"
  | "arweave"
  | "custom";

/**
 * SLSA provenance levels (1-4)
 */
export type SlsaLevel = 1 | 2 | 3 | 4;

/**
 * Key trust levels for verification
 */
export type KeyTrustLevel =
  | "untrusted"
  | "self-signed"
  | "organization"
  | "trusted-keyring"
  | "hardware-backed"
  | "fulcio-verified";

/**
 * Verification rules for cryptographic attestations
 */
export interface VerificationRules {
  /**
   * Required signature algorithms - at least one must match
   */
  signatureAlgorithms?: SignatureAlgorithm[];

  /**
   * Required transparency logs - entries must exist in all specified logs
   */
  transparencyLogs?: {
    required: TransparencyLog[];
    quorum?: number; // Minimum logs that must contain the entry
  };

  /**
   * Require SBOM attestation to be present
   */
  sbomRequired?: boolean;

  /**
   * Accepted SBOM formats when sbomRequired is true
   */
  sbomFormats?: ("spdx" | "cyclonedx" | "syft")[];

  /**
   * Minimum required SLSA provenance level
   */
  provenanceLevel?: SlsaLevel;

  /**
   * Maximum age of signature in days
   */
  maxSignatureAgeDays?: number;

  /**
   * Minimum required key trust level
   */
  keyTrustLevel?: KeyTrustLevel;

  /**
   * Allowed key IDs (SHA256 fingerprints)
   */
  allowedKeyIds?: string[];

  /**
   * Required predicate types (URIs)
   */
  requiredPredicates?: string[];
}

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
  verification?: VerificationRules;
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
 * Attestation context for verification
 */
export interface AttestationContext {
  /**
   * Signature algorithm used
   */
  signatureAlgorithm?: SignatureAlgorithm;

  /**
   * Transparency log entries
   */
  transparencyLogEntries?: {
    log: TransparencyLog;
    entryId?: string;
    timestamp?: string;
  }[];

  /**
   * Whether SBOM attestation is present
   */
  hasSbom?: boolean;

  /**
   * SBOM format if present
   */
  sbomFormat?: "spdx" | "cyclonedx" | "syft";

  /**
   * SLSA provenance level achieved
   */
  slsaLevel?: SlsaLevel;

  /**
   * Signature timestamp (ISO 8601)
   */
  signedAt?: string;

  /**
   * Key trust level of the signer
   */
  keyTrustLevel?: KeyTrustLevel;

  /**
   * Key ID (SHA256 fingerprint) of the signer
   */
  keyId?: string;

  /**
   * Predicate types present in attestation bundle
   */
  predicateTypes?: string[];
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
  attestation?: AttestationContext;
}
