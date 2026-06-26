// SPDX-License-Identifier: MPL-2.0
// Copyright (c) Jonathan D.A. Jewell <j.d.a.jewell@open.ac.uk>
/**
 * Deno benchmarks for Svalinn core operations.
 * Run with: deno bench --allow-all --node-modules-dir=auto --no-check src/benches/svalinn_bench.ts
 */

// NOTE: Jwt/OAuth2/PolicyEvaluator were ReScript modules; the *.res.mjs these
// benches imported was removed in the .res→.affine migration (svalinn#47).
// AffineScript has no JS backend yet, so the implementations are stubbed and
// every bench is `ignore: true`. When AffineScript emits JS, re-point the stubs
// at the compiled output and drop the `ignore` flags.
const NOT_PORTED = "pending AffineScript→JS backend (migrated from ReScript in svalinn#47)";
const Jwt = {
  parseJwtSegments(_token: string): unknown {
    throw new Error(NOT_PORTED);
  },
};
const OAuth2 = {
  generateState(): string {
    throw new Error(NOT_PORTED);
  },
};
const PolicyEvaluator = {
  evaluate(_policy: unknown, _request: unknown): unknown {
    throw new Error(NOT_PORTED);
  },
};

const VALID_TOKEN = btoa('{"alg":"RS256","typ":"JWT"}') + "." +
  btoa(
    '{"sub":"user123","iss":"https://auth.example.com","aud":"svalinn","exp":9999999999,"iat":0}',
  ) + ".sig";

const STRICT_POLICY = {
  version: "1.0",
  name: "strict",
  registries: { allow: ["docker.io", "ghcr.io"], deny: ["evil.com"], requireSignature: false },
  images: { allowPatterns: ["*"], denyPatterns: ["*/test-*"], requireSbom: false },
  resources: { maxMemoryMb: 2048, maxCpuCores: 2 },
  security: {
    allowPrivileged: false,
    allowHostNetwork: false,
    allowHostPid: false,
    allowHostIpc: false,
    readOnlyRoot: false,
    dropCapabilities: [],
    addCapabilities: [],
  },
};

Deno.bench({
  name: "JWT decode valid token",
  ignore: true,
  fn: () => {
    Jwt.parseJwtSegments(VALID_TOKEN);
  },
});

Deno.bench({
  name: "JWT decode invalid (3 parts, bad base64)",
  ignore: true,
  fn: () => {
    try {
      Jwt.parseJwtSegments("aaa.bbb.ccc");
    } catch {
      // expected
    }
  },
});

Deno.bench({
  name: "OAuth2 generateState (64-char hex)",
  ignore: true,
  fn: () => {
    OAuth2.generateState();
  },
});

Deno.bench({
  name: "PolicyEvaluator: allowed docker.io image",
  ignore: true,
  fn: () => {
    PolicyEvaluator.evaluate(STRICT_POLICY, { image: "docker.io/library/alpine:3.18" });
  },
});

Deno.bench({
  name: "PolicyEvaluator: denied registry",
  ignore: true,
  fn: () => {
    PolicyEvaluator.evaluate(STRICT_POLICY, { image: "evil.com/malware:latest" });
  },
});

Deno.bench({
  name: "PolicyEvaluator: denied privileged",
  ignore: true,
  fn: () => {
    PolicyEvaluator.evaluate(STRICT_POLICY, { image: "docker.io/app:1.0", privileged: true });
  },
});

Deno.bench({
  name: "PolicyEvaluator: open policy always-allow",
  ignore: true,
  fn: () => {
    const openPolicy = {
      version: "1.0",
      name: "open",
      registries: { allow: [], deny: [], requireSignature: false },
      images: { allowPatterns: ["*"], denyPatterns: [], requireSbom: false },
      resources: { maxMemoryMb: 16384, maxCpuCores: 8 },
      security: {
        allowPrivileged: true,
        allowHostNetwork: true,
        allowHostPid: true,
        allowHostIpc: true,
        readOnlyRoot: false,
        dropCapabilities: [],
        addCapabilities: [],
      },
    };
    PolicyEvaluator.evaluate(openPolicy, { image: "any.registry.com/app:latest" });
  },
});

Deno.bench({
  name: "JWT decode x10 batch",
  ignore: true,
  fn: () => {
    for (let i = 0; i < 10; i++) {
      Jwt.parseJwtSegments(VALID_TOKEN);
    }
  },
});
