// SPDX-License-Identifier: PMPL-1.0-or-later
// Svalinn Compose - Orchestrator

import { parse as parseYaml } from "jsr:@std/yaml@^1";
import { join, dirname, basename } from "@std/path";
import type {
  ComposeFile,
  Service,
  ServiceInstance,
  ProjectState,
  ComposeResult,
  PortConfig,
  PortMapping,
  DependsOnConfig,
} from "./types.ts";

/**
 * Compose Orchestrator - manages multi-container applications
 */
export class ComposeOrchestrator {
  private svalinnEndpoint: string;
  private projects: Map<string, ProjectState> = new Map();

  constructor(svalinnEndpoint = "http://localhost:8000") {
    this.svalinnEndpoint = svalinnEndpoint;
  }

  /**
   * Load and parse a compose file
   */
  async loadComposeFile(filePath: string): Promise<ComposeFile> {
    const content = await Deno.readTextFile(filePath);
    const parsed = parseYaml(content) as ComposeFile;

    // Validate version
    if (parsed.version !== "1.0") {
      throw new Error(`Unsupported compose version: ${parsed.version}. Expected 1.0`);
    }

    // Set project name if not specified
    if (!parsed.name) {
      parsed.name = basename(dirname(filePath));
    }

    return parsed;
  }

  /**
   * Start all services in a compose file
   */
  async up(
    composeFile: ComposeFile,
    options: { detach?: boolean; build?: boolean; forceRecreate?: boolean } = {}
  ): Promise<ComposeResult> {
    const startTime = Date.now();
    const projectName = composeFile.name!;
    const results: ComposeResult["services"] = [];
    const createdNetworks: string[] = [];
    const createdVolumes: string[] = [];

    console.log(`Starting project: ${projectName}`);

    // Initialize project state
    const project: ProjectState = {
      name: projectName,
      composeFile: "",
      services: {},
      networks: [],
      volumes: [],
      createdAt: new Date(),
      status: "running",
    };

    try {
      // 1. Create networks
      if (composeFile.networks) {
        for (const [name, _config] of Object.entries(composeFile.networks)) {
          const networkName = `${projectName}_${name}`;
          console.log(`  Creating network: ${networkName}`);
          await this.createNetwork(networkName);
          createdNetworks.push(networkName);
        }
      }

      // 2. Create volumes
      if (composeFile.volumes) {
        for (const [name, _config] of Object.entries(composeFile.volumes)) {
          const volumeName = `${projectName}_${name}`;
          console.log(`  Creating volume: ${volumeName}`);
          await this.createVolume(volumeName);
          createdVolumes.push(volumeName);
        }
      }

      // 3. Resolve service startup order (topological sort based on depends_on)
      const startupOrder = this.resolveStartupOrder(composeFile.services);

      // 4. Start services in order
      for (const serviceName of startupOrder) {
        const service = composeFile.services[serviceName];
        const containerName = `${projectName}_${serviceName}_1`;

        console.log(`  Starting service: ${serviceName}`);

        const instance: ServiceInstance = {
          name: serviceName,
          state: "creating",
          image: service.image,
          ports: [],
          networks: [],
        };

        project.services[serviceName] = instance;

        try {
          // Wait for dependencies if needed
          await this.waitForDependencies(service, project);

          // Verify image if required
          const svalinnExt = service["x-svalinn"] || composeFile["x-svalinn"];
          if (svalinnExt?.verify !== false) {
            console.log(`    Verifying image: ${service.image}`);
            await this.verifyImage(service.image);
          }

          // Run container via Svalinn
          const containerId = await this.runContainer(
            containerName,
            service,
            projectName,
            createdNetworks
          );

          instance.containerId = containerId;
          instance.state = "running";
          instance.startedAt = new Date();
          instance.ports = this.parsePortMappings(service.ports || []);
          instance.networks = createdNetworks;

          results.push({
            name: serviceName,
            containerId,
            status: "running",
          });

          console.log(`    Started: ${containerId.substring(0, 12)}`);
        } catch (error) {
          instance.state = "failed";
          instance.error = String(error);
          project.status = "partial";

          results.push({
            name: serviceName,
            status: "failed",
            error: String(error),
          });

          console.error(`    Failed: ${error}`);
        }
      }

      project.networks = createdNetworks;
      project.volumes = createdVolumes;
      this.projects.set(projectName, project);

      const allSucceeded = results.every((r) => r.status === "running");
      if (allSucceeded) {
        project.status = "running";
      }

      return {
        success: allSucceeded,
        project: projectName,
        services: results,
        networks: createdNetworks,
        volumes: createdVolumes,
        duration: Date.now() - startTime,
      };
    } catch (error) {
      // Rollback on catastrophic failure
      console.error(`Project startup failed: ${error}`);
      await this.down(projectName, { removeVolumes: false });
      throw error;
    }
  }

  /**
   * Stop and remove all services in a project
   */
  async down(
    projectName: string,
    options: { removeVolumes?: boolean; removeOrphans?: boolean } = {}
  ): Promise<ComposeResult> {
    const startTime = Date.now();
    const results: ComposeResult["services"] = [];
    const project = this.projects.get(projectName);

    console.log(`Stopping project: ${projectName}`);

    if (project) {
      // Stop services in reverse order
      const serviceNames = Object.keys(project.services).reverse();

      for (const name of serviceNames) {
        const instance = project.services[name];

        if (instance.containerId) {
          try {
            console.log(`  Stopping: ${name}`);
            await this.stopContainer(instance.containerId);
            await this.removeContainer(instance.containerId);
            instance.state = "removed";

            results.push({
              name,
              containerId: instance.containerId,
              status: "removed",
            });
          } catch (error) {
            results.push({
              name,
              containerId: instance.containerId,
              status: "failed",
              error: String(error),
            });
          }
        }
      }

      // Remove networks
      for (const network of project.networks) {
        console.log(`  Removing network: ${network}`);
        await this.removeNetwork(network).catch(() => {});
      }

      // Remove volumes if requested
      if (options.removeVolumes) {
        for (const volume of project.volumes) {
          console.log(`  Removing volume: ${volume}`);
          await this.removeVolume(volume).catch(() => {});
        }
      }

      project.status = "stopped";
      this.projects.delete(projectName);
    }

    return {
      success: true,
      project: projectName,
      services: results,
      networks: project?.networks || [],
      volumes: options.removeVolumes ? (project?.volumes || []) : [],
      duration: Date.now() - startTime,
    };
  }

  /**
   * List running services in a project
   */
  async ps(projectName?: string): Promise<ProjectState[]> {
    if (projectName) {
      const project = this.projects.get(projectName);
      return project ? [project] : [];
    }
    return Array.from(this.projects.values());
  }

  /**
   * Restart services
   */
  async restart(projectName: string, services?: string[]): Promise<void> {
    const project = this.projects.get(projectName);
    if (!project) {
      throw new Error(`Project not found: ${projectName}`);
    }

    const targetServices = services || Object.keys(project.services);

    for (const name of targetServices) {
      const instance = project.services[name];
      if (instance?.containerId) {
        console.log(`  Restarting: ${name}`);
        await this.callSvalinn("POST", `/v1/containers/${instance.containerId}/restart`);
      }
    }
  }

  /**
   * Scale a service
   */
  async scale(
    projectName: string,
    serviceName: string,
    replicas: number
  ): Promise<void> {
    // Note: Full implementation would track multiple containers per service
    console.log(`Scaling ${projectName}/${serviceName} to ${replicas} replicas`);
    // TODO: Implement replica management
  }

  /**
   * Get logs from services
   */
  async logs(
    projectName: string,
    options: { services?: string[]; follow?: boolean; tail?: number } = {}
  ): Promise<AsyncIterable<string>> {
    const project = this.projects.get(projectName);
    if (!project) {
      throw new Error(`Project not found: ${projectName}`);
    }

    const targetServices = options.services || Object.keys(project.services);

    // Return combined log stream
    async function* generateLogs(orchestrator: ComposeOrchestrator) {
      for (const name of targetServices) {
        const instance = project!.services[name];
        if (instance?.containerId) {
          const logs = await orchestrator.getContainerLogs(
            instance.containerId,
            options.tail
          );
          for (const line of logs.split("\n")) {
            yield `${name} | ${line}`;
          }
        }
      }
    }

    return generateLogs(this);
  }

  // --- Private helper methods ---

  private resolveStartupOrder(services: Record<string, Service>): string[] {
    const order: string[] = [];
    const visited = new Set<string>();
    const visiting = new Set<string>();

    const visit = (name: string) => {
      if (visited.has(name)) return;
      if (visiting.has(name)) {
        throw new Error(`Circular dependency detected involving service: ${name}`);
      }

      visiting.add(name);

      const service = services[name];
      const deps = this.getDependencies(service);

      for (const dep of deps) {
        if (!services[dep]) {
          throw new Error(`Service '${name}' depends on undefined service '${dep}'`);
        }
        visit(dep);
      }

      visiting.delete(name);
      visited.add(name);
      order.push(name);
    };

    for (const name of Object.keys(services)) {
      visit(name);
    }

    return order;
  }

  private getDependencies(service: Service): string[] {
    if (!service.depends_on) return [];

    if (Array.isArray(service.depends_on)) {
      return service.depends_on;
    }

    return Object.keys(service.depends_on);
  }

  private async waitForDependencies(
    service: Service,
    project: ProjectState
  ): Promise<void> {
    if (!service.depends_on) return;

    const deps = Array.isArray(service.depends_on)
      ? service.depends_on.map((d) => ({ name: d, condition: "service_started" as const }))
      : Object.entries(service.depends_on).map(([name, config]) => ({
          name,
          condition: (config as DependsOnConfig).condition,
        }));

    for (const dep of deps) {
      const instance = project.services[dep.name];

      switch (dep.condition) {
        case "service_started":
          // Just need it to be running
          if (instance?.state !== "running") {
            throw new Error(`Dependency '${dep.name}' is not running`);
          }
          break;

        case "service_healthy":
          // Wait for health check to pass
          await this.waitForHealthy(instance?.containerId);
          break;

        case "service_completed_successfully":
          // Wait for container to exit with code 0
          // (used for init containers)
          await this.waitForExit(instance?.containerId, 0);
          break;
      }
    }
  }

  private async waitForHealthy(
    containerId?: string,
    timeout = 60000
  ): Promise<void> {
    if (!containerId) return;

    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const health = await this.getContainerHealth(containerId);
      if (health === "healthy") return;
      if (health === "unhealthy") {
        throw new Error("Container health check failed");
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    throw new Error("Timeout waiting for container to become healthy");
  }

  private async waitForExit(
    containerId?: string,
    expectedCode = 0
  ): Promise<void> {
    if (!containerId) return;
    // TODO: Implement wait for container exit
  }

  private parsePortMappings(ports: (string | PortConfig)[]): PortMapping[] {
    return ports.map((port) => {
      if (typeof port === "string") {
        const [hostPart, containerPart] = port.split(":");
        const [containerPort, proto] = (containerPart || hostPart).split("/");
        return {
          containerPort: parseInt(containerPort),
          hostPort: containerPart ? parseInt(hostPart) : parseInt(containerPort),
          protocol: (proto as "tcp" | "udp") || "tcp",
        };
      }
      return {
        containerPort: port.target,
        hostPort: port.published || port.target,
        protocol: port.protocol || "tcp",
        hostIp: port.host_ip,
      };
    });
  }

  // --- Svalinn API calls ---

  private async callSvalinn(
    method: string,
    path: string,
    body?: unknown
  ): Promise<unknown> {
    const response = await fetch(`${this.svalinnEndpoint}${path}`, {
      method,
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: response.statusText }));
      throw new Error(error.message || `HTTP ${response.status}`);
    }

    return response.json();
  }

  private async verifyImage(image: string): Promise<void> {
    await this.callSvalinn("POST", "/v1/verify", {
      imageRef: image,
      checkSbom: true,
      checkSignature: true,
    });
  }

  private async runContainer(
    name: string,
    service: Service,
    projectName: string,
    networks: string[]
  ): Promise<string> {
    const result = (await this.callSvalinn("POST", "/v1/run", {
      imageName: service.image,
      name,
      command: service.command,
      entrypoint: service.entrypoint,
      environment: this.normalizeEnv(service.environment),
      ports: service.ports,
      volumes: service.volumes,
      labels: {
        "svalinn.project": projectName,
        "svalinn.service": name,
        ...(typeof service.labels === "object" && !Array.isArray(service.labels)
          ? service.labels
          : {}),
      },
    })) as { containerId: string };

    return result.containerId;
  }

  private normalizeEnv(
    env?: Record<string, string> | string[]
  ): Record<string, string> {
    if (!env) return {};
    if (Array.isArray(env)) {
      const result: Record<string, string> = {};
      for (const item of env) {
        const [key, ...valueParts] = item.split("=");
        result[key] = valueParts.join("=");
      }
      return result;
    }
    return env;
  }

  private async stopContainer(containerId: string): Promise<void> {
    await this.callSvalinn("POST", `/v1/containers/${containerId}/stop`);
  }

  private async removeContainer(containerId: string): Promise<void> {
    await this.callSvalinn("DELETE", `/v1/containers/${containerId}`);
  }

  private async getContainerLogs(
    containerId: string,
    tail?: number
  ): Promise<string> {
    const result = (await this.callSvalinn(
      "GET",
      `/v1/containers/${containerId}/logs${tail ? `?tail=${tail}` : ""}`
    )) as { logs: string };
    return result.logs || "";
  }

  private async getContainerHealth(containerId: string): Promise<string> {
    const result = (await this.callSvalinn(
      "GET",
      `/v1/containers/${containerId}`
    )) as { health?: string };
    return result.health || "none";
  }

  private async createNetwork(name: string): Promise<void> {
    // TODO: Implement via Vörðr when network API is ready
    console.log(`    (network creation deferred: ${name})`);
  }

  private async removeNetwork(name: string): Promise<void> {
    // TODO: Implement via Vörðr
  }

  private async createVolume(name: string): Promise<void> {
    // TODO: Implement via Vörðr when volume API is ready
    console.log(`    (volume creation deferred: ${name})`);
  }

  private async removeVolume(name: string): Promise<void> {
    // TODO: Implement via Vörðr
  }
}
