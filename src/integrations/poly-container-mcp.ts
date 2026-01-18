// SPDX-License-Identifier: PMPL-1.0-or-later
// Svalinn Integration - Poly Container MCP
//
// Integrates with hyperpolymath/poly-container-mcp for:
// - Multi-runtime container operations (nerdctl, podman, docker)
// - AI-assisted container management via MCP
// - FOSS-first runtime selection

/**
 * Container runtime priority (FOSS-first)
 */
export type ContainerRuntime = "nerdctl" | "podman" | "docker";

export const RUNTIME_PRIORITY: ContainerRuntime[] = ["nerdctl", "podman", "docker"];

/**
 * MCP tool categories from poly-container-mcp
 */
export type ToolCategory =
  | "container"
  | "image"
  | "network"
  | "volume"
  | "compose"
  | "system"
  | "buildx";

/**
 * Container operation result
 */
export interface ContainerResult {
  success: boolean;
  runtime: ContainerRuntime;
  containerId?: string;
  output?: string;
  error?: string;
}

/**
 * Image operation result
 */
export interface ImageResult {
  success: boolean;
  runtime: ContainerRuntime;
  imageId?: string;
  digest?: string;
  size?: number;
  error?: string;
}

/**
 * Runtime detection result
 */
export interface RuntimeInfo {
  runtime: ContainerRuntime;
  version: string;
  available: boolean;
  path?: string;
  rootless?: boolean;
}

/**
 * Poly Container MCP client
 *
 * Provides unified access to container operations across runtimes
 */
export class PolyContainerMcp {
  private mcpEndpoint: string;
  private preferredRuntime?: ContainerRuntime;
  private availableRuntimes: Map<ContainerRuntime, RuntimeInfo> = new Map();

  constructor(mcpEndpoint = "http://localhost:3000") {
    this.mcpEndpoint = mcpEndpoint;
  }

  /**
   * Detect available container runtimes
   */
  async detectRuntimes(): Promise<RuntimeInfo[]> {
    const results: RuntimeInfo[] = [];

    for (const runtime of RUNTIME_PRIORITY) {
      const info = await this.checkRuntime(runtime);
      results.push(info);
      if (info.available) {
        this.availableRuntimes.set(runtime, info);
      }
    }

    // Set preferred runtime to first available (FOSS-first)
    const firstAvailable = results.find((r) => r.available);
    if (firstAvailable) {
      this.preferredRuntime = firstAvailable.runtime;
    }

    return results;
  }

  /**
   * Check if a specific runtime is available
   */
  private async checkRuntime(runtime: ContainerRuntime): Promise<RuntimeInfo> {
    try {
      const command = new Deno.Command(runtime, {
        args: ["--version"],
        stdout: "piped",
        stderr: "piped",
      });

      const { code, stdout } = await command.output();
      const version = new TextDecoder().decode(stdout).trim();

      return {
        runtime,
        version: code === 0 ? version : "",
        available: code === 0,
        path: runtime,
        rootless: await this.checkRootless(runtime),
      };
    } catch {
      return {
        runtime,
        version: "",
        available: false,
      };
    }
  }

  /**
   * Check if runtime supports rootless mode
   */
  private async checkRootless(runtime: ContainerRuntime): Promise<boolean> {
    if (runtime === "docker") {
      // Docker rootless requires specific setup
      try {
        const command = new Deno.Command("docker", {
          args: ["context", "show"],
          stdout: "piped",
        });
        const { stdout } = await command.output();
        return new TextDecoder().decode(stdout).includes("rootless");
      } catch {
        return false;
      }
    }

    // nerdctl and podman are rootless by default on modern systems
    return runtime === "nerdctl" || runtime === "podman";
  }

  /**
   * Get the preferred (FOSS-first) runtime
   */
  getPreferredRuntime(): ContainerRuntime | undefined {
    return this.preferredRuntime;
  }

  /**
   * Set preferred runtime override
   */
  setPreferredRuntime(runtime: ContainerRuntime): void {
    this.preferredRuntime = runtime;
  }

  /**
   * Call an MCP tool via poly-container-mcp
   */
  async callTool(
    tool: string,
    args: Record<string, unknown>,
    runtime?: ContainerRuntime
  ): Promise<unknown> {
    const targetRuntime = runtime || this.preferredRuntime;

    const response = await fetch(this.mcpEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "tools/call",
        params: {
          name: tool,
          arguments: {
            ...args,
            runtime: targetRuntime,
          },
        },
        id: Date.now(),
      }),
    });

    const result = await response.json();
    if (result.error) {
      throw new Error(result.error.message);
    }
    return result.result;
  }

  // --- Container Operations ---

  async run(
    image: string,
    options: {
      name?: string;
      detach?: boolean;
      ports?: string[];
      volumes?: string[];
      env?: Record<string, string>;
      network?: string;
      runtime?: ContainerRuntime;
    } = {}
  ): Promise<ContainerResult> {
    const result = await this.callTool("container_run", {
      image,
      ...options,
    }, options.runtime);

    return result as ContainerResult;
  }

  async stop(containerId: string, runtime?: ContainerRuntime): Promise<ContainerResult> {
    const result = await this.callTool("container_stop", { containerId }, runtime);
    return result as ContainerResult;
  }

  async rm(containerId: string, options: { force?: boolean; volumes?: boolean } = {}): Promise<ContainerResult> {
    const result = await this.callTool("container_rm", { containerId, ...options });
    return result as ContainerResult;
  }

  async ps(options: { all?: boolean; filter?: string } = {}): Promise<unknown[]> {
    const result = await this.callTool("container_ps", options);
    return result as unknown[];
  }

  async logs(containerId: string, options: { follow?: boolean; tail?: number } = {}): Promise<string> {
    const result = await this.callTool("container_logs", { containerId, ...options });
    return (result as { logs: string }).logs;
  }

  async exec(
    containerId: string,
    command: string[],
    options: { interactive?: boolean; tty?: boolean } = {}
  ): Promise<ContainerResult> {
    const result = await this.callTool("container_exec", {
      containerId,
      command,
      ...options,
    });
    return result as ContainerResult;
  }

  // --- Image Operations ---

  async pull(image: string, runtime?: ContainerRuntime): Promise<ImageResult> {
    const result = await this.callTool("image_pull", { image }, runtime);
    return result as ImageResult;
  }

  async push(image: string, runtime?: ContainerRuntime): Promise<ImageResult> {
    const result = await this.callTool("image_push", { image }, runtime);
    return result as ImageResult;
  }

  async build(
    context: string,
    options: {
      tag?: string;
      dockerfile?: string;
      buildArgs?: Record<string, string>;
      runtime?: ContainerRuntime;
    } = {}
  ): Promise<ImageResult> {
    const result = await this.callTool("image_build", { context, ...options }, options.runtime);
    return result as ImageResult;
  }

  async images(options: { filter?: string } = {}): Promise<unknown[]> {
    const result = await this.callTool("image_ls", options);
    return result as unknown[];
  }

  async rmi(image: string, options: { force?: boolean } = {}): Promise<ImageResult> {
    const result = await this.callTool("image_rm", { image, ...options });
    return result as ImageResult;
  }

  // --- Network Operations ---

  async networkCreate(
    name: string,
    options: { driver?: string; subnet?: string } = {}
  ): Promise<unknown> {
    return this.callTool("network_create", { name, ...options });
  }

  async networkRm(name: string): Promise<unknown> {
    return this.callTool("network_rm", { name });
  }

  async networkLs(): Promise<unknown[]> {
    const result = await this.callTool("network_ls", {});
    return result as unknown[];
  }

  // --- Volume Operations ---

  async volumeCreate(name: string, options: { driver?: string } = {}): Promise<unknown> {
    return this.callTool("volume_create", { name, ...options });
  }

  async volumeRm(name: string, options: { force?: boolean } = {}): Promise<unknown> {
    return this.callTool("volume_rm", { name, ...options });
  }

  async volumeLs(): Promise<unknown[]> {
    const result = await this.callTool("volume_ls", {});
    return result as unknown[];
  }

  // --- Compose Operations ---

  async composeUp(
    file: string,
    options: { detach?: boolean; build?: boolean } = {}
  ): Promise<unknown> {
    return this.callTool("compose_up", { file, ...options });
  }

  async composeDown(
    file: string,
    options: { volumes?: boolean } = {}
  ): Promise<unknown> {
    return this.callTool("compose_down", { file, ...options });
  }

  async composePs(file: string): Promise<unknown[]> {
    const result = await this.callTool("compose_ps", { file });
    return result as unknown[];
  }
}
