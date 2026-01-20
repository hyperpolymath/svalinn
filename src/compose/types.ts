// SPDX-License-Identifier: PMPL-1.0-or-later
// Svalinn Compose - Type Definitions

/**
 * Compose file structure (mirrors svalinn-compose.v1.json schema)
 */

export interface ComposeFile {
  version: "1.0";
  name?: string;
  services: Record<string, Service>;
  networks?: Record<string, Network>;
  volumes?: Record<string, Volume>;
  secrets?: Record<string, Secret>;
  "x-svalinn"?: SvalinnExtension;
}

export interface Service {
  image: string;
  build?: string | BuildConfig;
  command?: string | string[];
  entrypoint?: string | string[];
  environment?: Record<string, string> | string[];
  env_file?: string | string[];
  ports?: (string | PortConfig)[];
  expose?: number[];
  volumes?: (string | VolumeMount)[];
  networks?: string[] | Record<string, NetworkConfig>;
  depends_on?: string[] | Record<string, DependsOnConfig>;
  healthcheck?: HealthCheck;
  restart?: "no" | "always" | "on-failure" | "unless-stopped";
  deploy?: DeployConfig;
  labels?: Record<string, string> | string[];
  logging?: LoggingConfig;
  secrets?: (string | SecretRef)[];
  "x-svalinn"?: ServiceSvalinnExtension;
}

export interface BuildConfig {
  context: string;
  dockerfile?: string;
  args?: Record<string, string>;
}

export interface PortConfig {
  target: number;
  published?: number;
  protocol?: "tcp" | "udp";
  host_ip?: string;
}

export interface VolumeMount {
  source?: string;
  target: string;
  type?: "bind" | "volume" | "tmpfs";
  read_only?: boolean;
}

export interface NetworkConfig {
  aliases?: string[];
  ipv4_address?: string;
  ipv6_address?: string;
}

export interface DependsOnConfig {
  condition: "service_started" | "service_healthy" | "service_completed_successfully";
}

export interface HealthCheck {
  test?: string | string[];
  interval?: string;
  timeout?: string;
  retries?: number;
  start_period?: string;
}

export interface DeployConfig {
  replicas?: number;
  resources?: {
    limits?: Resources;
    reservations?: Resources;
  };
  restart_policy?: {
    condition?: "none" | "on-failure" | "any";
    delay?: string;
    max_attempts?: number;
    window?: string;
  };
}

export interface Resources {
  cpus?: string;
  memory?: string;
  pids?: number;
}

export interface LoggingConfig {
  driver?: string;
  options?: Record<string, string>;
}

export interface SecretRef {
  source: string;
  target?: string;
  uid?: string;
  gid?: string;
  mode?: number;
}

export interface Network {
  driver?: string;
  driver_opts?: Record<string, string>;
  external?: boolean;
  internal?: boolean;
  ipam?: {
    driver?: string;
    config?: Array<{
      subnet?: string;
      gateway?: string;
    }>;
  };
  labels?: Record<string, string>;
}

export interface Volume {
  driver?: string;
  driver_opts?: Record<string, string>;
  external?: boolean;
  labels?: Record<string, string>;
}

export interface Secret {
  file?: string;
  environment?: string;
  external?: boolean;
}

export interface SvalinnExtension {
  policy?: "strict" | "standard" | "permissive";
  verify?: boolean;
  attestations?: {
    "require-sbom"?: boolean;
    "require-signature"?: boolean;
    "require-provenance"?: boolean;
  };
}

export interface ServiceSvalinnExtension {
  policy?: "strict" | "standard" | "permissive";
  verify?: boolean;
  "ctp-bundle"?: string;
}

/**
 * Runtime state for compose projects
 */

export type ServiceState = "pending" | "creating" | "running" | "stopped" | "failed" | "removed";

export interface ServiceInstance {
  name: string;
  containerId?: string;
  state: ServiceState;
  image: string;
  ports: PortMapping[];
  networks: string[];
  healthStatus?: "starting" | "healthy" | "unhealthy" | "none";
  startedAt?: Date;
  error?: string;
}

export interface PortMapping {
  containerPort: number;
  hostPort: number;
  protocol: "tcp" | "udp";
  hostIp?: string;
}

export interface ProjectState {
  name: string;
  composeFile: string;
  services: Record<string, ServiceInstance>;
  networks: string[];
  volumes: string[];
  createdAt: Date;
  status: "running" | "partial" | "stopped" | "failed";
}

export interface ComposeResult {
  success: boolean;
  project: string;
  services: Array<{
    name: string;
    containerId?: string;
    status: string;
    error?: string;
  }>;
  networks: string[];
  volumes: string[];
  duration: number;
}
