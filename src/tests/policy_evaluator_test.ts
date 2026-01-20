// SPDX-License-Identifier: PMPL-1.0-or-later
// Policy evaluator tests

import { assertEquals, assertExists } from "jsr:@std/assert@1";
import { evaluate } from "../policy/evaluator.ts";
import { permissivePolicy, standardPolicy, strictPolicy } from "../policy/defaults.ts";
import type { AttestationContext, ContainerRequest } from "../policy/types.ts";

/**
 * Generate a valid attestation context that passes strict policy verification
 */
function createValidStrictAttestation(): AttestationContext {
  const signedAt = new Date();
  signedAt.setDate(signedAt.getDate() - 5); // 5 days ago (within 90 day limit)

  return {
    signatureAlgorithm: "ed25519",
    transparencyLogEntries: [{ log: "rekor", entryId: "abc123" }],
    hasSbom: true,
    sbomFormat: "spdx",
    slsaLevel: 3,
    signedAt: signedAt.toISOString(),
    keyTrustLevel: "trusted-keyring",
    predicateTypes: [
      "https://slsa.dev/provenance/v1",
      "https://spdx.dev/Document",
    ],
  };
}

/**
 * Generate a valid attestation context that passes standard policy verification
 */
function createValidStandardAttestation(): AttestationContext {
  const signedAt = new Date();
  signedAt.setDate(signedAt.getDate() - 30); // 30 days ago (within 180 day limit)

  return {
    signatureAlgorithm: "ed25519",
    transparencyLogEntries: [{ log: "rekor", entryId: "abc123" }],
    slsaLevel: 2,
    signedAt: signedAt.toISOString(),
    keyTrustLevel: "organization",
  };
}

// === Strict Policy Tests ===

Deno.test("strict policy allows docker.io images", () => {
  const request: ContainerRequest = {
    image: "docker.io/library/alpine:3.18",
    attestation: createValidStrictAttestation(),
  };
  const result = evaluate(strictPolicy, request);
  assertEquals(result.allowed, true);
});

Deno.test("strict policy denies unknown registry", () => {
  const request: ContainerRequest = {
    image: "evil.registry.com/malware:latest",
  };
  const result = evaluate(strictPolicy, request);
  assertEquals(result.allowed, false);
  assertEquals(result.violations.some((v) => v.rule === "registries.allow"), true);
});

Deno.test("strict policy denies test images", () => {
  const request: ContainerRequest = {
    image: "docker.io/myorg/test-app:v1",
  };
  const result = evaluate(strictPolicy, request);
  assertEquals(result.allowed, false);
  assertEquals(result.violations.some((v) => v.rule === "images.denyPatterns"), true);
});

Deno.test("strict policy denies latest tag", () => {
  const request: ContainerRequest = {
    image: "alpine:latest",
  };
  const result = evaluate(strictPolicy, request);
  assertEquals(result.allowed, false);
});

Deno.test("strict policy denies privileged containers", () => {
  const request: ContainerRequest = {
    image: "alpine:3.18",
    privileged: true,
  };
  const result = evaluate(strictPolicy, request);
  assertEquals(result.allowed, false);
  assertEquals(result.violations.some((v) => v.rule === "security.allowPrivileged"), true);
});

Deno.test("strict policy denies host network", () => {
  const request: ContainerRequest = {
    image: "alpine:3.18",
    hostNetwork: true,
  };
  const result = evaluate(strictPolicy, request);
  assertEquals(result.allowed, false);
});

Deno.test("strict policy denies host PID", () => {
  const request: ContainerRequest = {
    image: "alpine:3.18",
    hostPid: true,
  };
  const result = evaluate(strictPolicy, request);
  assertEquals(result.allowed, false);
});

Deno.test("strict policy denies excessive memory", () => {
  const request: ContainerRequest = {
    image: "alpine:3.18",
    memory: 8192,
  };
  const result = evaluate(strictPolicy, request);
  assertEquals(result.allowed, false);
  assertEquals(result.violations.some((v) => v.rule === "resources.maxMemoryMb"), true);
});

Deno.test("strict policy denies SSH port", () => {
  const request: ContainerRequest = {
    image: "alpine:3.18",
    ports: [22],
  };
  const result = evaluate(strictPolicy, request);
  assertEquals(result.allowed, false);
});

// === Standard Policy Tests ===

Deno.test("standard policy allows latest tag", () => {
  const request: ContainerRequest = {
    image: "alpine:latest",
    attestation: createValidStandardAttestation(),
  };
  const result = evaluate(standardPolicy, request);
  assertEquals(result.allowed, true);
});

Deno.test("standard policy allows more memory", () => {
  const request: ContainerRequest = {
    image: "alpine:3.18",
    memory: 4096,
    attestation: createValidStandardAttestation(),
  };
  const result = evaluate(standardPolicy, request);
  assertEquals(result.allowed, true);
});

Deno.test("standard policy still denies privileged", () => {
  const request: ContainerRequest = {
    image: "alpine:3.18",
    privileged: true,
    attestation: createValidStandardAttestation(),
  };
  const result = evaluate(standardPolicy, request);
  assertEquals(result.allowed, false);
});

// === Permissive Policy Tests ===

Deno.test("permissive policy allows any registry", () => {
  const request: ContainerRequest = {
    image: "any.registry.com/any-image:any-tag",
  };
  const result = evaluate(permissivePolicy, request);
  assertEquals(result.allowed, true);
});

Deno.test("permissive policy allows privileged", () => {
  const request: ContainerRequest = {
    image: "alpine:latest",
    privileged: true,
  };
  const result = evaluate(permissivePolicy, request);
  assertEquals(result.allowed, true);
});

Deno.test("permissive policy allows host network", () => {
  const request: ContainerRequest = {
    image: "alpine:latest",
    hostNetwork: true,
  };
  const result = evaluate(permissivePolicy, request);
  assertEquals(result.allowed, true);
});

// === Policy Result Structure Tests ===

Deno.test("policy result has required fields", () => {
  const request: ContainerRequest = {
    image: "alpine:3.18",
  };
  const result = evaluate(strictPolicy, request);

  assertExists(result.allowed);
  assertExists(result.violations);
  assertExists(result.appliedPolicy);
  assertExists(result.evaluatedAt);
  assertEquals(result.appliedPolicy, "strict");
});

Deno.test("violation has required fields", () => {
  const request: ContainerRequest = {
    image: "evil.registry.com/image:v1",
  };
  const result = evaluate(strictPolicy, request);

  assertEquals(result.violations.length > 0, true);
  const violation = result.violations[0];
  assertExists(violation.rule);
  assertExists(violation.severity);
  assertExists(violation.message);
});

// === Registry Detection Tests ===

Deno.test("extracts docker.io from short image name", () => {
  const request: ContainerRequest = {
    image: "alpine:3.18",
    attestation: createValidStrictAttestation(),
  };
  const result = evaluate(strictPolicy, request);
  assertEquals(result.allowed, true);
});

Deno.test("extracts docker.io from namespaced image", () => {
  const request: ContainerRequest = {
    image: "library/alpine:3.18",
    attestation: createValidStrictAttestation(),
  };
  const result = evaluate(strictPolicy, request);
  assertEquals(result.allowed, true);
});

Deno.test("extracts ghcr.io from full path", () => {
  const request: ContainerRequest = {
    image: "ghcr.io/myorg/myapp:v1.0.0",
    attestation: createValidStrictAttestation(),
  };
  const result = evaluate(strictPolicy, request);
  assertEquals(result.allowed, true);
});
