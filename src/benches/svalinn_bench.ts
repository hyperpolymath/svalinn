// SPDX-License-Identifier: PMPL-1.0-or-later
/**
 * Deno benchmarks for Svalinn core operations.
 * Run with: deno bench --allow-all --node-modules-dir=auto --no-check src/benches/svalinn_bench.ts
 */

import * as Jwt from "../auth/Jwt.res.mjs";
import * as OAuth2 from "../auth/OAuth2.res.mjs";
import * as PolicyEvaluator from "../policy/PolicyEvaluator.res.mjs";

const VALID_TOKEN = btoa('{"alg":"RS256","typ":"JWT"}') + "." +
  btoa('{"sub":"user123","iss":"https://auth.example.com","aud":"svalinn","exp":9999999999,"iat":0}') + ".sig";

const STRICT_POLICY = {
  version: "1.0", name: "strict",
  registries: { allow: ["docker.io", "ghcr.io"], deny: ["evil.com"], requireSignature: false },
  images: { allowPatterns: ["*"], denyPatterns: ["*/test-*"], requireSbom: false },
  resources: { maxMemoryMb: 2048, maxCpuCores: 2 },
  security: { allowPrivileged: false, allowHostNetwork: false, allowHostPid: false, allowHostIpc: false, readOnlyRoot: false, dropCapabilities: [], addCapabilities: [] },
};

Deno.bench("JWT decode valid token", () => {
  Jwt.decodeJwt(VALID_TOKEN);
});

Deno.bench("JWT decode invalid (3 parts, bad base64)", () => {
  try {
    Jwt.decodeJwt("aaa.bbb.ccc");
  } catch {
    // expected
  }
});

Deno.bench("OAuth2 generateState (64-char hex)", () => {
  OAuth2.generateState();
});

Deno.bench("PolicyEvaluator: allowed docker.io image", () => {
  PolicyEvaluator.evaluate(STRICT_POLICY, { image: "docker.io/library/alpine:3.18" });
});

Deno.bench("PolicyEvaluator: denied registry", () => {
  PolicyEvaluator.evaluate(STRICT_POLICY, { image: "evil.com/malware:latest" });
});

Deno.bench("PolicyEvaluator: denied privileged", () => {
  PolicyEvaluator.evaluate(STRICT_POLICY, { image: "docker.io/app:1.0", privileged: true });
});

Deno.bench("PolicyEvaluator: open policy always-allow", () => {
  const openPolicy = {
    version: "1.0", name: "open",
    registries: { allow: [], deny: [], requireSignature: false },
    images: { allowPatterns: ["*"], denyPatterns: [], requireSbom: false },
    resources: { maxMemoryMb: 16384, maxCpuCores: 8 },
    security: { allowPrivileged: true, allowHostNetwork: true, allowHostPid: true, allowHostIpc: true, readOnlyRoot: false, dropCapabilities: [], addCapabilities: [] },
  };
  PolicyEvaluator.evaluate(openPolicy, { image: "any.registry.com/app:latest" });
});

Deno.bench("JWT decode x10 batch", () => {
  for (let i = 0; i < 10; i++) {
    Jwt.decodeJwt(VALID_TOKEN);
  }
});
