// SPDX-License-Identifier: PMPL-1.0-or-later
/**
 * Compose DSL Types for Svalinn
 * Fully ported to ReScript v12
 */

module Types = {
  type buildConfig = {
    context: string,
    dockerfile?: string,
    args?: Dict.t<string>,
  }

  type portConfig = {
    target: int,
    published?: int,
    protocol?: [ #tcp | #udp ],
    host_ip?: string,
  }

  type volumeMount = {
    source?: string,
    target: string,
    @as("type") type_?: [ #bind | #volume | #tmpfs ],
    read_only?: bool,
  }

  type networkConfig = {
    aliases?: array<string>,
    ipv4_address?: string,
    ipv6_address?: string,
  }

  type dependsOnConfig = {
    condition: [ #service_started | #service_healthy | #service_completed_successfully ],
  }

  type healthCheck = {
    test?: array<string>,
    interval?: string,
    timeout?: string,
    retries?: int,
    start_period?: string,
  }

  type resources = {
    cpus?: string,
    memory?: string,
    pids?: int,
  }

  type deployConfig = {
    replicas?: int,
    resources?: {
      limits?: resources,
      reservations?: resources,
    },
  }

  type svalinnExtension = {
    policy?: [ #strict | #standard | #permissive ],
    verify?: bool,
  }

  type service = {
    image: string,
    build?: buildConfig,
    command?: array<string>,
    environment?: Dict.t<string>,
    ports?: array<portConfig>,
    volumes?: array<volumeMount>,
    networks?: array<string>,
    depends_on?: Dict.t<dependsOnConfig>,
    healthcheck?: healthCheck,
    deploy?: deployConfig,
    @as("x-svalinn") x_svalinn?: svalinnExtension,
  }

  type composeFile = {
    version: string,
    name?: string,
    services: Dict.t<service>,
    networks?: Dict.t<JSON.t>,
    volumes?: Dict.t<JSON.t>,
  }

  type serviceState = [ #pending | #creating | #running | #stopped | #failed | #removed ]

  type portMapping = {
    containerPort: int,
    hostPort: int,
    protocol: [ #tcp | #udp ],
    hostIp?: string,
  }

  type serviceInstance = {
    name: string,
    containerId?: string,
    state: serviceState,
    image: string,
    ports: array<portMapping>,
    networks: array<string>,
    healthStatus?: [ #starting | #healthy | #unhealthy | #none ],
    startedAt?: string,
    error?: string,
  }

  type projectStatus = [ #running | #partial | #stopped | #failed ]

  type projectState = {
    name: string,
    composeFile: string,
    services: Dict.t<serviceInstance>,
    networks: array<string>,
    volumes: array<string>,
    createdAt: string,
    status: projectStatus,
  }

  type composeResult = {
    success: bool,
    project: string,
    services: array<{
      "name": string,
      "containerId": option<string>,
      "status": string,
      "error": option<string>,
    }>,
    networks: array<string>,
    volumes: array<string>,
    duration: float,
  }
}
