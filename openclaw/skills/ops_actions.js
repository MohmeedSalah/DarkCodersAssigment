import { updateServiceState } from "./service_status.js";

/**
 * State-changing operations that require Human-in-the-Loop approval.
 * These are only executed once approved by the operator.
 */

export async function restartService({ service = "staging-worker", worker = "worker-02" } = {}) {
  // Simulate graceful drain & restart sequence
  const startTime = Date.now();
  await new Promise((resolve) => setTimeout(resolve, 300));

  updateServiceState("staging-worker", (prev) => ({
    ...prev,
    available: 2,
    status: "healthy",
    workers: {
      ...prev.workers,
      [worker]: {
        status: "running",
        restarts: (prev.workers?.[worker]?.restarts ?? 0) + 1,
        uptime: "15s",
        probe: "passing",
        error: null,
      },
    },
  }));

  const durationMs = Date.now() - startTime;
  return {
    success: true,
    action: "ops.restart_service",
    target: `${service}/${worker}`,
    durationMs,
    result: `Drained active connections, restarted container ${worker}, and verified readiness probe HTTP 200 OK.`,
    newStatus: "healthy",
  };
}

export async function rollbackDeployment({ service = "staging-worker", targetVersion = "v2.14.0" } = {}) {
  await new Promise((resolve) => setTimeout(resolve, 400));

  updateServiceState("staging-worker", (prev) => ({
    ...prev,
    version: targetVersion,
    available: 2,
    status: "healthy",
    workers: {
      "worker-01": { status: "running", restarts: 0, uptime: "5m", probe: "passing" },
      "worker-02": { status: "running", restarts: 0, uptime: "5m", probe: "passing", error: null },
    },
  }));

  return {
    success: true,
    action: "ops.rollback_deployment",
    service,
    rolledBackTo: targetVersion,
    result: `Rollout revision reverted to ${targetVersion}. Both replicas healthy.`,
  };
}
