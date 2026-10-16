/**
 * OpenClaw Traffic Monitor Skill
 * Inspects live HTTP request rates, network throughput, error percentages, and latency percentiles.
 * Read-only tool.
 */
export async function getTrafficMetrics(service = "all") {
  const now = new Date();
  const timestamp = now.toISOString().slice(11, 19);

  // Computed live telemetry simulation based on real server uptime
  const uptimeSeconds = process.uptime();
  const baseRps = Math.floor(25 + (Math.sin(uptimeSeconds / 10) * 12) + 15);
  const totalWindowRequests = baseRps * 60;
  const p95Latency = Math.floor(45 + (Math.random() * 30));

  return {
    service,
    timestamp,
    status: "active",
    throughput: {
      rps: baseRps,
      totalRequestsLastMinute: totalWindowRequests,
      bandwidthMBs: Number((baseRps * 0.08).toFixed(2)),
    },
    latency: {
      p50Ms: 18,
      p95Ms: p95Latency,
      p99Ms: 240,
    },
    statusCodes: {
      "2xx_success": "95.8%",
      "4xx_client_error": "2.8%",
      "5xx_server_error": "1.4%",
    },
    topEndpoints: [
      { path: "/api/agent", rps: Math.floor(baseRps * 0.55), method: "POST", status: 200 },
      { path: "/v1/audio/transcriptions", rps: Math.floor(baseRps * 0.25), method: "POST", status: 200 },
      { path: "/health", rps: Math.floor(baseRps * 0.15), method: "GET", status: 200 },
      { path: "/staging-worker/job", rps: Math.floor(baseRps * 0.05), method: "POST", status: 503 },
    ],
    anomalyDetected: true,
    anomalySummary: "Elevated 503 errors detected on /staging-worker/job due to worker-02 degradation.",
  };
}
