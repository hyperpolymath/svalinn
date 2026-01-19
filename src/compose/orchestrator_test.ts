// SPDX-License-Identifier: PMPL-1.0-or-later
// Svalinn Compose - Orchestrator Tests

import { assertEquals, assertThrows } from "jsr:@std/assert@^1";
import { ComposeOrchestrator } from "./orchestrator.ts";
import type { ComposeFile } from "./types.ts";

Deno.test("ComposeOrchestrator - resolves simple dependencies", () => {
  const orchestrator = new ComposeOrchestrator();

  const composeFile: ComposeFile = {
    version: "1.0",
    name: "test",
    services: {
      web: {
        image: "nginx",
        depends_on: ["db"],
      },
      db: {
        image: "postgres",
      },
    },
  };

  // @ts-ignore: accessing private method for testing
  const order = orchestrator.resolveStartupOrder(composeFile.services);
  assertEquals(order, ["db", "web"]);
});

Deno.test("ComposeOrchestrator - detects circular dependencies", () => {
  const orchestrator = new ComposeOrchestrator();

  const services = {
    a: { image: "a", depends_on: ["b"] },
    b: { image: "b", depends_on: ["c"] },
    c: { image: "c", depends_on: ["a"] },
  };

  assertThrows(
    // @ts-ignore: accessing private method for testing
    () => orchestrator.resolveStartupOrder(services),
    Error,
    "Circular dependency",
  );
});

Deno.test("ComposeOrchestrator - resolves complex dependency graph", () => {
  const orchestrator = new ComposeOrchestrator();

  const composeFile: ComposeFile = {
    version: "1.0",
    name: "complex",
    services: {
      frontend: {
        image: "nginx",
        depends_on: ["backend", "cache"],
      },
      backend: {
        image: "app",
        depends_on: ["db", "cache"],
      },
      db: {
        image: "postgres",
      },
      cache: {
        image: "redis",
      },
    },
  };

  // @ts-ignore: accessing private method for testing
  const order = orchestrator.resolveStartupOrder(composeFile.services);

  // db and cache should come before backend
  // backend and cache should come before frontend
  const dbIndex = order.indexOf("db");
  const cacheIndex = order.indexOf("cache");
  const backendIndex = order.indexOf("backend");
  const frontendIndex = order.indexOf("frontend");

  assertEquals(dbIndex < backendIndex, true);
  assertEquals(cacheIndex < backendIndex, true);
  assertEquals(backendIndex < frontendIndex, true);
  assertEquals(cacheIndex < frontendIndex, true);
});

Deno.test("ComposeOrchestrator - parses port mappings", () => {
  const orchestrator = new ComposeOrchestrator();

  const ports = [
    "8080:80",
    "443:443/tcp",
    "53:53/udp",
    { target: 3000, published: 3001, protocol: "tcp" as const },
  ];

  // @ts-ignore: accessing private method for testing
  const mappings = orchestrator.parsePortMappings(ports);

  assertEquals(mappings.length, 4);
  assertEquals(mappings[0], { containerPort: 80, hostPort: 8080, protocol: "tcp" });
  assertEquals(mappings[1], { containerPort: 443, hostPort: 443, protocol: "tcp" });
  assertEquals(mappings[2], { containerPort: 53, hostPort: 53, protocol: "udp" });
  assertEquals(mappings[3], {
    containerPort: 3000,
    hostPort: 3001,
    protocol: "tcp",
    hostIp: undefined,
  });
});

Deno.test("ComposeOrchestrator - normalizes environment variables", () => {
  const orchestrator = new ComposeOrchestrator();

  // Object form
  const objEnv = { FOO: "bar", BAZ: "qux" };
  // @ts-ignore: accessing private method for testing
  const normalized1 = orchestrator.normalizeEnv(objEnv);
  assertEquals(normalized1, { FOO: "bar", BAZ: "qux" });

  // Array form
  const arrEnv = ["FOO=bar", "BAZ=qux", "COMPLEX=a=b=c"];
  // @ts-ignore: accessing private method for testing
  const normalized2 = orchestrator.normalizeEnv(arrEnv);
  assertEquals(normalized2, { FOO: "bar", BAZ: "qux", COMPLEX: "a=b=c" });

  // Undefined
  // @ts-ignore: accessing private method for testing
  const normalized3 = orchestrator.normalizeEnv(undefined);
  assertEquals(normalized3, {});
});
