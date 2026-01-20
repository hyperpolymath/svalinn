// SPDX-License-Identifier: PMPL-1.0-or-later
// Policy store for Svalinn - file-based persistence

import type { EdgePolicy, VerificationRules } from "./types.ts";
import { getDefaultPolicy, standardPolicy } from "./defaults.ts";

const POLICY_DIR = Deno.env.get("SVALINN_POLICY_DIR") || "./policies";
const ACTIVE_POLICY_FILE = "active-policy.json";

/**
 * Policy store for managing edge policies
 */
export class PolicyStore {
  private policyDir: string;
  private activePolicy: EdgePolicy;
  private policies: Map<string, EdgePolicy>;

  constructor(policyDir?: string) {
    this.policyDir = policyDir || POLICY_DIR;
    this.activePolicy = standardPolicy;
    this.policies = new Map();
  }

  /**
   * Initialize the policy store
   */
  async init(): Promise<void> {
    try {
      await Deno.mkdir(this.policyDir, { recursive: true });
    } catch {
      // Directory may already exist
    }

    // Load active policy
    await this.loadActivePolicy();

    // Load all policies from directory
    await this.loadAllPolicies();
  }

  /**
   * Load the active policy from file
   */
  private async loadActivePolicy(): Promise<void> {
    try {
      const path = `${this.policyDir}/${ACTIVE_POLICY_FILE}`;
      const text = await Deno.readTextFile(path);
      const data = JSON.parse(text);

      // If it's a reference to a default policy
      if (typeof data === "string") {
        const defaultPolicy = getDefaultPolicy(data);
        if (defaultPolicy) {
          this.activePolicy = defaultPolicy;
          return;
        }
      }

      // Otherwise it's a custom policy
      this.activePolicy = data as EdgePolicy;
    } catch {
      // No active policy file - use standard
      this.activePolicy = standardPolicy;
    }
  }

  /**
   * Load all policies from the policy directory
   */
  private async loadAllPolicies(): Promise<void> {
    try {
      for await (const entry of Deno.readDir(this.policyDir)) {
        if (entry.isFile && entry.name.endsWith(".json") && entry.name !== ACTIVE_POLICY_FILE) {
          try {
            const path = `${this.policyDir}/${entry.name}`;
            const text = await Deno.readTextFile(path);
            const policy = JSON.parse(text) as EdgePolicy;
            this.policies.set(policy.name, policy);
          } catch {
            console.warn(`Failed to load policy: ${entry.name}`);
          }
        }
      }
    } catch {
      // Directory doesn't exist yet
    }
  }

  /**
   * Get the current active policy
   */
  getActivePolicy(): EdgePolicy {
    return this.activePolicy;
  }

  /**
   * Set the active policy
   */
  async setActivePolicy(policyNameOrPolicy: string | EdgePolicy): Promise<void> {
    if (typeof policyNameOrPolicy === "string") {
      // Try default policies first
      const defaultPolicy = getDefaultPolicy(policyNameOrPolicy);
      if (defaultPolicy) {
        this.activePolicy = defaultPolicy;
        await this.saveActivePolicy();
        return;
      }

      // Try stored policies
      const stored = this.policies.get(policyNameOrPolicy);
      if (stored) {
        this.activePolicy = stored;
        await this.saveActivePolicy();
        return;
      }

      throw new Error(`Policy not found: ${policyNameOrPolicy}`);
    }

    // Custom policy object
    this.activePolicy = policyNameOrPolicy;
    await this.saveActivePolicy();
  }

  /**
   * Save the active policy to file
   */
  private async saveActivePolicy(): Promise<void> {
    const path = `${this.policyDir}/${ACTIVE_POLICY_FILE}`;
    await Deno.writeTextFile(path, JSON.stringify(this.activePolicy, null, 2));
  }

  /**
   * Save a policy to file
   */
  async savePolicy(policy: EdgePolicy): Promise<void> {
    const filename = `${policy.name}.json`;
    const path = `${this.policyDir}/${filename}`;
    await Deno.writeTextFile(path, JSON.stringify(policy, null, 2));
    this.policies.set(policy.name, policy);
  }

  /**
   * Delete a policy
   */
  async deletePolicy(name: string): Promise<boolean> {
    const filename = `${name}.json`;
    const path = `${this.policyDir}/${filename}`;

    try {
      await Deno.remove(path);
      this.policies.delete(name);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get a policy by name
   */
  getPolicy(name: string): EdgePolicy | null {
    // Check defaults first
    const defaultPolicy = getDefaultPolicy(name);
    if (defaultPolicy) {
      return defaultPolicy;
    }

    // Check stored policies
    return this.policies.get(name) || null;
  }

  /**
   * List all available policies
   */
  listPolicies(): string[] {
    const defaults = ["strict", "standard", "permissive"];
    const custom = Array.from(this.policies.keys());
    return [...new Set([...defaults, ...custom])];
  }

  /**
   * Validate a policy object
   */
  validatePolicy(policy: Partial<EdgePolicy>): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!policy.version) {
      errors.push("Missing required field: version");
    }

    if (!policy.name) {
      errors.push("Missing required field: name");
    }

    if (!policy.registries) {
      errors.push("Missing required field: registries");
    }

    if (!policy.images) {
      errors.push("Missing required field: images");
    }

    if (!policy.resources) {
      errors.push("Missing required field: resources");
    }

    if (!policy.security) {
      errors.push("Missing required field: security");
    }

    // Validate verification rules if present
    if (policy.verification) {
      const verificationErrors = this.validateVerificationRules(policy.verification);
      errors.push(...verificationErrors);
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Validate verification rules
   */
  private validateVerificationRules(verification: Partial<VerificationRules>): string[] {
    const errors: string[] = [];

    const validSignatureAlgorithms = [
      "ed25519",
      "ecdsa-p256",
      "ecdsa-p384",
      "rsa-2048",
      "rsa-4096",
      "ml-dsa-44",
      "ml-dsa-65",
      "ml-dsa-87",
      "ct-sig-02",
      "slh-dsa-shake-128f",
      "slh-dsa-shake-256f",
    ];

    const validTransparencyLogs = [
      "rekor",
      "ct-tlog",
      "sigstore",
      "trillian",
      "arweave",
      "custom",
    ];

    const validSbomFormats = ["spdx", "cyclonedx", "syft"];

    const validKeyTrustLevels = [
      "untrusted",
      "self-signed",
      "organization",
      "trusted-keyring",
      "hardware-backed",
      "fulcio-verified",
    ];

    // Validate signature algorithms
    if (verification.signatureAlgorithms) {
      for (const algo of verification.signatureAlgorithms) {
        if (!validSignatureAlgorithms.includes(algo)) {
          errors.push(`Invalid signature algorithm: ${algo}`);
        }
      }
    }

    // Validate transparency logs
    if (verification.transparencyLogs) {
      if (!verification.transparencyLogs.required) {
        errors.push("verification.transparencyLogs.required is required");
      } else {
        for (const log of verification.transparencyLogs.required) {
          if (!validTransparencyLogs.includes(log)) {
            errors.push(`Invalid transparency log: ${log}`);
          }
        }
      }

      if (
        verification.transparencyLogs.quorum !== undefined &&
        verification.transparencyLogs.quorum < 1
      ) {
        errors.push("verification.transparencyLogs.quorum must be at least 1");
      }
    }

    // Validate SBOM formats
    if (verification.sbomFormats) {
      for (const format of verification.sbomFormats) {
        if (!validSbomFormats.includes(format)) {
          errors.push(`Invalid SBOM format: ${format}`);
        }
      }
    }

    // Validate provenance level
    if (verification.provenanceLevel !== undefined) {
      if (![1, 2, 3, 4].includes(verification.provenanceLevel)) {
        errors.push("verification.provenanceLevel must be 1, 2, 3, or 4");
      }
    }

    // Validate max signature age
    if (verification.maxSignatureAgeDays !== undefined) {
      if (verification.maxSignatureAgeDays < 1) {
        errors.push("verification.maxSignatureAgeDays must be at least 1");
      }
    }

    // Validate key trust level
    if (verification.keyTrustLevel) {
      if (!validKeyTrustLevels.includes(verification.keyTrustLevel)) {
        errors.push(`Invalid key trust level: ${verification.keyTrustLevel}`);
      }
    }

    // Validate key IDs format (SHA256 fingerprints)
    if (verification.allowedKeyIds) {
      const sha256Pattern = /^sha256:[a-f0-9]{64}$/;
      for (const keyId of verification.allowedKeyIds) {
        if (!sha256Pattern.test(keyId)) {
          errors.push(`Invalid key ID format (expected sha256:hex64): ${keyId}`);
        }
      }
    }

    // Validate required predicates format (URIs)
    if (verification.requiredPredicates) {
      for (const predicate of verification.requiredPredicates) {
        try {
          new URL(predicate);
        } catch {
          errors.push(`Invalid predicate URI: ${predicate}`);
        }
      }
    }

    return errors;
  }
}

// Export singleton instance
export const policyStore = new PolicyStore();
