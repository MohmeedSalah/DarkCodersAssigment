/**
 * In-memory cluster service state registry.
 * Reflects live status of workers, deployments, and readiness probes.
 */
const CLUSTER_STATE = {
  cluster: "staging-k8s-eu-west-1",
  environment: "staging",
  services: {
    "api-gateway": {
      replicas: 3,
      available: 3,
      status: "healthy",
      lastDeploy: "12:00:00",
      version: "v2.14.0",
    },
    "staging-worker": {
      replicas: 2,
      available: 1,
      status: "degraded",
      lastDeploy: "14:20:00",
      version: "v2.14.1",
      workers: {
        "worker-01": { status: "running", restarts: 0, uptime: "4h 12m", probe: "passing" },
        "worker-02": {
          status: "crash_loop_backoff",
          restarts: 14,
          uptime: "42s",
          probe: "failing_readiness_probe",
          error: "Readiness probe failed: HTTP 503 Service Unavailable on /healthz - memory threshold exceeded",
          since: "14:20 deploy",
        },
      },
    },
    "redis-cache": {
      replicas: 1,
      available: 1,
      status: "healthy",
      version: "7.2.4",
    },
  },
};

/**
 * Returns the current health of all cluster services or a specific service.
 * Read-only tool.
 */
export async function getServiceStatus(serviceName) {
  if (serviceName && CLUSTER_STATE.services[serviceName]) {
    return {
      cluster: CLUSTER_STATE.cluster,
      service: serviceName,
      ...CLUSTER_STATE.services[serviceName],
    };
  }
  return CLUSTER_STATE;
}

/**
 * Modifies the in-memory cluster state (called after human-approved operations).
 */
export function updateServiceState(serviceName, updater) {
  if (CLUSTER_STATE.services[serviceName]) {
    CLUSTER_STATE.services[serviceName] = updater(CLUSTER_STATE.services[serviceName]);
  }
}
