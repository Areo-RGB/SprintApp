export const ROLE_ORDER = [
  "Unassigned",
  "Start",
  "Split 1",
  "Split 2",
  "Split 3",
  "Split 4",
  "Split 5",
  "Split 6",
  "Split 7",
  "Split 8",
  "Split 9",
  "Split 10",
  "Stop"
];

export function roleOrderIndex(roleLabel: string): number {
  const index = ROLE_ORDER.indexOf(roleLabel);
  return index !== -1 ? index : 999;
}

export function formatDateForResultName(date: Date): string {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = date.getFullYear();
  return `${dd}_${mm}_${yyyy}`;
}

export function normalizeAthleteNameDraft(name: string): string {
  return name.trim().replace(/\s+/g, '_').toLowerCase();
}

export function computeProgressiveRoleOptions(assignedRoles: string[]): string[] {
  return ["Unassigned", "Start", "Split 1", "Split 2", "Split 3", "Split 4", "Stop"];
}

export function formatDurationNanos(nanos: number): string {
  if (!Number.isFinite(nanos) || nanos <= 0) return "-";
  const centiseconds = Math.round(nanos / 10_000_000);
  const minutes = Math.floor(centiseconds / 6_000);
  const seconds = Math.floor((centiseconds % 6_000) / 100);
  const cs = centiseconds % 100;
  if (minutes > 0) {
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(cs).padStart(2, "0")}s`;
  }
  return `${seconds}.${String(cs).padStart(2, "0")}s`;
}

export function formatRaceClockMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "00.00s";
  const centiseconds = Math.floor(ms / 10);
  const minutes = Math.floor(centiseconds / 6_000);
  const seconds = Math.floor((centiseconds % 6_000) / 100);
  const cs = centiseconds % 100;
  if (minutes > 0) {
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(cs).padStart(2, "0")}s`;
  }
  return `${seconds}.${String(cs).padStart(2, "0")}s`;
}

export function formatMeters(distanceMeters: number): string {
  if (!Number.isFinite(distanceMeters) || distanceMeters < 0) return "-";
  return `${Math.round(distanceMeters)}m`;
}

export function formatSpeedWithUnit(speedMps: number, speedUnit = "kmh"): string {
  if (!Number.isFinite(speedMps) || speedMps < 0) return "-";
  if (speedUnit === "mps") {
    return `${speedMps.toFixed(2)} m/s`;
  }
  return `${(speedMps * 3.6).toFixed(2)} km/h`;
}

export function formatAcceleration(accelerationMps2: number): string {
  if (!Number.isFinite(accelerationMps2)) return "-";
  return `${accelerationMps2.toFixed(2)} m/s^2`;
}

export function buildMonitoringPointRows(lapResults: any[]): Array<{
  lap: any;
  pointSpeedMps: number | null;
  accelerationMps2: number | null;
}> {
  let previousSpeedMps = 0;
  return (Array.isArray(lapResults) ? lapResults : []).map((lap) => {
    const pointSpeedMps = Number.isFinite(lap.lapSpeedMps) && lap.lapSpeedMps >= 0 ? lap.lapSpeedMps : null;
    const parsedLapElapsedNanos =
      Number.isFinite(lap.lapElapsedNanos) && lap.lapElapsedNanos > 0
        ? lap.lapElapsedNanos
        : Number.isFinite(lap.elapsedNanos) && lap.elapsedNanos > 0
          ? lap.elapsedNanos
          : null;

    let accelerationMps2 = null;
    if (pointSpeedMps !== null && parsedLapElapsedNanos !== null) {
      const deltaSeconds = parsedLapElapsedNanos / 1_000_000_000;
      if (deltaSeconds > 0) {
        accelerationMps2 = (pointSpeedMps - previousSpeedMps) / deltaSeconds;
      }
    }

    if (pointSpeedMps !== null) {
      previousSpeedMps = pointSpeedMps;
    }

    return {
      lap,
      pointSpeedMps,
      accelerationMps2,
    };
  });
}

export function formatIsoTime(isoValue: string): string {
  if (typeof isoValue !== "string" || isoValue.length === 0) return "";
  const parsed = new Date(isoValue);
  if (Number.isNaN(parsed.getTime())) return isoValue;
  return parsed.toLocaleString();
}

export function stageLabel(stage: string): string {
  if (stage === "MONITORING") return "Monitoring";
  if (stage === "SETUP") return "Setup";
  return "Lobby";
}

export function normalizeRoleOptions(roleOptions: string[]): string[] {
  const unique = Array.from(new Set((roleOptions ?? []).filter((role) => typeof role === "string" && role.length > 0)));
  if (unique.length === 0) {
    return ["Unassigned", "Start", "Split 1", "Stop"];
  }
  return unique.sort((left, right) => roleOrderIndex(left) - roleOrderIndex(right));
}
