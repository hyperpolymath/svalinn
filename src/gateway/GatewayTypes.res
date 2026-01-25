// SPDX-License-Identifier: PMPL-1.0-or-later
// Gateway types for Svalinn edge shield

// Container information
type containerState =
  | @as("created") Created
  | @as("running") Running
  | @as("paused") Paused
  | @as("stopped") Stopped
  | @as("removed") Removed

type containerInfo = {
  id: string,
  name: string,
  image: string,
  imageDigest: string,
  state: containerState,
  policyVerdict: string,
  createdAt: option<string>,
  startedAt: option<string>,
}

// Image information
type imageInfo = {
  name: string,
  tag: string,
  digest: string,
  verified: bool,
  size: option<int>,
}

// Run request
type runRequest = {
  imageName: string,
  imageDigest: string,
  name: option<string>,
  command: option<array<string>>,
  env: option<Dict.t<string>>,
  detach: option<bool>,
  removeOnExit: option<bool>,
  profile: option<string>,
}

// Verify request
type verifyRequest = {
  imageRef: string,
  checkSbom: option<bool>,
  checkSignature: option<bool>,
}

// Verification result
type verificationResult = {
  verified: bool,
  imageRef: string,
  digest: string,
  sbom: option<{
    format: string,
    vulnerabilities: int,
    critical: int,
    high: int,
  }>,
  signature: option<{
    valid: bool,
    signer: option<string>,
    timestamp: option<string>,
  }>,
}

// Health check response
type healthResponse = {
  status: string,
  version: string,
  vordrConnected: bool,
  timestamp: string,
}

// Error response
type errorResponse = {
  code: string,
  message: string,
  details: option<JSON.t>,
}

// API response wrapper
type apiResponse<'a> =
  | Ok('a)
  | Error(errorResponse)
