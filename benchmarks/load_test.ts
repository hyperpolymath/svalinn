// SPDX-License-Identifier: PMPL-1.0-or-later
// Load testing for Svalinn Gateway

interface LoadTestConfig {
  duration: number; // seconds
  rps: number; // requests per second
  endpoint: string;
  method: string;
  body?: unknown;
}

interface LoadTestResult {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  averageLatency: number;
  minLatency: number;
  maxLatency: number;
  p50Latency: number;
  p95Latency: number;
  p99Latency: number;
  requestsPerSecond: number;
}

async function runLoadTest(config: LoadTestConfig): Promise<LoadTestResult> {
  const latencies: number[] = [];
  let successCount = 0;
  let failureCount = 0;

  const startTime = Date.now();
  const endTime = startTime + config.duration * 1000;
  const delayMs = 1000 / config.rps;

  console.log(
    `Starting load test: ${config.rps} req/s for ${config.duration}s on ${config.endpoint}`,
  );

  while (Date.now() < endTime) {
    const requestStart = Date.now();

    try {
      const response = await fetch(`http://localhost:8000${config.endpoint}`, {
        method: config.method,
        headers: config.body
          ? { "Content-Type": "application/json" }
          : undefined,
        body: config.body ? JSON.stringify(config.body) : undefined,
      });

      const requestEnd = Date.now();
      const latency = requestEnd - requestStart;
      latencies.push(latency);

      if (response.ok) {
        successCount++;
      } else {
        failureCount++;
      }

      await response.text(); // Consume response
    } catch (error) {
      failureCount++;
      console.error(`Request failed: ${error}`);
    }

    // Rate limiting
    const elapsed = Date.now() - requestStart;
    if (elapsed < delayMs) {
      await new Promise((resolve) => setTimeout(resolve, delayMs - elapsed));
    }
  }

  // Calculate statistics
  latencies.sort((a, b) => a - b);

  const result: LoadTestResult = {
    totalRequests: successCount + failureCount,
    successfulRequests: successCount,
    failedRequests: failureCount,
    averageLatency: latencies.reduce((a, b) => a + b, 0) / latencies.length,
    minLatency: latencies[0] || 0,
    maxLatency: latencies[latencies.length - 1] || 0,
    p50Latency: latencies[Math.floor(latencies.length * 0.5)] || 0,
    p95Latency: latencies[Math.floor(latencies.length * 0.95)] || 0,
    p99Latency: latencies[Math.floor(latencies.length * 0.99)] || 0,
    requestsPerSecond: (successCount + failureCount) / config.duration,
  };

  return result;
}

function printResults(name: string, result: LoadTestResult) {
  console.log(`\n=== ${name} ===`);
  console.log(`Total Requests:      ${result.totalRequests}`);
  console.log(`Successful:          ${result.successfulRequests}`);
  console.log(`Failed:              ${result.failedRequests}`);
  console.log(`Success Rate:        ${((result.successfulRequests / result.totalRequests) * 100).toFixed(2)}%`);
  console.log(`Actual RPS:          ${result.requestsPerSecond.toFixed(2)}`);
  console.log(`\nLatency (ms):`);
  console.log(`  Min:               ${result.minLatency.toFixed(2)}`);
  console.log(`  Average:           ${result.averageLatency.toFixed(2)}`);
  console.log(`  P50:               ${result.p50Latency.toFixed(2)}`);
  console.log(`  P95:               ${result.p95Latency.toFixed(2)}`);
  console.log(`  P99:               ${result.p99Latency.toFixed(2)}`);
  console.log(`  Max:               ${result.maxLatency.toFixed(2)}`);
}

// Load test scenarios
async function main() {
  console.log("Svalinn Gateway Load Testing");
  console.log("=============================\n");
  console.log("Prerequisites:");
  console.log("- Gateway running: just serve");
  console.log("- Vörðr running (or mocked)\n");

  // Test 1: Health endpoint (lightweight)
  const healthResult = await runLoadTest({
    duration: 10,
    rps: 100,
    endpoint: "/health",
    method: "GET",
  });
  printResults("Health Endpoint - 100 RPS", healthResult);

  // Test 2: Container list (moderate)
  const listResult = await runLoadTest({
    duration: 10,
    rps: 50,
    endpoint: "/api/v1/containers",
    method: "GET",
  });
  printResults("Container List - 50 RPS", listResult);

  // Test 3: Validation-heavy endpoint
  const validateResult = await runLoadTest({
    duration: 10,
    rps: 20,
    endpoint: "/api/v1/run",
    method: "POST",
    body: {
      image: "nginx:alpine",
      name: "load-test-container",
    },
  });
  printResults("Run Request - 20 RPS", validateResult);

  // Test 4: Stress test
  console.log("\n\nStarting stress test (high load)...");
  const stressResult = await runLoadTest({
    duration: 30,
    rps: 500,
    endpoint: "/health",
    method: "GET",
  });
  printResults("Stress Test - 500 RPS", stressResult);

  // Performance summary
  console.log("\n\n=== PERFORMANCE SUMMARY ===");
  console.log(`Target: 1000 req/s sustained`);
  console.log(
    `Health endpoint capacity: ${healthResult.requestsPerSecond.toFixed(0)} req/s`,
  );
  console.log(
    `Container list capacity: ${listResult.requestsPerSecond.toFixed(0)} req/s`,
  );
  console.log(
    `Run request capacity: ${validateResult.requestsPerSecond.toFixed(0)} req/s`,
  );
  console.log(
    `Stress test capacity: ${stressResult.requestsPerSecond.toFixed(0)} req/s`,
  );

  // Pass/fail criteria
  const healthPassed = healthResult.p95Latency < 50;
  const validationPassed = validateResult.p95Latency < 100;
  const stressPassed = stressResult.successfulRequests / stressResult.totalRequests > 0.99;

  console.log(`\n=== PASS/FAIL CRITERIA ===`);
  console.log(`Health P95 < 50ms:        ${healthPassed ? "✅ PASS" : "❌ FAIL"}`);
  console.log(`Validation P95 < 100ms:   ${validationPassed ? "✅ PASS" : "❌ FAIL"}`);
  console.log(`Stress success rate > 99%: ${stressPassed ? "✅ PASS" : "❌ FAIL"}`);

  const allPassed = healthPassed && validationPassed && stressPassed;
  console.log(`\nOverall: ${allPassed ? "✅ PASSED" : "❌ FAILED"}`);

  Deno.exit(allPassed ? 0 : 1);
}

if (import.meta.main) {
  await main();
}
