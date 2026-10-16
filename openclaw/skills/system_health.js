import os from "node:os";

/**
 * Inspects live host operating system metrics.
 * Read-only tool: runs without requiring explicit approval.
 */
export async function getSystemHealth() {
  const cpus = os.cpus();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  const memUsagePercent = Math.round((usedMem / totalMem) * 100);
  const uptimeSeconds = os.uptime();
  const uptimeHours = (uptimeSeconds / 3600).toFixed(1);
  const loadAvg = os.loadavg();

  return {
    platform: `${os.type()} ${os.release()} (${os.arch()})`,
    cpuCount: cpus.length,
    cpuModel: cpus[0]?.model ?? "Unknown CPU",
    memory: {
      totalMB: Math.round(totalMem / (1024 * 1024)),
      usedMB: Math.round(usedMem / (1024 * 1024)),
      freeMB: Math.round(freeMem / (1024 * 1024)),
      percentUsed: memUsagePercent,
    },
    uptime: `${uptimeHours} hours`,
    loadAverage: loadAvg.map((l) => Number(l.toFixed(2))),
    healthy: memUsagePercent < 90,
  };
}
