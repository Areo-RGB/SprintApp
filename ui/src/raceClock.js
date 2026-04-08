export function deriveMonitoringElapsedMs({
  monitoringActive,
  monitoringStartedAtMs,
  monitoringElapsedMs,
  nowMs = Date.now(),
}) {
  const fallbackElapsedMs = Number.isFinite(monitoringElapsedMs) ? monitoringElapsedMs : 0;
  if (!monitoringActive) {
    return Math.max(0, fallbackElapsedMs);
  }

  const startedAtMs = Number(monitoringStartedAtMs);
  if (!Number.isFinite(startedAtMs)) {
    return Math.max(0, fallbackElapsedMs);
  }

  const liveElapsedMs = Math.max(0, nowMs - startedAtMs);
  return Math.max(fallbackElapsedMs, liveElapsedMs);
}
