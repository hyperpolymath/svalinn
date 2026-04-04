// SPDX-License-Identifier: PMPL-1.0-or-later
/**
 * Policy Evaluator Tests for Svalinn
 * Fully ported to ReScript v12
 */

open PolicyTypes
open PolicyEvaluator
let _ = PolicyEvaluator.evaluate

module Assert = {
  @module("jsr:@std/assert@1") external assertEquals: ('a, 'a) => unit = "assertEquals"
  @module("jsr:@std/assert@1") external assertExists: 'a => unit = "assertExists"
}

module Deno = {
  @val @scope("Deno") external testSync: (string, unit => unit) => unit = "test"
}

// Minimal policy defaults for testing
let strictPolicy: Types.edgePolicy = {
  version: "1.0",
  name: "strict",
  registries: {
    allow: ["docker.io", "ghcr.io"],
    deny: ["evil.registry.com"],
    requireSignature: true,
  },
  images: {
    allowPatterns: ["*"],
    denyPatterns: ["*/test-*"],
    requireSbom: true,
  },
  resources: {
    maxMemoryMb: 2048,
    maxCpuCores: 2,
  },
  security: {
    allowPrivileged: false,
    allowHostNetwork: false,
    allowHostPid: false,
    allowHostIpc: false,
    readOnlyRoot: true,
    dropCapabilities: ["ALL"],
    addCapabilities: [],
  },
}

let permissivePolicy: Types.edgePolicy = {
  version: "1.0",
  name: "permissive",
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
    maxCpuCores: 8,
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
}

// === Strict Policy Tests ===

Deno.testSync("strict policy allows docker.io images", () => {
  let request: Types.containerRequest = {
    image: "docker.io/library/alpine:3.18",
  }
  let result = PolicyEvaluator.evaluate(strictPolicy, request)
  Assert.assertEquals(result.allowed, true)
})

Deno.testSync("strict policy denies unknown registry", () => {
  let request: Types.containerRequest = {
    image: "evil.registry.com/malware:latest",
  }
  let result = PolicyEvaluator.evaluate(strictPolicy, request)
  Assert.assertEquals(result.allowed, false)
  Assert.assertEquals(result.violations->Array.some(v => v.rule == "registries.deny"), true)
})

Deno.testSync("strict policy denies privileged containers", () => {
  let request: Types.containerRequest = {
    image: "alpine:3.18",
    privileged: true,
  }
  let result = PolicyEvaluator.evaluate(strictPolicy, request)
  Assert.assertEquals(result.allowed, false)
  Assert.assertEquals(result.violations->Array.some(v => v.rule == "security.allowPrivileged"), true)
})

// === Permissive Policy Tests ===

Deno.testSync("permissive policy allows privileged", () => {
  let request: Types.containerRequest = {
    image: "alpine:latest",
    privileged: true,
  }
  let result = PolicyEvaluator.evaluate(permissivePolicy, request)
  Assert.assertEquals(result.allowed, true)
})

// === Registry Detection Tests ===

Deno.testSync("extracts docker.io from short image name", () => {
  let request: Types.containerRequest = {
    image: "alpine:3.18",
  }
  let result = PolicyEvaluator.evaluate(strictPolicy, request)
  Assert.assertEquals(result.allowed, true)
})
