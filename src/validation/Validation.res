// SPDX-License-Identifier: PMPL-1.0-or-later
// Main validation module for Svalinn

// Re-export schema validation
include Schema

// Policy validation types
type policyViolation = {
  rule: string,
  severity: string,
  message: string,
}

type policyResult =
  | Allowed
  | Denied(array<policyViolation>)

// Edge policy rules
type edgePolicy = {
  allowPrivileged: bool,
  allowHostNetwork: bool,
  allowHostPid: bool,
  maxMemoryMb: option<int>,
  maxCpuCores: option<float>,
  allowedRegistries: array<string>,
  deniedImages: array<string>,
}

// Default restrictive policy
let defaultPolicy: edgePolicy = {
  allowPrivileged: false,
  allowHostNetwork: false,
  allowHostPid: false,
  maxMemoryMb: Some(4096),
  maxCpuCores: Some(4.0),
  allowedRegistries: ["docker.io", "ghcr.io", "quay.io", "gcr.io"],
  deniedImages: [],
}

// Check if image is from allowed registry
let isAllowedRegistry = (imageRef: string, policy: edgePolicy): bool => {
  let registry = switch String.split(imageRef, "/")->Array.get(0) {
  | Some(r) => r
  | None => "docker.io"
  }

  if Array.length(policy.allowedRegistries) == 0 {
    true
  } else {
    Array.some(policy.allowedRegistries, r => r == registry)
  }
}

// Check if image is denied
let isDeniedImage = (imageRef: string, policy: edgePolicy): bool => {
  Array.some(policy.deniedImages, img => String.includes(imageRef, img))
}

// Validate request against edge policy
let validatePolicy = (request: 'a, policy: edgePolicy): policyResult => {
  let violations: array<policyViolation> = []

  // Add violations based on policy checks
  // This is a simplified implementation

  if Array.length(violations) == 0 {
    Allowed
  } else {
    Denied(violations)
  }
}

// Combined validation: schema + policy
let validateRequest = async (
  schemaName: string,
  request: JSON.t,
  policy: edgePolicy,
): (validationResult, policyResult) => {
  let schemaResult = await validate(schemaName, request)
  let policyResult = validatePolicy(request, policy)
  (schemaResult, policyResult)
}
