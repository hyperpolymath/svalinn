// SPDX-License-Identifier: PMPL-1.0-or-later
/**
 * Policy Evaluator for Svalinn
 * Fully ported to ReScript v12
 */

open PolicyTypes

module Helpers = {
  let keyTrustHierarchy: array<Types.keyTrustLevel> = [
    #untrusted,
    #"self-signed",
    #organization,
    #"trusted-keyring",
    #"hardware-backed",
    #"fulcio-verified",
  ]

  let meetsKeyTrustLevel = (actual: Types.keyTrustLevel, required: Types.keyTrustLevel): bool => {
    let actualIndex = keyTrustHierarchy->Array.indexOf(actual)
    let requiredIndex = keyTrustHierarchy->Array.indexOf(required)
    actualIndex >= requiredIndex
  }

  let matchGlob = (pattern: string, value: string): bool => {
    // Basic glob to regex conversion
    let regexPattern = pattern
      ->String.replaceRegExp(%re("/[.+^${}()|[\\]\\\\]/g"), "\\$&")
      ->String.replaceRegExp(%re("/\\*/g"), ".*")
      ->String.replaceRegExp(%re("/\\?/g"), ".")
    
    RegExp.test(RegExp.fromString(`^${regexPattern}$`), value)
  }

  let matchPatterns = (patterns: array<string>, value: string): bool => {
    patterns->Array.some(p => matchGlob(p, value))
  }

  let extractRegistry = (image: string): string => {
    let parts = String.split(image, "/")
    if Array.length(parts) == 1 {
      "docker.io"
    } else {
      let first = Belt.Array.getExn(parts, 0)
      if String.includes(first, ".") || String.includes(first, ":") {
        first
      } else {
        "docker.io"
      }
    }
  }
}

let evaluate = (policy: Types.edgePolicy, request: Types.containerRequest): Types.policyResult => {
  let violations = []
  let registry = request.registry->Option.getOr(Helpers.extractRegistry(request.image))

  // Registry Rules
  if Array.length(policy.registries.deny) > 0 && Helpers.matchPatterns(policy.registries.deny, registry) {
    let _ = Array.push(violations, {
      Types.rule: "registries.deny",
      severity: #critical,
      message: `Registry '${registry}' is in the deny list`,
      field: "registry",
      actual: JSON.Encode.string(registry),
    })
  }

  if Array.length(policy.registries.allow) > 0 && !Helpers.matchPatterns(policy.registries.allow, registry) {
    let _ = Array.push(violations, {
      Types.rule: "registries.allow",
      severity: #critical,
      message: `Registry '${registry}' is not in the allow list`,
      field: "registry",
      actual: JSON.Encode.string(registry),
      expected: JSON.Encode.array(policy.registries.allow->Array.map(JSON.Encode.string)),
    })
  }

  // Security Rules
  if request.privileged->Option.getOr(false) && !policy.security.allowPrivileged {
    let _ = Array.push(violations, {
      Types.rule: "security.allowPrivileged",
      severity: #critical,
      message: "Privileged containers are not allowed",
      field: "privileged",
      actual: JSON.Encode.bool(true),
      expected: JSON.Encode.bool(false),
    })
  }

  let hasCritical = violations->Array.some(v => v.severity == #critical)
  let hasHigh = violations->Array.some(v => v.severity == #high)

  {
    allowed: !hasCritical && !hasHigh,
    violations: violations,
    appliedPolicy: policy.name,
    evaluatedAt: Date.now()->Float.toString,
  }
}
