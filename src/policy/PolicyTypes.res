// SPDX-License-Identifier: PMPL-1.0-or-later
/**
 * Policy DSL Types for Svalinn
 * Fully ported to ReScript v12
 */

module Types = {
  type signatureAlgorithm = [
    | #ed25519
    | #"ecdsa-p256"
    | #"ecdsa-p384"
    | #"rsa-2048"
    | #"rsa-4096"
    | #"ml-dsa-44"
    | #"ml-dsa-65"
    | #"ml-dsa-87"
    | #"ct-sig-02"
    | #"slh-dsa-shake-128f"
    | #"slh-dsa-shake-256f"
  ]

  type transparencyLog = [
    | #rekor
    | #"ct-tlog"
    | #sigstore
    | #trillian
    | #arweave
    | #custom
  ]

  type slsaLevel = [ #1 | #2 | #3 | #4 ]

  type keyTrustLevel = [
    | #untrusted
    | #"self-signed"
    | #organization
    | #"trusted-keyring"
    | #"hardware-backed"
    | #"fulcio-verified"
  ]

  type transparencyLogRules = {
    required: array<transparencyLog>,
    quorum?: int,
  }

  type verificationRules = {
    signatureAlgorithms?: array<signatureAlgorithm>,
    transparencyLogs?: transparencyLogRules,
    sbomRequired?: bool,
    sbomFormats?: array<[ #spdx | #cyclonedx | #syft ]>,
    provenanceLevel?: slsaLevel,
    maxSignatureAgeDays?: int,
    keyTrustLevel?: keyTrustLevel,
    allowedKeyIds?: array<string>,
    requiredPredicates?: array<string>,
  }

  type registryRules = {
    allow: array<string>,
    deny: array<string>,
    requireSignature: bool,
    allowedSigners?: array<string>,
  }

  type maxVulnerabilities = {
    critical: int,
    high: int,
    medium?: int,
  }

  type imageRules = {
    allowPatterns: array<string>,
    denyPatterns: array<string>,
    requireSbom: bool,
    maxAgeDays?: int,
    maxVulnerabilities?: maxVulnerabilities,
  }

  type resourceRules = {
    maxMemoryMb: int,
    maxCpuCores: int,
    maxContainers?: int,
    maxStorageGb?: int,
  }

  type securityRules = {
    allowPrivileged: bool,
    allowHostNetwork: bool,
    allowHostPid: bool,
    allowHostIpc: bool,
    readOnlyRoot: bool,
    dropCapabilities: array<string>,
    addCapabilities: array<string>,
    seccompProfile?: string,
    apparmorProfile?: string,
  }

  type networkRules = {
    allowEgress: bool,
    allowIngress: bool,
    allowedPorts?: array<int>,
    deniedPorts?: array<int>,
    allowedHosts?: array<string>,
    deniedHosts?: array<string>,
  }

  type edgePolicy = {
    version: string,
    name: string,
    description?: string,
    @as("extends") extends_?: array<string>,
    registries: registryRules,
    images: imageRules,
    resources: resourceRules,
    security: securityRules,
    network?: networkRules,
    verification?: verificationRules,
  }

  type severity = [ #critical | #high | #medium | #low ]

  type policyViolation = {
    rule: string,
    severity: severity,
    message: string,
    field?: string,
    actual?: JSON.t,
    expected?: JSON.t,
  }

  type policyResult = {
    allowed: bool,
    violations: array<policyViolation>,
    appliedPolicy: string,
    evaluatedAt: string,
  }

  type transparencyLogEntry = {
    log: transparencyLog,
    entryId?: string,
    timestamp?: string,
  }

  type attestationContext = {
    signatureAlgorithm?: signatureAlgorithm,
    transparencyLogEntries?: array<transparencyLogEntry>,
    hasSbom?: bool,
    sbomFormat?: [ #spdx | #cyclonedx | #syft ],
    slsaLevel?: slsaLevel,
    signedAt?: string,
    keyTrustLevel?: keyTrustLevel,
    keyId?: string,
    predicateTypes?: array<string>,
  }

  type containerRequest = {
    image: string,
    registry?: string,
    name?: string,
    privileged?: bool,
    hostNetwork?: bool,
    hostPid?: bool,
    hostIpc?: bool,
    readOnlyRoot?: bool,
    memory?: int,
    cpu?: int,
    capabilities?: {"add": option<array<string>>, "drop": option<array<string>>},
    ports?: array<int>,
    env?: Dict.t<string>,
    attestation?: attestationContext,
  }
}
