// SPDX-License-Identifier: PMPL-1.0-or-later
// Svalinn Integration - Cerro Torre
//
// Integrates with hyperpolymath/cerro-torre for:
// - .ctp bundle verification and execution
// - Supply-chain verified image building
// - SPARK-verified cryptographic operations

/**
 * Cerro Torre manifest (.ctp file)
 */
export interface CtpManifest {
  manifestVersion: string;
  package: {
    name: string;
    version: string;
    summary?: string;
    description?: string;
    license?: string;
    maintainer?: string;
  };
  provenance: {
    upstreamUrl?: string;
    upstreamHash?: {
      algorithm: "sha256" | "sha512";
      digest: string;
    };
    importedFrom?: string;
    importDate?: string;
    buildDate?: string;
  };
  build?: {
    system?: "autotools" | "cmake" | "meson" | "cargo" | "go" | "custom";
    dependencies?: string[];
    script?: string[];
  };
  outputs?: {
    files?: Array<{
      path: string;
      hash: string;
      size?: number;
    }>;
  };
  attestations?: {
    sbom?: string;
    provenance?: string;
    signature?: string;
  };
}

/**
 * Cerro Torre bundle (.ctp tar archive)
 */
export interface CtpBundle {
  path: string;
  manifest: CtpManifest;
  summary?: {
    contentHash: string;
    manifestHash: string;
    totalSize: number;
    fileCount: number;
  };
  signatures: Array<{
    keyId: string;
    algorithm: string;
    signature: string;
  }>;
  attestations: {
    sbom?: unknown;
    provenance?: unknown;
  };
}

/**
 * Verification exit codes (from Cerro Torre)
 */
export enum VerifyExitCode {
  SUCCESS = 0,
  HASH_MISMATCH = 1,
  SIGNATURE_INVALID = 2,
  KEY_NOT_TRUSTED = 3,
  POLICY_REJECTION = 4,
  MISSING_ATTESTATION = 5,
  MALFORMED_BUNDLE = 10,
  IO_ERROR = 11,
}

/**
 * Verification result
 */
export interface CtpVerifyResult {
  valid: boolean;
  exitCode: VerifyExitCode;
  bundle: string;
  manifest?: CtpManifest;
  checks: Array<{
    name: string;
    passed: boolean;
    message?: string;
  }>;
  timestamp: string;
}

/**
 * Run result
 */
export interface CtpRunResult {
  success: boolean;
  containerId?: string;
  runtime: string;
  exitCode: number;
  output?: string;
  error?: string;
}

/**
 * Cerro Torre integration client
 */
export class CerroTorre {
  private ctPath: string;
  private defaultRuntime: string;
  private trustStorePath?: string;
  private policyPath?: string;

  constructor(options: {
    ctPath?: string;
    runtime?: string;
    trustStore?: string;
    policy?: string;
  } = {}) {
    this.ctPath = options.ctPath || "ct";
    this.defaultRuntime = options.runtime || "svalinn";
    this.trustStorePath = options.trustStore;
    this.policyPath = options.policy;
  }

  /**
   * Check if Cerro Torre CLI is available
   */
  async isAvailable(): Promise<boolean> {
    try {
      const command = new Deno.Command(this.ctPath, {
        args: ["version"],
        stdout: "piped",
        stderr: "piped",
      });
      const { code } = await command.output();
      return code === 0;
    } catch {
      return false;
    }
  }

  /**
   * Get Cerro Torre version
   */
  async version(): Promise<string> {
    const command = new Deno.Command(this.ctPath, {
      args: ["version", "--json"],
      stdout: "piped",
    });
    const { stdout } = await command.output();
    const output = new TextDecoder().decode(stdout);

    try {
      const info = JSON.parse(output);
      return info.version || output.trim();
    } catch {
      return output.trim();
    }
  }

  /**
   * Verify a .ctp bundle
   */
  async verify(
    bundlePath: string,
    options: {
      policy?: string;
      trustStore?: string;
      checkSbom?: boolean;
      checkSignature?: boolean;
      checkProvenance?: boolean;
    } = {},
  ): Promise<CtpVerifyResult> {
    const args = ["verify", bundlePath];

    const policy = options.policy || this.policyPath;
    if (policy) {
      args.push("--policy", policy);
    }

    const trustStore = options.trustStore || this.trustStorePath;
    if (trustStore) {
      args.push("--trust-store", trustStore);
    }

    if (options.checkSbom === false) {
      args.push("--no-sbom");
    }
    if (options.checkSignature === false) {
      args.push("--no-signature");
    }
    if (options.checkProvenance === false) {
      args.push("--no-provenance");
    }

    const command = new Deno.Command(this.ctPath, {
      args,
      stdout: "piped",
      stderr: "piped",
    });

    const { code, stdout, stderr } = await command.output();
    const output = new TextDecoder().decode(stdout);
    const errorOutput = new TextDecoder().decode(stderr);

    // Parse checks from output
    const checks = this.parseVerifyOutput(output, errorOutput);

    return {
      valid: code === 0,
      exitCode: code as VerifyExitCode,
      bundle: bundlePath,
      checks,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Parse manifest from a bundle
   */
  async parseManifest(bundlePath: string): Promise<CtpManifest> {
    // Use ct to extract and parse manifest
    const command = new Deno.Command(this.ctPath, {
      args: ["inspect", bundlePath, "--json"],
      stdout: "piped",
      stderr: "piped",
    });

    const { code, stdout, stderr } = await command.output();

    if (code !== 0) {
      const error = new TextDecoder().decode(stderr);
      throw new Error(`Failed to parse manifest: ${error}`);
    }

    const output = new TextDecoder().decode(stdout);
    return JSON.parse(output) as CtpManifest;
  }

  /**
   * Run a verified .ctp bundle
   *
   * This is the key integration point - ct run delegates to Svalinn/Vörðr
   */
  async run(
    bundlePath: string,
    options: {
      runtime?: string;
      verify?: boolean;
      policy?: string;
      args?: string[];
      env?: Record<string, string>;
      ports?: string[];
      volumes?: string[];
      detach?: boolean;
    } = {},
  ): Promise<CtpRunResult> {
    // Step 1: Verify bundle first (unless explicitly skipped)
    if (options.verify !== false) {
      const verifyResult = await this.verify(bundlePath, {
        policy: options.policy,
      });

      if (!verifyResult.valid) {
        return {
          success: false,
          runtime: options.runtime || this.defaultRuntime,
          exitCode: verifyResult.exitCode,
          error: `Verification failed: exit code ${verifyResult.exitCode}`,
        };
      }
    }

    // Step 2: Run via ct run command
    const args = ["run", bundlePath];

    const runtime = options.runtime || this.defaultRuntime;
    args.push("--runtime", runtime);

    if (options.detach) {
      args.push("-d");
    }

    // Add port mappings
    if (options.ports) {
      for (const port of options.ports) {
        args.push("-p", port);
      }
    }

    // Add volume mounts
    if (options.volumes) {
      for (const vol of options.volumes) {
        args.push("-v", vol);
      }
    }

    // Add environment variables
    if (options.env) {
      for (const [key, value] of Object.entries(options.env)) {
        args.push("-e", `${key}=${value}`);
      }
    }

    // Pass through additional args
    if (options.args && options.args.length > 0) {
      args.push("--", ...options.args);
    }

    const command = new Deno.Command(this.ctPath, {
      args,
      stdout: "piped",
      stderr: "piped",
      env: options.env,
    });

    const { code, stdout, stderr } = await command.output();
    const output = new TextDecoder().decode(stdout);
    const errorOutput = new TextDecoder().decode(stderr);

    // Parse container ID from output
    const containerId = this.parseContainerId(output);

    return {
      success: code === 0,
      containerId,
      runtime,
      exitCode: code,
      output: output.trim(),
      error: code !== 0 ? errorOutput.trim() : undefined,
    };
  }

  /**
   * Pack a directory into a .ctp bundle
   */
  async pack(
    manifestPath: string,
    outputPath: string,
    options: {
      sign?: boolean;
      keyId?: string;
    } = {},
  ): Promise<{ success: boolean; bundlePath?: string; error?: string }> {
    const args = ["pack", manifestPath, "-o", outputPath];

    if (options.sign && options.keyId) {
      args.push("--sign", options.keyId);
    }

    const command = new Deno.Command(this.ctPath, {
      args,
      stdout: "piped",
      stderr: "piped",
    });

    const { code, stderr } = await command.output();
    const errorOutput = new TextDecoder().decode(stderr);

    return {
      success: code === 0,
      bundlePath: code === 0 ? outputPath : undefined,
      error: code !== 0 ? errorOutput.trim() : undefined,
    };
  }

  /**
   * List trusted keys
   */
  async keyList(): Promise<
    Array<{
      id: string;
      algorithm: string;
      trustLevel: string;
      expires?: string;
    }>
  > {
    const command = new Deno.Command(this.ctPath, {
      args: ["key", "list", "--json"],
      stdout: "piped",
    });

    const { code, stdout } = await command.output();

    if (code !== 0) {
      return [];
    }

    const output = new TextDecoder().decode(stdout);
    try {
      return JSON.parse(output);
    } catch {
      return [];
    }
  }

  /**
   * Import a public key
   */
  async keyImport(
    keyPath: string,
    options: { trustLevel?: "marginal" | "full" | "ultimate" } = {},
  ): Promise<{ success: boolean; keyId?: string; error?: string }> {
    const args = ["key", "import", keyPath];

    if (options.trustLevel) {
      args.push("--trust", options.trustLevel);
    }

    const command = new Deno.Command(this.ctPath, {
      args,
      stdout: "piped",
      stderr: "piped",
    });

    const { code, stdout, stderr } = await command.output();
    const output = new TextDecoder().decode(stdout);
    const errorOutput = new TextDecoder().decode(stderr);

    return {
      success: code === 0,
      keyId: code === 0 ? output.trim() : undefined,
      error: code !== 0 ? errorOutput.trim() : undefined,
    };
  }

  // --- Private helpers ---

  private parseVerifyOutput(
    stdout: string,
    stderr: string,
  ): Array<{ name: string; passed: boolean; message?: string }> {
    const checks: Array<{ name: string; passed: boolean; message?: string }> = [];

    // Parse structured output if available
    const lines = (stdout + stderr).split("\n");

    for (const line of lines) {
      if (line.includes("✓") || line.includes("PASS")) {
        const name = line.replace(/[✓✔]|\[PASS\]/g, "").trim();
        checks.push({ name, passed: true });
      } else if (line.includes("✗") || line.includes("FAIL")) {
        const name = line.replace(/[✗✘]|\[FAIL\]/g, "").trim();
        checks.push({ name, passed: false, message: line });
      }
    }

    // If no structured output, add generic checks
    if (checks.length === 0) {
      checks.push({
        name: "bundle_verification",
        passed: !stderr.includes("error"),
        message: stderr || stdout,
      });
    }

    return checks;
  }

  private parseContainerId(output: string): string | undefined {
    // Look for container ID pattern (12+ hex chars)
    const match = output.match(/^([a-f0-9]{12,64})$/m);
    return match?.[1];
  }
}
