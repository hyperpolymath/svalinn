// SPDX-License-Identifier: PMPL-1.0-or-later
// Verification rules tests for Svalinn policy engine

import { assertEquals, assertExists } from "jsr:@std/assert@1";
import { evaluate } from "../policy/evaluator.ts";
import type { AttestationContext, ContainerRequest, EdgePolicy } from "../policy/types.ts";

/**
 * Create a minimal valid policy with optional verification overrides
 */
function createTestPolicy(
  verification?: EdgePolicy["verification"],
): EdgePolicy {
  return {
    version: "1.0",
    name: "test-policy",
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
      maxMemoryMb: 4096,
      maxCpuCores: 4.0,
    },
    security: {
      allowPrivileged: false,
      allowHostNetwork: false,
      allowHostPid: false,
      allowHostIpc: false,
      readOnlyRoot: false,
      dropCapabilities: [],
      addCapabilities: [],
    },
    verification,
  };
}

/**
 * Create a minimal valid request with optional attestation context
 */
function createTestRequest(attestation?: AttestationContext): ContainerRequest {
  return {
    image: "alpine:3.18",
    attestation,
  };
}

// === Signature Algorithm Tests ===

Deno.test("verification.signatureAlgorithms: allows ed25519 when required", () => {
  const policy = createTestPolicy({
    signatureAlgorithms: ["ed25519"],
  });
  const request = createTestRequest({
    signatureAlgorithm: "ed25519",
  });

  const result = evaluate(policy, request);
  assertEquals(result.allowed, true);
  assertEquals(
    result.violations.filter((v) => v.rule === "verification.signatureAlgorithms").length,
    0,
  );
});

Deno.test("verification.signatureAlgorithms: denies wrong algorithm", () => {
  const policy = createTestPolicy({
    signatureAlgorithms: ["ed25519", "ml-dsa-87"],
  });
  const request = createTestRequest({
    signatureAlgorithm: "rsa-2048",
  });

  const result = evaluate(policy, request);
  assertEquals(result.allowed, false);
  assertEquals(
    result.violations.some((v) => v.rule === "verification.signatureAlgorithms"),
    true,
  );
});

Deno.test("verification.signatureAlgorithms: denies missing algorithm", () => {
  const policy = createTestPolicy({
    signatureAlgorithms: ["ed25519"],
  });
  const request = createTestRequest({});

  const result = evaluate(policy, request);
  assertEquals(result.allowed, false);
  assertEquals(
    result.violations.some(
      (v) =>
        v.rule === "verification.signatureAlgorithms" &&
        v.message.includes("not provided"),
    ),
    true,
  );
});

Deno.test("verification.signatureAlgorithms: allows post-quantum ml-dsa-87", () => {
  const policy = createTestPolicy({
    signatureAlgorithms: ["ml-dsa-87"],
  });
  const request = createTestRequest({
    signatureAlgorithm: "ml-dsa-87",
  });

  const result = evaluate(policy, request);
  assertEquals(result.allowed, true);
});

Deno.test("verification.signatureAlgorithms: allows ct-sig-02", () => {
  const policy = createTestPolicy({
    signatureAlgorithms: ["ct-sig-02"],
  });
  const request = createTestRequest({
    signatureAlgorithm: "ct-sig-02",
  });

  const result = evaluate(policy, request);
  assertEquals(result.allowed, true);
});

// === Transparency Log Tests ===

Deno.test("verification.transparencyLogs: allows when quorum met", () => {
  const policy = createTestPolicy({
    transparencyLogs: {
      required: ["rekor", "sigstore"],
      quorum: 1,
    },
  });
  const request = createTestRequest({
    transparencyLogEntries: [{ log: "rekor", entryId: "abc123" }],
  });

  const result = evaluate(policy, request);
  assertEquals(result.allowed, true);
});

Deno.test("verification.transparencyLogs: denies when quorum not met", () => {
  const policy = createTestPolicy({
    transparencyLogs: {
      required: ["rekor", "sigstore", "ct-tlog"],
      quorum: 2,
    },
  });
  const request = createTestRequest({
    transparencyLogEntries: [{ log: "rekor", entryId: "abc123" }],
  });

  const result = evaluate(policy, request);
  assertEquals(result.allowed, false);
  assertEquals(
    result.violations.some(
      (v) => v.rule === "verification.transparencyLogs" && v.message.includes("quorum"),
    ),
    true,
  );
});

Deno.test("verification.transparencyLogs: denies when no log entries", () => {
  const policy = createTestPolicy({
    transparencyLogs: {
      required: ["rekor"],
      quorum: 1,
    },
  });
  const request = createTestRequest({});

  const result = evaluate(policy, request);
  assertEquals(result.allowed, false);
  assertEquals(
    result.violations.some((v) => v.rule === "verification.transparencyLogs"),
    true,
  );
});

Deno.test("verification.transparencyLogs: allows when all required logs present", () => {
  const policy = createTestPolicy({
    transparencyLogs: {
      required: ["rekor", "sigstore"],
      quorum: 2,
    },
  });
  const request = createTestRequest({
    transparencyLogEntries: [
      { log: "rekor", entryId: "abc123" },
      { log: "sigstore", entryId: "def456" },
    ],
  });

  const result = evaluate(policy, request);
  assertEquals(result.allowed, true);
});

// === SBOM Tests ===

Deno.test("verification.sbomRequired: allows when SBOM present", () => {
  const policy = createTestPolicy({
    sbomRequired: true,
  });
  const request = createTestRequest({
    hasSbom: true,
  });

  const result = evaluate(policy, request);
  assertEquals(result.allowed, true);
});

Deno.test("verification.sbomRequired: denies when SBOM missing", () => {
  const policy = createTestPolicy({
    sbomRequired: true,
  });
  const request = createTestRequest({
    hasSbom: false,
  });

  const result = evaluate(policy, request);
  assertEquals(result.allowed, false);
  assertEquals(
    result.violations.some((v) => v.rule === "verification.sbomRequired"),
    true,
  );
});

Deno.test("verification.sbomFormats: allows correct format", () => {
  const policy = createTestPolicy({
    sbomRequired: true,
    sbomFormats: ["spdx", "cyclonedx"],
  });
  const request = createTestRequest({
    hasSbom: true,
    sbomFormat: "spdx",
  });

  const result = evaluate(policy, request);
  assertEquals(result.allowed, true);
});

Deno.test("verification.sbomFormats: denies wrong format", () => {
  const policy = createTestPolicy({
    sbomRequired: true,
    sbomFormats: ["spdx"],
  });
  const request = createTestRequest({
    hasSbom: true,
    sbomFormat: "cyclonedx",
  });

  const result = evaluate(policy, request);
  assertEquals(result.allowed, false);
  assertEquals(
    result.violations.some((v) => v.rule === "verification.sbomFormats"),
    true,
  );
});

// === Provenance Level Tests ===

Deno.test("verification.provenanceLevel: allows when level met", () => {
  const policy = createTestPolicy({
    provenanceLevel: 3,
  });
  const request = createTestRequest({
    slsaLevel: 3,
  });

  const result = evaluate(policy, request);
  assertEquals(result.allowed, true);
});

Deno.test("verification.provenanceLevel: allows when level exceeded", () => {
  const policy = createTestPolicy({
    provenanceLevel: 2,
  });
  const request = createTestRequest({
    slsaLevel: 4,
  });

  const result = evaluate(policy, request);
  assertEquals(result.allowed, true);
});

Deno.test("verification.provenanceLevel: denies when level not met", () => {
  const policy = createTestPolicy({
    provenanceLevel: 3,
  });
  const request = createTestRequest({
    slsaLevel: 2,
  });

  const result = evaluate(policy, request);
  assertEquals(result.allowed, false);
  assertEquals(
    result.violations.some(
      (v) => v.rule === "verification.provenanceLevel" && v.message.includes("level 2"),
    ),
    true,
  );
});

Deno.test("verification.provenanceLevel: denies when level missing", () => {
  const policy = createTestPolicy({
    provenanceLevel: 2,
  });
  const request = createTestRequest({});

  const result = evaluate(policy, request);
  assertEquals(result.allowed, false);
});

// === Max Signature Age Tests ===

Deno.test("verification.maxSignatureAgeDays: allows fresh signature", () => {
  const policy = createTestPolicy({
    maxSignatureAgeDays: 30,
  });
  const signedAt = new Date();
  signedAt.setDate(signedAt.getDate() - 10); // 10 days ago
  const request = createTestRequest({
    signedAt: signedAt.toISOString(),
  });

  const result = evaluate(policy, request);
  assertEquals(result.allowed, true);
});

Deno.test("verification.maxSignatureAgeDays: denies stale signature", () => {
  const policy = createTestPolicy({
    maxSignatureAgeDays: 30,
  });
  const signedAt = new Date();
  signedAt.setDate(signedAt.getDate() - 60); // 60 days ago
  const request = createTestRequest({
    signedAt: signedAt.toISOString(),
  });

  const result = evaluate(policy, request);
  assertEquals(result.allowed, false);
  assertEquals(
    result.violations.some(
      (v) => v.rule === "verification.maxSignatureAgeDays" && v.message.includes("days old"),
    ),
    true,
  );
});

Deno.test("verification.maxSignatureAgeDays: denies missing timestamp", () => {
  const policy = createTestPolicy({
    maxSignatureAgeDays: 30,
  });
  const request = createTestRequest({});

  const result = evaluate(policy, request);
  assertEquals(result.allowed, false);
  assertEquals(
    result.violations.some(
      (v) => v.rule === "verification.maxSignatureAgeDays" && v.message.includes("not provided"),
    ),
    true,
  );
});

// === Key Trust Level Tests ===

Deno.test("verification.keyTrustLevel: allows matching level", () => {
  const policy = createTestPolicy({
    keyTrustLevel: "organization",
  });
  const request = createTestRequest({
    keyTrustLevel: "organization",
  });

  const result = evaluate(policy, request);
  assertEquals(result.allowed, true);
});

Deno.test("verification.keyTrustLevel: allows higher level", () => {
  const policy = createTestPolicy({
    keyTrustLevel: "organization",
  });
  const request = createTestRequest({
    keyTrustLevel: "hardware-backed",
  });

  const result = evaluate(policy, request);
  assertEquals(result.allowed, true);
});

Deno.test("verification.keyTrustLevel: denies lower level", () => {
  const policy = createTestPolicy({
    keyTrustLevel: "trusted-keyring",
  });
  const request = createTestRequest({
    keyTrustLevel: "self-signed",
  });

  const result = evaluate(policy, request);
  assertEquals(result.allowed, false);
  assertEquals(
    result.violations.some((v) => v.rule === "verification.keyTrustLevel"),
    true,
  );
});

Deno.test("verification.keyTrustLevel: fulcio-verified is highest trust", () => {
  const policy = createTestPolicy({
    keyTrustLevel: "fulcio-verified",
  });
  const request = createTestRequest({
    keyTrustLevel: "hardware-backed",
  });

  const result = evaluate(policy, request);
  assertEquals(result.allowed, false);
});

Deno.test("verification.keyTrustLevel: denies missing trust level", () => {
  const policy = createTestPolicy({
    keyTrustLevel: "organization",
  });
  const request = createTestRequest({});

  const result = evaluate(policy, request);
  assertEquals(result.allowed, false);
});

// === Allowed Key IDs Tests ===

Deno.test("verification.allowedKeyIds: allows matching key ID", () => {
  const policy = createTestPolicy({
    allowedKeyIds: [
      "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    ],
  });
  const request = createTestRequest({
    keyId: "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  });

  const result = evaluate(policy, request);
  assertEquals(result.allowed, true);
});

Deno.test("verification.allowedKeyIds: denies unknown key ID", () => {
  const policy = createTestPolicy({
    allowedKeyIds: [
      "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    ],
  });
  const request = createTestRequest({
    keyId: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  });

  const result = evaluate(policy, request);
  assertEquals(result.allowed, false);
  assertEquals(
    result.violations.some((v) => v.rule === "verification.allowedKeyIds"),
    true,
  );
});

Deno.test("verification.allowedKeyIds: denies missing key ID", () => {
  const policy = createTestPolicy({
    allowedKeyIds: [
      "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    ],
  });
  const request = createTestRequest({});

  const result = evaluate(policy, request);
  assertEquals(result.allowed, false);
});

// === Required Predicates Tests ===

Deno.test("verification.requiredPredicates: allows when all present", () => {
  const policy = createTestPolicy({
    requiredPredicates: [
      "https://slsa.dev/provenance/v1",
      "https://spdx.dev/Document",
    ],
  });
  const request = createTestRequest({
    predicateTypes: [
      "https://slsa.dev/provenance/v1",
      "https://spdx.dev/Document",
      "https://example.com/extra",
    ],
  });

  const result = evaluate(policy, request);
  assertEquals(result.allowed, true);
});

Deno.test("verification.requiredPredicates: denies when missing some", () => {
  const policy = createTestPolicy({
    requiredPredicates: [
      "https://slsa.dev/provenance/v1",
      "https://spdx.dev/Document",
    ],
  });
  const request = createTestRequest({
    predicateTypes: ["https://slsa.dev/provenance/v1"],
  });

  const result = evaluate(policy, request);
  assertEquals(result.allowed, false);
  assertEquals(
    result.violations.some(
      (v) =>
        v.rule === "verification.requiredPredicates" &&
        v.message.includes("spdx.dev"),
    ),
    true,
  );
});

Deno.test("verification.requiredPredicates: denies when all missing", () => {
  const policy = createTestPolicy({
    requiredPredicates: ["https://slsa.dev/provenance/v1"],
  });
  const request = createTestRequest({});

  const result = evaluate(policy, request);
  assertEquals(result.allowed, false);
});

// === Combined Verification Tests ===

Deno.test("combined: full verification passes with complete attestation", () => {
  const signedAt = new Date();
  signedAt.setDate(signedAt.getDate() - 5);

  const policy = createTestPolicy({
    signatureAlgorithms: ["ed25519", "ml-dsa-87"],
    transparencyLogs: {
      required: ["rekor"],
      quorum: 1,
    },
    sbomRequired: true,
    sbomFormats: ["spdx"],
    provenanceLevel: 2,
    maxSignatureAgeDays: 30,
    keyTrustLevel: "organization",
    requiredPredicates: ["https://slsa.dev/provenance/v1"],
  });

  const request = createTestRequest({
    signatureAlgorithm: "ed25519",
    transparencyLogEntries: [{ log: "rekor", entryId: "abc123" }],
    hasSbom: true,
    sbomFormat: "spdx",
    slsaLevel: 3,
    signedAt: signedAt.toISOString(),
    keyTrustLevel: "trusted-keyring",
    predicateTypes: ["https://slsa.dev/provenance/v1", "https://spdx.dev/Document"],
  });

  const result = evaluate(policy, request);
  assertEquals(result.allowed, true);
  assertEquals(result.violations.length, 0);
});

Deno.test("combined: multiple violations reported", () => {
  const policy = createTestPolicy({
    signatureAlgorithms: ["ed25519"],
    sbomRequired: true,
    provenanceLevel: 3,
  });

  const request = createTestRequest({
    signatureAlgorithm: "rsa-2048",
    hasSbom: false,
    slsaLevel: 1,
  });

  const result = evaluate(policy, request);
  assertEquals(result.allowed, false);
  assertEquals(result.violations.length >= 3, true);
});

// === Policy Result Structure Tests ===

Deno.test("violation has correct structure for verification rules", () => {
  const policy = createTestPolicy({
    signatureAlgorithms: ["ed25519"],
  });
  const request = createTestRequest({
    signatureAlgorithm: "rsa-2048",
  });

  const result = evaluate(policy, request);
  const violation = result.violations.find(
    (v) => v.rule === "verification.signatureAlgorithms",
  );

  assertExists(violation);
  assertEquals(violation.severity, "critical");
  assertExists(violation.message);
  assertEquals(violation.field, "attestation.signatureAlgorithm");
  assertEquals(violation.actual, "rsa-2048");
  assertExists(violation.expected);
});
