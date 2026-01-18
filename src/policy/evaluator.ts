// SPDX-License-Identifier: PMPL-1.0-or-later
// Policy evaluator for Svalinn

import type {
  EdgePolicy,
  ContainerRequest,
  PolicyResult,
  PolicyViolation,
} from "./types.ts";

/**
 * Match a string against a glob pattern
 */
function matchGlob(pattern: string, value: string): boolean {
  // Convert glob to regex
  const regexPattern = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&") // Escape regex special chars
    .replace(/\*/g, ".*") // * -> .*
    .replace(/\?/g, "."); // ? -> .
  const regex = new RegExp(`^${regexPattern}$`, "i");
  return regex.test(value);
}

/**
 * Match against a list of patterns
 */
function matchPatterns(patterns: string[], value: string): boolean {
  return patterns.some((pattern) => matchGlob(pattern, value));
}

/**
 * Extract registry from image reference
 */
function extractRegistry(image: string): string {
  const parts = image.split("/");
  if (parts.length === 1) {
    return "docker.io";
  }
  if (parts[0].includes(".") || parts[0].includes(":")) {
    return parts[0];
  }
  return "docker.io";
}

/**
 * Evaluate a container request against a policy
 */
export function evaluate(
  policy: EdgePolicy,
  request: ContainerRequest
): PolicyResult {
  const violations: PolicyViolation[] = [];
  const registry = request.registry || extractRegistry(request.image);

  // === Registry Rules ===

  // Check deny list first (deny takes precedence)
  if (policy.registries.deny.length > 0) {
    if (matchPatterns(policy.registries.deny, registry)) {
      violations.push({
        rule: "registries.deny",
        severity: "critical",
        message: `Registry '${registry}' is in the deny list`,
        field: "registry",
        actual: registry,
      });
    }
  }

  // Check allow list
  if (policy.registries.allow.length > 0) {
    if (!matchPatterns(policy.registries.allow, registry)) {
      violations.push({
        rule: "registries.allow",
        severity: "critical",
        message: `Registry '${registry}' is not in the allow list`,
        field: "registry",
        actual: registry,
        expected: policy.registries.allow,
      });
    }
  }

  // === Image Rules ===

  // Check deny patterns
  if (matchPatterns(policy.images.denyPatterns, request.image)) {
    violations.push({
      rule: "images.denyPatterns",
      severity: "high",
      message: `Image '${request.image}' matches deny pattern`,
      field: "image",
      actual: request.image,
    });
  }

  // Check allow patterns (if not empty)
  if (policy.images.allowPatterns.length > 0) {
    if (!matchPatterns(policy.images.allowPatterns, request.image)) {
      violations.push({
        rule: "images.allowPatterns",
        severity: "high",
        message: `Image '${request.image}' does not match any allow pattern`,
        field: "image",
        actual: request.image,
      });
    }
  }

  // === Security Rules ===

  if (request.privileged && !policy.security.allowPrivileged) {
    violations.push({
      rule: "security.allowPrivileged",
      severity: "critical",
      message: "Privileged containers are not allowed",
      field: "privileged",
      actual: true,
      expected: false,
    });
  }

  if (request.hostNetwork && !policy.security.allowHostNetwork) {
    violations.push({
      rule: "security.allowHostNetwork",
      severity: "critical",
      message: "Host network is not allowed",
      field: "hostNetwork",
      actual: true,
      expected: false,
    });
  }

  if (request.hostPid && !policy.security.allowHostPid) {
    violations.push({
      rule: "security.allowHostPid",
      severity: "critical",
      message: "Host PID namespace is not allowed",
      field: "hostPid",
      actual: true,
      expected: false,
    });
  }

  if (request.hostIpc && !policy.security.allowHostIpc) {
    violations.push({
      rule: "security.allowHostIpc",
      severity: "critical",
      message: "Host IPC namespace is not allowed",
      field: "hostIpc",
      actual: true,
      expected: false,
    });
  }

  if (policy.security.readOnlyRoot && request.readOnlyRoot === false) {
    violations.push({
      rule: "security.readOnlyRoot",
      severity: "high",
      message: "Read-only root filesystem is required",
      field: "readOnlyRoot",
      actual: false,
      expected: true,
    });
  }

  // Check capabilities
  if (request.capabilities?.add) {
    const forbidden = request.capabilities.add.filter(
      (cap) => !policy.security.addCapabilities.includes(cap)
    );
    if (forbidden.length > 0) {
      violations.push({
        rule: "security.addCapabilities",
        severity: "high",
        message: `Capabilities not allowed: ${forbidden.join(", ")}`,
        field: "capabilities.add",
        actual: forbidden,
        expected: policy.security.addCapabilities,
      });
    }
  }

  // === Resource Rules ===

  if (request.memory && request.memory > policy.resources.maxMemoryMb) {
    violations.push({
      rule: "resources.maxMemoryMb",
      severity: "high",
      message: `Memory ${request.memory}MB exceeds limit ${policy.resources.maxMemoryMb}MB`,
      field: "memory",
      actual: request.memory,
      expected: policy.resources.maxMemoryMb,
    });
  }

  if (request.cpu && request.cpu > policy.resources.maxCpuCores) {
    violations.push({
      rule: "resources.maxCpuCores",
      severity: "high",
      message: `CPU ${request.cpu} cores exceeds limit ${policy.resources.maxCpuCores}`,
      field: "cpu",
      actual: request.cpu,
      expected: policy.resources.maxCpuCores,
    });
  }

  // === Network Rules ===

  if (policy.network?.deniedPorts && request.ports) {
    const forbiddenPorts = request.ports.filter((port) =>
      policy.network!.deniedPorts!.includes(port)
    );
    if (forbiddenPorts.length > 0) {
      violations.push({
        rule: "network.deniedPorts",
        severity: "high",
        message: `Ports not allowed: ${forbiddenPorts.join(", ")}`,
        field: "ports",
        actual: forbiddenPorts,
      });
    }
  }

  // Determine if allowed based on violations
  const hasCritical = violations.some((v) => v.severity === "critical");
  const hasHigh = violations.some((v) => v.severity === "high");

  return {
    allowed: !hasCritical && !hasHigh,
    violations,
    appliedPolicy: policy.name,
    evaluatedAt: new Date().toISOString(),
  };
}

/**
 * Evaluate multiple policies (first match wins)
 */
export function evaluateMultiple(
  policies: EdgePolicy[],
  request: ContainerRequest
): PolicyResult {
  for (const policy of policies) {
    const result = evaluate(policy, request);
    if (result.allowed) {
      return result;
    }
  }

  // If no policy allows, return the result from the first policy
  if (policies.length > 0) {
    return evaluate(policies[0], request);
  }

  // No policies - deny by default
  return {
    allowed: false,
    violations: [
      {
        rule: "default",
        severity: "critical",
        message: "No policy configured - default deny",
      },
    ],
    appliedPolicy: "none",
    evaluatedAt: new Date().toISOString(),
  };
}
