// SPDX-License-Identifier: PMPL-1.0-or-later
// Edge policy engine tests

import { assertEquals } from "jsr:@std/assert@1";

// Policy types (matching Validation.res)
interface EdgePolicy {
  allowPrivileged: boolean;
  allowHostNetwork: boolean;
  allowHostPid: boolean;
  maxMemoryMb: number | null;
  maxCpuCores: number | null;
  allowedRegistries: string[];
  deniedImages: string[];
}

// Default restrictive policy
const defaultPolicy: EdgePolicy = {
  allowPrivileged: false,
  allowHostNetwork: false,
  allowHostPid: false,
  maxMemoryMb: 4096,
  maxCpuCores: 4.0,
  allowedRegistries: ["docker.io", "ghcr.io", "quay.io", "gcr.io"],
  deniedImages: [],
};

// Policy helper functions
function isAllowedRegistry(imageRef: string, policy: EdgePolicy): boolean {
  const parts = imageRef.split("/");
  let registry = "docker.io";

  if (parts.length > 1 && parts[0].includes(".")) {
    registry = parts[0];
  }

  if (policy.allowedRegistries.length === 0) {
    return true;
  }

  return policy.allowedRegistries.includes(registry);
}

function isDeniedImage(imageRef: string, policy: EdgePolicy): boolean {
  return policy.deniedImages.some((img) => imageRef.includes(img));
}

// Tests
Deno.test("default policy allows docker.io images", () => {
  const result = isAllowedRegistry("alpine:latest", defaultPolicy);
  assertEquals(result, true);
});

Deno.test("default policy allows ghcr.io images", () => {
  const result = isAllowedRegistry("ghcr.io/myorg/myimage:v1", defaultPolicy);
  assertEquals(result, true);
});

Deno.test("default policy allows quay.io images", () => {
  const result = isAllowedRegistry("quay.io/prometheus/prometheus:latest", defaultPolicy);
  assertEquals(result, true);
});

Deno.test("default policy allows gcr.io images", () => {
  const result = isAllowedRegistry("gcr.io/google-containers/pause:3.2", defaultPolicy);
  assertEquals(result, true);
});

Deno.test("default policy denies unknown registries", () => {
  const result = isAllowedRegistry("evil.registry.com/malware:latest", defaultPolicy);
  assertEquals(result, false);
});

Deno.test("custom policy can restrict to single registry", () => {
  const restrictedPolicy: EdgePolicy = {
    ...defaultPolicy,
    allowedRegistries: ["internal.registry.local"],
  };

  assertEquals(isAllowedRegistry("internal.registry.local/app:v1", restrictedPolicy), true);
  assertEquals(isAllowedRegistry("docker.io/alpine:latest", restrictedPolicy), false);
});

Deno.test("empty allowedRegistries allows all", () => {
  const openPolicy: EdgePolicy = {
    ...defaultPolicy,
    allowedRegistries: [],
  };

  assertEquals(isAllowedRegistry("any.registry.com/image:tag", openPolicy), true);
});

Deno.test("deniedImages blocks specific images", () => {
  const policyWithDeny: EdgePolicy = {
    ...defaultPolicy,
    deniedImages: ["known-malware", "deprecated-image"],
  };

  assertEquals(isDeniedImage("docker.io/known-malware:latest", policyWithDeny), true);
  assertEquals(isDeniedImage("ghcr.io/org/deprecated-image:v1", policyWithDeny), true);
  assertEquals(isDeniedImage("alpine:latest", policyWithDeny), false);
});

Deno.test("policy denies privileged by default", () => {
  assertEquals(defaultPolicy.allowPrivileged, false);
});

Deno.test("policy denies host network by default", () => {
  assertEquals(defaultPolicy.allowHostNetwork, false);
});

Deno.test("policy denies host PID by default", () => {
  assertEquals(defaultPolicy.allowHostPid, false);
});

Deno.test("policy has reasonable memory limit", () => {
  assertEquals(defaultPolicy.maxMemoryMb, 4096);
});

Deno.test("policy has reasonable CPU limit", () => {
  assertEquals(defaultPolicy.maxCpuCores, 4.0);
});

Deno.test("library images default to docker.io", () => {
  // Images without a registry prefix default to docker.io
  const result = isAllowedRegistry("nginx:latest", defaultPolicy);
  assertEquals(result, true);
});

Deno.test("namespaced images without registry default to docker.io", () => {
  // e.g., "library/alpine" should be docker.io
  const result = isAllowedRegistry("library/alpine:latest", defaultPolicy);
  assertEquals(result, true);
});
