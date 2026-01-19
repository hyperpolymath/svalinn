#!/usr/bin/env -S deno run --allow-net --allow-read --allow-env
// SPDX-License-Identifier: PMPL-1.0-or-later
// Svalinn Compose - CLI Entry Point

import { parseArgs } from "jsr:@std/cli@^1/parse-args";
import { join } from "@std/path";
import { exists } from "@std/fs";
import { ComposeOrchestrator } from "./orchestrator.ts";
import type { ComposeFile } from "./types.ts";

const VERSION = "0.1.0";

const HELP = `
╔═══════════════════════════════════════════════════════════════════╗
║                     Svalinn Compose                                ║
║        Multi-Container Orchestration with Edge Security            ║
╚═══════════════════════════════════════════════════════════════════╝

USAGE:
    svalinn-compose [OPTIONS] COMMAND [ARGS]

COMMANDS:
    up          Create and start containers
    down        Stop and remove containers, networks, volumes
    ps          List containers
    logs        View output from containers
    restart     Restart services
    scale       Scale services
    config      Validate and view compose file
    version     Show version information

OPTIONS:
    -f, --file <file>       Compose file (default: svalinn-compose.yaml)
    -p, --project <name>    Project name (default: directory name)
    --endpoint <url>        Svalinn endpoint (default: http://localhost:8000)
    -h, --help              Show this help message
    -v, --version           Show version

EXAMPLES:
    svalinn-compose up                      # Start all services
    svalinn-compose up -d                   # Start in detached mode
    svalinn-compose down                    # Stop all services
    svalinn-compose down -v                 # Stop and remove volumes
    svalinn-compose ps                      # List running services
    svalinn-compose logs -f web             # Follow logs from 'web' service
    svalinn-compose restart db              # Restart 'db' service
    svalinn-compose scale web=3             # Scale 'web' to 3 replicas
    svalinn-compose config                  # Validate compose file

COMPOSE FILE FORMAT:
    Svalinn Compose uses a Docker Compose-compatible YAML format with
    additional security extensions under 'x-svalinn':

    version: "1.0"
    services:
      web:
        image: nginx:alpine
        ports:
          - "8080:80"
        x-svalinn:
          policy: strict
          verify: true

    x-svalinn:
      policy: standard
      attestations:
        require-sbom: true
        require-signature: true

For more information, visit: https://svalinn.dev/compose
`;

async function findComposeFile(specified?: string): Promise<string> {
  if (specified) {
    if (await exists(specified)) {
      return specified;
    }
    throw new Error(`Compose file not found: ${specified}`);
  }

  // Search for common names
  const candidates = [
    "svalinn-compose.yaml",
    "svalinn-compose.yml",
    "compose.yaml",
    "compose.yml",
    "docker-compose.yaml",
    "docker-compose.yml",
  ];

  for (const name of candidates) {
    const path = join(Deno.cwd(), name);
    if (await exists(path)) {
      return path;
    }
  }

  throw new Error(
    "No compose file found. Create svalinn-compose.yaml or specify with -f",
  );
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
}

function formatTable(
  headers: string[],
  rows: string[][],
  columnWidths?: number[],
): string {
  const widths = columnWidths ||
    headers.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] || "").length)));

  const separator = widths.map((w) => "─".repeat(w + 2)).join("┼");
  const headerRow = headers
    .map((h, i) => ` ${h.padEnd(widths[i])} `)
    .join("│");
  const dataRows = rows
    .map((row) => row.map((cell, i) => ` ${(cell || "").padEnd(widths[i])} `).join("│"))
    .join("\n");

  return `${headerRow}\n─${separator}─\n${dataRows}`;
}

async function cmdUp(
  orchestrator: ComposeOrchestrator,
  composeFile: ComposeFile,
  args: ReturnType<typeof parseArgs>,
): Promise<void> {
  console.log(`\n🚀 Starting project: ${composeFile.name}\n`);

  const result = await orchestrator.up(composeFile, {
    detach: args.d || args.detach,
    build: args.build,
    forceRecreate: args["force-recreate"],
  });

  console.log("\n" + "═".repeat(60));

  if (result.success) {
    console.log(`✓ Project started successfully in ${formatDuration(result.duration)}`);
  } else {
    console.log(`⚠ Project started with errors in ${formatDuration(result.duration)}`);
  }

  console.log(`\nServices: ${result.services.length}`);
  console.log(`Networks: ${result.networks.length}`);
  console.log(`Volumes:  ${result.volumes.length}`);

  if (!result.success) {
    const failed = result.services.filter((s) => s.status === "failed");
    console.log(`\nFailed services:`);
    for (const s of failed) {
      console.log(`  - ${s.name}: ${s.error}`);
    }
    Deno.exit(1);
  }
}

async function cmdDown(
  orchestrator: ComposeOrchestrator,
  composeFile: ComposeFile,
  args: ReturnType<typeof parseArgs>,
): Promise<void> {
  console.log(`\n🛑 Stopping project: ${composeFile.name}\n`);

  const result = await orchestrator.down(composeFile.name!, {
    removeVolumes: args.v || args.volumes,
    removeOrphans: args["remove-orphans"],
  });

  console.log("\n" + "═".repeat(60));
  console.log(`✓ Project stopped in ${formatDuration(result.duration)}`);
  console.log(`\nRemoved: ${result.services.length} containers`);

  if (args.v || args.volumes) {
    console.log(`Removed: ${result.volumes.length} volumes`);
  }
}

async function cmdPs(
  orchestrator: ComposeOrchestrator,
  composeFile: ComposeFile,
): Promise<void> {
  const projects = await orchestrator.ps(composeFile.name);

  if (projects.length === 0) {
    console.log("No running services found.");
    return;
  }

  for (const project of projects) {
    console.log(`\nProject: ${project.name}`);
    console.log("═".repeat(60));

    const rows = Object.entries(project.services).map(([name, instance]) => [
      name,
      instance.containerId?.substring(0, 12) || "-",
      instance.image,
      instance.state,
      instance.ports.map((p) => `${p.hostPort}:${p.containerPort}`).join(", ") ||
      "-",
    ]);

    console.log(
      formatTable(["SERVICE", "CONTAINER ID", "IMAGE", "STATUS", "PORTS"], rows),
    );
  }
}

async function cmdLogs(
  orchestrator: ComposeOrchestrator,
  composeFile: ComposeFile,
  args: ReturnType<typeof parseArgs>,
): Promise<void> {
  const services = args._.slice(1).map(String);

  const logs = await orchestrator.logs(composeFile.name!, {
    services: services.length > 0 ? services : undefined,
    follow: args.f || args.follow,
    tail: args.tail ? parseInt(String(args.tail)) : undefined,
  });

  for await (const line of logs) {
    console.log(line);
  }
}

async function cmdRestart(
  orchestrator: ComposeOrchestrator,
  composeFile: ComposeFile,
  args: ReturnType<typeof parseArgs>,
): Promise<void> {
  const services = args._.slice(1).map(String);

  console.log(`\n🔄 Restarting services...\n`);

  await orchestrator.restart(
    composeFile.name!,
    services.length > 0 ? services : undefined,
  );

  console.log("✓ Services restarted");
}

async function cmdScale(
  orchestrator: ComposeOrchestrator,
  composeFile: ComposeFile,
  args: ReturnType<typeof parseArgs>,
): Promise<void> {
  const scaleArgs = args._.slice(1).map(String);

  for (const arg of scaleArgs) {
    const [service, countStr] = arg.split("=");
    const count = parseInt(countStr);

    if (!service || isNaN(count)) {
      console.error(`Invalid scale argument: ${arg}`);
      console.error("Usage: svalinn-compose scale SERVICE=COUNT");
      Deno.exit(1);
    }

    await orchestrator.scale(composeFile.name!, service, count);
    console.log(`✓ Scaled ${service} to ${count} replicas`);
  }
}

function cmdConfig(
  _orchestrator: ComposeOrchestrator,
  composeFile: ComposeFile,
): void {
  console.log("\n✓ Compose file is valid\n");
  console.log(`Project: ${composeFile.name}`);
  console.log(`Version: ${composeFile.version}`);
  console.log(`Services: ${Object.keys(composeFile.services).join(", ")}`);

  if (composeFile.networks) {
    console.log(`Networks: ${Object.keys(composeFile.networks).join(", ")}`);
  }

  if (composeFile.volumes) {
    console.log(`Volumes: ${Object.keys(composeFile.volumes).join(", ")}`);
  }

  if (composeFile["x-svalinn"]) {
    console.log("\nSvalinn Extensions:");
    console.log(`  Policy: ${composeFile["x-svalinn"].policy || "standard"}`);
    console.log(`  Verify: ${composeFile["x-svalinn"].verify ?? true}`);
  }
}

async function main(): Promise<void> {
  const args = parseArgs(Deno.args, {
    string: ["file", "f", "project", "p", "endpoint", "tail"],
    boolean: [
      "help",
      "h",
      "version",
      "v",
      "d",
      "detach",
      "build",
      "force-recreate",
      "volumes",
      "remove-orphans",
      "follow",
    ],
    alias: {
      f: "file",
      p: "project",
      h: "help",
      v: "version",
    },
    default: {
      endpoint: "http://localhost:8000",
    },
  });

  // Handle version
  if (args.version && args._.length === 0) {
    console.log(`svalinn-compose ${VERSION}`);
    Deno.exit(0);
  }

  // Handle help
  if (args.help || args._.length === 0) {
    console.log(HELP);
    Deno.exit(0);
  }

  const command = String(args._[0]);

  // Version command
  if (command === "version") {
    console.log(`svalinn-compose ${VERSION}`);
    console.log(`Svalinn endpoint: ${args.endpoint}`);
    Deno.exit(0);
  }

  // Find and load compose file
  const composePath = await findComposeFile(args.file);
  const orchestrator = new ComposeOrchestrator(args.endpoint as string);
  const composeFile = await orchestrator.loadComposeFile(composePath);

  // Override project name if specified
  if (args.project) {
    composeFile.name = args.project as string;
  }

  // Execute command
  switch (command) {
    case "up":
      await cmdUp(orchestrator, composeFile, args);
      break;

    case "down":
      await cmdDown(orchestrator, composeFile, args);
      break;

    case "ps":
      await cmdPs(orchestrator, composeFile);
      break;

    case "logs":
      await cmdLogs(orchestrator, composeFile, args);
      break;

    case "restart":
      await cmdRestart(orchestrator, composeFile, args);
      break;

    case "scale":
      await cmdScale(orchestrator, composeFile, args);
      break;

    case "config":
      cmdConfig(orchestrator, composeFile);
      break;

    default:
      console.error(`Unknown command: ${command}`);
      console.log("Run 'svalinn-compose --help' for usage.");
      Deno.exit(1);
  }
}

// Run CLI
if (import.meta.main) {
  main().catch((error) => {
    console.error(`Error: ${error.message}`);
    Deno.exit(1);
  });
}
