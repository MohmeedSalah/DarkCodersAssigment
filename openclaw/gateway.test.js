import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { getSystemHealth } from "./skills/system_health.js";
import { getServiceStatus } from "./skills/service_status.js";
import { analyzeLogs } from "./skills/log_analyzer.js";
import { restartService } from "./skills/ops_actions.js";
import { getTrafficMetrics } from "./skills/traffic_monitor.js";

const TEST_PORT = 18799;

test("Skill: traffic_monitor returns RPS, latency, and throughput", async () => {
  const traffic = await getTrafficMetrics();
  assert.ok(traffic.throughput.rps > 0, "RPS should be positive");
  assert.ok(traffic.latency.p95Ms > 0, "Latency should be positive");
  assert.ok(typeof traffic.statusCodes["5xx_server_error"] === "string");
  assert.ok(Array.isArray(traffic.topEndpoints));
});

test("Skill: system_health returns valid OS telemetry", async () => {
  const health = await getSystemHealth();
  assert.ok(health.cpuCount > 0, "CPU count should be positive");
  assert.ok(health.memory.totalMB > 0, "Total memory should be positive");
  assert.ok(typeof health.uptime === "string", "Uptime should be a string");
});

test("Skill: service_status detects degraded worker-02", async () => {
  const status = await getServiceStatus("staging-worker");
  assert.equal(status.status, "degraded");
  assert.equal(status.workers["worker-02"].probe, "failing_readiness_probe");
});

test("Skill: log_analyzer extracts readiness probe error causes", async () => {
  const logs = await analyzeLogs("worker-02");
  assert.ok(logs.errorCount > 0);
  assert.match(logs.rootCause, /readiness probe/i);
});

test("Skill: restartService transitions worker-02 to healthy", async () => {
  const result = await restartService({ service: "staging-worker", worker: "worker-02" });
  assert.equal(result.success, true);
  assert.equal(result.newStatus, "healthy");

  const status = await getServiceStatus("staging-worker");
  assert.equal(status.status, "healthy");
  assert.equal(status.workers["worker-02"].probe, "passing");
});

test("Gateway HTTP: handles chat completions, action proposals, and streaming", async () => {
  const proc = spawn("node", ["openclaw/gateway.js"], {
    env: { ...process.env, OPENCLAW_PORT: String(TEST_PORT), ASR_PORT: "18798" },
    stdio: "pipe",
  });

  // Wait for gateway to start
  await new Promise((resolve) => setTimeout(resolve, 800));

  try {
    // 1. Check health
    const healthRes = await fetch(`http://localhost:${TEST_PORT}/health`);
    assert.equal(healthRes.status, 200);
    const healthData = await healthRes.json();
    assert.equal(healthData.status, "ok");

    // 2. Check models
    const modelsRes = await fetch(`http://localhost:${TEST_PORT}/v1/models`);
    assert.equal(modelsRes.status, 200);
    const modelsData = await modelsRes.json();
    assert.ok(modelsData.data.some((m) => m.id === "openclaw/default"));

    // 3. Test Action Proposal creation on broken worker inquiry
    const compRes = await fetch(`http://localhost:${TEST_PORT}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "openclaw/default",
        stream: false,
        messages: [{ role: "user", content: "Check the staging worker - it keeps dying" }],
      }),
    });
    assert.equal(compRes.status, 200);
    const compData = await compRes.json();
    const parsedScreen = JSON.parse(compData.choices[0].message.content);
    assert.equal(parsedScreen.kind, "screen");
    assert.ok(parsedScreen.screen.text.length > 10);
    assert.ok(parsedScreen.action_proposal !== null, "Should propose action for crash");
    assert.equal(parsedScreen.action_proposal.tool, "ops.restart_service");
    assert.equal(parsedScreen.action_proposal.risk, "medium");

    // 4. Test Approval execution
    const approveRes = await fetch(`http://localhost:${TEST_PORT}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "openclaw/default",
        stream: false,
        messages: [{ role: "user", content: "Approved action [act_test] (Restart staging worker via ops.restart_service)" }],
      }),
    });
    assert.equal(approveRes.status, 200);
    const approveData = await approveRes.json();
    const approvedScreen = JSON.parse(approveData.choices[0].message.content);
    assert.match(approvedScreen.screen.text, /approved/i);
    assert.equal(approvedScreen.action_proposal, null);

    // 5. Test DevOps Sentinel: Traffic monitoring
    const trafficRes = await fetch(`http://localhost:${TEST_PORT}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "openclaw/devops-sentinel",
        stream: false,
        messages: [{ role: "user", content: "Show me live traffic and RPS rate" }],
      }),
    });
    assert.equal(trafficRes.status, 200);
    const trafficData = await trafficRes.json();
    const trafficScreen = JSON.parse(trafficData.choices[0].message.content);
    assert.match(trafficScreen.screen.text, /traffic|rps|latency/i);

    // 6. Test Backend Expert: Backend questions
    const backendRes = await fetch(`http://localhost:${TEST_PORT}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "openclaw/backend-expert",
        stream: false,
        messages: [{ role: "user", content: "How do I optimize database queries and indexes in Postgres backend?" }],
      }),
    });
    assert.equal(backendRes.status, 200);
    const backendData = await backendRes.json();
    const backendScreen = JSON.parse(backendData.choices[0].message.content);
    assert.ok(backendScreen.screen.text.length > 10);
  } finally {
    proc.kill();
  }
});
