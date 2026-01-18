// SPDX-License-Identifier: PMPL-1.0-or-later
// Svalinn Integration - Verified Container Spec
//
// Integrates with hyperpolymath/verified-container-spec for:
// - Attestation bundle validation
// - Trust store management
// - Verification protocol compliance

import Ajv from "ajv";
import addFormats from "ajv-formats";

/**
 * Trust store schema (from verified-container-spec)
 */
export interface TrustStore {
  version: "1.0";
  created: string;
  logs: LogOperator[];
  keys: TrustedKey[];
  policy: TrustPolicy;
}

export interface LogOperator {
  id: string;
  name: string;
  url: string;
  publicKey: string;
  trustLevel: "full" | "marginal";
}

export interface TrustedKey {
  id: string;
  algorithm: "ed25519" | "ecdsa-p256" | "rsa-4096";
  publicKey: string;
  issuer?: string;
  expires?: string;
  trustLevel: "untrusted" | "marginal" | "full" | "ultimate";
}

export interface TrustPolicy {
  minSignatures: number;
  minLogEntries: number;
  requiredAttestations: string[];
  allowedRegistries?: string[];
  blockedImages?: string[];
}

/**
 * Attestation bundle (from verified-container-spec)
 */
export interface AttestationBundle {
  mediaType: "application/vnd.verified-container.attestation-bundle.v1+json";
  subject: {
    digest: string;
    mediaType: string;
  };
  attestations: Attestation[];
  logEntries: LogEntry[];
  signatures: Signature[];
}

export interface Attestation {
  type: string;
  predicateType: string;
  predicate: unknown;
}

export interface LogEntry {
  logId: string;
  index: number;
  timestamp: string;
  proof: MerkleProof;
}

export interface MerkleProof {
  rootHash: string;
  leafHash: string;
  hashes: string[];
  index: number;
  treeSize: number;
}

export interface Signature {
  keyId: string;
  algorithm: string;
  value: string;
}

/**
 * Verification result
 */
export interface VerificationResult {
  verified: boolean;
  subject: string;
  policy: string;
  checks: VerificationCheck[];
  timestamp: string;
}

export interface VerificationCheck {
  name: string;
  passed: boolean;
  message?: string;
}

/**
 * Verified Container Spec integration
 */
export class VerifiedContainerSpec {
  private ajv: Ajv;
  private trustStore?: TrustStore;
  private schemasLoaded = false;

  constructor() {
    this.ajv = new Ajv({ allErrors: true });
    addFormats(this.ajv);
  }

  /**
   * Load schemas from verified-container-spec repo
   */
  async loadSchemas(specPath: string): Promise<void> {
    const schemaFiles = [
      "schema/trust-store.schema.json",
      "schema/attestation-bundle.schema.json",
      "schema/transparency-log.schema.json",
    ];

    for (const file of schemaFiles) {
      try {
        const schemaPath = `${specPath}/${file}`;
        const content = await Deno.readTextFile(schemaPath);
        const schema = JSON.parse(content);
        this.ajv.addSchema(schema, file);
      } catch (error) {
        console.warn(`Could not load schema ${file}: ${error}`);
      }
    }

    this.schemasLoaded = true;
  }

  /**
   * Load trust store from file or URL
   */
  async loadTrustStore(path: string): Promise<TrustStore> {
    const content = await Deno.readTextFile(path);
    const store = JSON.parse(content) as TrustStore;

    // Validate against schema if loaded
    if (this.schemasLoaded) {
      const validate = this.ajv.getSchema("schema/trust-store.schema.json");
      if (validate && !validate(store)) {
        throw new Error(`Invalid trust store: ${JSON.stringify(validate.errors)}`);
      }
    }

    this.trustStore = store;
    return store;
  }

  /**
   * Verify an attestation bundle against the trust store
   */
  async verifyBundle(bundle: AttestationBundle): Promise<VerificationResult> {
    if (!this.trustStore) {
      throw new Error("Trust store not loaded");
    }

    const checks: VerificationCheck[] = [];
    const policy = this.trustStore.policy;

    // Check 1: Minimum signatures
    const validSignatures = bundle.signatures.filter((sig) =>
      this.verifySignature(sig, bundle.subject.digest)
    );
    checks.push({
      name: "minimum_signatures",
      passed: validSignatures.length >= policy.minSignatures,
      message: `${validSignatures.length}/${policy.minSignatures} valid signatures`,
    });

    // Check 2: Minimum log entries
    const validLogEntries = bundle.logEntries.filter((entry) =>
      this.verifyLogEntry(entry)
    );
    checks.push({
      name: "minimum_log_entries",
      passed: validLogEntries.length >= policy.minLogEntries,
      message: `${validLogEntries.length}/${policy.minLogEntries} valid log entries`,
    });

    // Check 3: Required attestations
    const attestationTypes = bundle.attestations.map((a) => a.type);
    const hasAllRequired = policy.requiredAttestations.every((req) =>
      attestationTypes.includes(req)
    );
    checks.push({
      name: "required_attestations",
      passed: hasAllRequired,
      message: hasAllRequired
        ? "All required attestations present"
        : `Missing: ${policy.requiredAttestations.filter((r) => !attestationTypes.includes(r)).join(", ")}`,
    });

    // Check 4: Registry allowlist (if configured)
    if (policy.allowedRegistries && policy.allowedRegistries.length > 0) {
      const registry = this.extractRegistry(bundle.subject.digest);
      const allowed = policy.allowedRegistries.some((r) => registry.startsWith(r));
      checks.push({
        name: "allowed_registry",
        passed: allowed,
        message: allowed ? `Registry ${registry} is allowed` : `Registry ${registry} not in allowlist`,
      });
    }

    const allPassed = checks.every((c) => c.passed);

    return {
      verified: allPassed,
      subject: bundle.subject.digest,
      policy: "default",
      checks,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Verify a signature against a trusted key
   */
  private verifySignature(sig: Signature, digest: string): boolean {
    if (!this.trustStore) return false;

    const key = this.trustStore.keys.find((k) => k.id === sig.keyId);
    if (!key) return false;
    if (key.trustLevel === "untrusted") return false;

    // Check expiration
    if (key.expires && new Date(key.expires) < new Date()) {
      return false;
    }

    // TODO: Actual cryptographic verification
    // For now, just check key exists and is trusted
    return key.trustLevel === "full" || key.trustLevel === "ultimate";
  }

  /**
   * Verify a log entry against trusted log operators
   */
  private verifyLogEntry(entry: LogEntry): boolean {
    if (!this.trustStore) return false;

    const log = this.trustStore.logs.find((l) => l.id === entry.logId);
    if (!log) return false;

    // TODO: Actual Merkle proof verification
    // For now, just check log exists
    return log.trustLevel === "full";
  }

  /**
   * Extract registry from image reference
   */
  private extractRegistry(ref: string): string {
    const parts = ref.split("/");
    if (parts.length > 1 && parts[0].includes(".")) {
      return parts[0];
    }
    return "docker.io";
  }

  /**
   * Get verification vectors for testing
   */
  async loadTestVectors(specPath: string): Promise<{
    valid: unknown[];
    invalid: unknown[];
    adversarial: unknown[];
  }> {
    const vectors = {
      valid: [] as unknown[],
      invalid: [] as unknown[],
      adversarial: [] as unknown[],
    };

    const vectorDirs = [
      { type: "valid", path: "vectors/valid/attestation-bundle" },
      { type: "invalid", path: "vectors/invalid/attestation-bundle" },
      { type: "adversarial", path: "vectors/adversarial" },
    ];

    for (const { type, path } of vectorDirs) {
      try {
        const dirPath = `${specPath}/${path}`;
        for await (const entry of Deno.readDir(dirPath)) {
          if (entry.isFile && entry.name.endsWith(".json")) {
            const content = await Deno.readTextFile(`${dirPath}/${entry.name}`);
            vectors[type as keyof typeof vectors].push(JSON.parse(content));
          }
        }
      } catch {
        // Directory may not exist
      }
    }

    return vectors;
  }
}
