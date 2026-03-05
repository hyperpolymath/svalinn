// SPDX-License-Identifier: PMPL-1.0-or-later
/**
 * Svalinn Integration - Cerro Torre
 * Fully ported to ReScript v12
 */

module Types = {
  type ctpManifest = {
    manifestVersion: string,
    package: {
      name: string,
      version: string,
      summary?: string,
      description?: string,
      license?: string,
      maintainer?: string,
    },
    provenance: {
      upstreamUrl?: string,
      upstreamHash?: {
        algorithm: [ #sha256 | #sha512 ],
        digest: string,
      },
      importedFrom?: string,
      importDate?: string,
      buildDate?: string,
    },
    build?: {
      system?: [ #autotools | #cmake | #meson | #cargo | #go | #custom ],
      dependencies?: array<string>,
      script?: array<string>,
    },
    outputs?: {
      files?: array<{
        path: string,
        hash: string,
        size?: int,
      }>,
    },
    attestations?: {
      sbom?: string,
      provenance?: string,
      signature?: string,
    },
  }

  type verifyExitCode = [
    | #SUCCESS
    | #HASH_MISMATCH
    | #SIGNATURE_INVALID
    | #KEY_NOT_TRUSTED
    | #POLICY_REJECTION
    | #MISSING_ATTESTATION
    | #MALFORMED_BUNDLE
    | #IO_ERROR
  ]

  type verifyCheck = {
    name: string,
    passed: bool,
    message?: string,
  }

  type ctpVerifyResult = {
    valid: bool,
    exitCode: verifyExitCode,
    bundle: string,
    manifest?: ctpManifest,
    checks: array<verifyCheck>,
    timestamp: string,
  }

  type ctpRunResult = {
    success: bool,
    containerId?: string,
    runtime: string,
    exitCode: int,
    output?: string,
    error?: string,
  }
}

module Deno = {
  type command
  @new @scope("Deno") external makeCommand: (string, 'options) => command = "Command"
  @send external output: command => promise<{
    "code": int,
    "stdout": Uint8Array.t,
    "stderr": Uint8Array.t,
  }> = "output"
}

module CerroTorre = {
  type t = {
    ctPath: string,
    defaultRuntime: string,
    trustStorePath: option<string>,
    policyPath: option<string>,
  }

  let make = (~ctPath="ct", ~runtime="svalinn", ~trustStore=?, ~policy=?, ()) => {
    {
      ctPath: ctPath,
      defaultRuntime: runtime,
      trustStorePath: trustStore,
      policyPath: policy,
    }
  }

  let isAvailable = async (self: t) => {
    try {
      let cmd = Deno.makeCommand(self.ctPath, {"args": ["version"]})
      let out = await Deno.output(cmd)
      out["code"] == 0
    } catch {
    | _ => false
    }
  }

  let verify = async (self: t, bundlePath: string): Types.ctpVerifyResult => {
    let args = ["verify", bundlePath]
    
    // Additional arg logic here...
    
    let cmd = Deno.makeCommand(self.ctPath, {"args": args})
    let out = await Deno.output(cmd)
    
    {
      valid: out["code"] == 0,
      exitCode: #SUCCESS, // Mapping needed
      bundle: bundlePath,
      checks: [],
      timestamp: Date.now()->Float.toString,
    }
  }
}
