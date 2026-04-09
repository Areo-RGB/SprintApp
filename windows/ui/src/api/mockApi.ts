import type {
  CompareResultsPayload,
  CompareResultsRequest,
  ControlPath,
  ListResultsResponse,
  LoadResultResponse,
  SaveResultsRequest,
  SaveResultsResponse,
  SavedResultSummary,
  SavedResultsFilePayload,
  Snapshot,
} from "./types";

const STORAGE_KEY = "sprint_sync_results";

type StoredResult = {
  fileName: string;
  payload: SavedResultsFilePayload;
};

function normalizeRoleLabel(value: unknown): string {
  if (typeof value === "string" && value.trim().length > 0) {
    return value;
  }
  return "Checkpoint";
}

function readStoredResults(): StoredResult[] {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((item) => {
        if (!item || typeof item !== "object") {
          return null;
        }
        const fileName = typeof item.fileName === "string" ? item.fileName : "";
        const payload = (item as { payload?: SavedResultsFilePayload }).payload;
        if (!fileName || !payload || typeof payload !== "object") {
          return null;
        }
        return { fileName, payload } as StoredResult;
      })
      .filter((item): item is StoredResult => item !== null);
  } catch {
    return [];
  }
}

function writeStoredResults(results: StoredResult[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(results));
}

function toSummary(item: StoredResult): SavedResultSummary {
  const bestElapsedNanos = item.payload.latestLapResults
    .map((lap) => (Number.isFinite(lap.elapsedNanos) ? Number(lap.elapsedNanos) : null))
    .filter((value): value is number => Number.isFinite(value))
    .reduce<number | null>((best, current) => (best === null ? current : Math.min(best, current)), null);

  return {
    fileName: item.fileName,
    filePath: item.fileName,
    resultName: item.payload.resultName,
    athleteName: item.payload.athleteName,
    notes: item.payload.notes,
    runId: item.payload.runId,
    savedAtIso: item.payload.exportedAtIso,
    resultCount: item.payload.latestLapResults.length,
    bestElapsedNanos,
  };
}

export function createMockSnapshot(): Snapshot {
  const now = Date.now();
  return {
    session: {
      stage: "MONITORING",
      monitoringActive: true,
      monitoringStartedAtMs: now - 9_500,
      monitoringElapsedMs: 9_500,
      hostStartSensorNanos: 1_000_000_000,
      hostStopSensorNanos: null,
      hostSplitMarks: [
        { roleLabel: "Split 1", elapsedNanos: 4_320_000_000 },
        { roleLabel: "Split 2", elapsedNanos: 7_910_000_000 },
      ],
      roleOptions: ["Unassigned", "Start", "Split 1", "Split 2", "Split 3", "Split 4", "Stop"],
      runId: "dev-ui-mock",
    },
    clients: [
      {
        roleTarget: "dev-device-1",
        senderDeviceName: "Pixel 8 Pro",
        assignedRole: "Start",
        sensitivity: 100,
        distanceMeters: 0,
        cameraFacing: "rear",
        telemetryLatencyMs: 14,
        telemetryClockSynced: true,
      },
      {
        roleTarget: "dev-device-2",
        senderDeviceName: "Galaxy S24",
        assignedRole: "Split 1",
        sensitivity: 98,
        distanceMeters: 10,
        cameraFacing: "rear",
        telemetryLatencyMs: 19,
        telemetryClockSynced: true,
      },
      {
        roleTarget: "dev-device-3",
        senderDeviceName: "iPhone 15",
        assignedRole: "Stop",
        sensitivity: 95,
        distanceMeters: 20,
        cameraFacing: "rear",
        telemetryLatencyMs: 16,
        telemetryClockSynced: true,
      },
    ],
    latestLapResults: [
      {
        id: "dev-lap-split-1",
        roleLabel: "Split 1",
        senderDeviceName: "Galaxy S24",
        distanceMeters: 10,
        elapsedNanos: 4_320_000_000,
        lapElapsedNanos: 4_320_000_000,
        lapSpeedMps: 2.31,
      },
      {
        id: "dev-lap-split-2",
        roleLabel: "Split 2",
        senderDeviceName: "Galaxy S24",
        distanceMeters: 15,
        elapsedNanos: 7_910_000_000,
        lapElapsedNanos: 3_590_000_000,
        lapSpeedMps: 1.39,
      },
      {
        id: "dev-lap-stop",
        roleLabel: "Stop",
        senderDeviceName: "iPhone 15",
        distanceMeters: 20,
        elapsedNanos: 9_480_000_000,
        lapElapsedNanos: 1_570_000_000,
        lapSpeedMps: 3.18,
      },
    ],
    recentEvents: [
      {
        id: "dev-evt-1",
        message: "Monitoring active (dev mock)",
        level: "info",
        timestampIso: new Date(now - 8000).toISOString(),
      },
      {
        id: "dev-evt-2",
        message: "Split 1 captured",
        level: "info",
        timestampIso: new Date(now - 5200).toISOString(),
      },
      {
        id: "dev-evt-3",
        message: "Split 2 captured",
        level: "info",
        timestampIso: new Date(now - 1600).toISOString(),
      },
    ],
    resultsExport: {
      lastSavedFilePath: "",
      lastSavedAtIso: "",
    },
    stats: {
      knownTypes: {
        SESSION_SNAPSHOT: 42,
        TELEMETRY: 315,
      },
    },
  };
}

export function applyMockControl(
  currentSnapshot: Snapshot | null,
  path: ControlPath,
  body: Record<string, unknown> | null,
): Snapshot {
  const sourceSnapshot = currentSnapshot && typeof currentSnapshot === "object" ? currentSnapshot : createMockSnapshot();
  const nextSnapshot: Snapshot = {
    ...sourceSnapshot,
    session: { ...(sourceSnapshot.session ?? {}) },
    clients: Array.isArray(sourceSnapshot.clients) ? [...sourceSnapshot.clients] : [],
    latestLapResults: Array.isArray(sourceSnapshot.latestLapResults) ? [...sourceSnapshot.latestLapResults] : [],
  };

  const session = nextSnapshot.session ?? {};
  const now = Date.now();

  switch (path) {
    case "/api/control/start-monitoring":
      session.stage = "MONITORING";
      session.monitoringActive = true;
      session.monitoringStartedAtMs = now;
      session.monitoringElapsedMs = 0;
      break;
    case "/api/control/stop-monitoring":
      session.monitoringActive = false;
      session.stage = "LOBBY";
      break;
    case "/api/control/reset-run":
      session.hostStartSensorNanos = null;
      session.hostStopSensorNanos = null;
      session.hostSplitMarks = [];
      nextSnapshot.latestLapResults = [];
      break;
    case "/api/control/assign-role": {
      const targetId = typeof body?.targetId === "string" ? body.targetId : "";
      const role = typeof body?.role === "string" ? body.role : "Unassigned";
      nextSnapshot.clients = (nextSnapshot.clients ?? []).map((client) =>
        client.roleTarget === targetId ? { ...client, assignedRole: role } : client,
      );
      break;
    }
    case "/api/control/device-config": {
      const targetId = typeof body?.targetId === "string" ? body.targetId : "";
      nextSnapshot.clients = (nextSnapshot.clients ?? []).map((client) => {
        if (client.roleTarget !== targetId) {
          return client;
        }
        return {
          ...client,
          cameraFacing:
            typeof body?.cameraFacing === "string"
              ? body.cameraFacing
              : client.cameraFacing,
          sensitivity:
            Number.isInteger(body?.sensitivity) && Number(body?.sensitivity) >= 1
              ? Number(body?.sensitivity)
              : client.sensitivity,
          distanceMeters:
            Number.isFinite(body?.distanceMeters)
              ? Number(body?.distanceMeters)
              : client.distanceMeters,
        };
      });
      break;
    }
    case "/api/control/return-setup":
      session.stage = "SETUP";
      session.monitoringActive = false;
      break;
    case "/api/control/start-lobby":
      session.stage = "LOBBY";
      session.monitoringActive = false;
      break;
    case "/api/control/reset-laps":
      nextSnapshot.latestLapResults = [];
      break;
    case "/api/control/resync-device":
    case "/api/control/clear-events":
    case "/api/control/save-results":
    default:
      break;
  }

  nextSnapshot.session = session;
  return nextSnapshot;
}

export function listMockResults(): ListResultsResponse {
  const items = readStoredResults().map(toSummary);
  return {
    ok: true,
    items,
  };
}

export function loadMockResult(fileName: string): LoadResultResponse {
  const result = readStoredResults().find((item) => item.fileName === fileName);
  if (!result) {
    throw new Error("saved result not found");
  }

  return {
    ok: true,
    fileName: result.fileName,
    filePath: result.fileName,
    payload: result.payload,
  };
}

export function saveMockResults(
  request: SaveResultsRequest,
  snapshot: Snapshot | null,
): SaveResultsResponse {
  const source = snapshot ?? createMockSnapshot();
  const exportedAtIso = new Date().toISOString();
  const fileName = `result_${Date.now()}.json`;
  const resultName = typeof request.name === "string" && request.name.trim().length > 0 ? request.name : fileName;

  const payload: SavedResultsFilePayload = {
    type: "windows_results_export",
    resultName,
    athleteName: request.athleteName ?? null,
    notes: request.notes ?? null,
    namingFormat: "athlete_dd_MM_yyyy",
    exportedAtIso,
    exportedAtMs: Date.now(),
    runId: source.session?.runId ?? null,
    session: source.session ?? {},
    clients: source.clients ?? [],
    latestLapResults: source.latestLapResults ?? [],
    lapHistory: source.lapHistory ?? [],
    recentEvents: source.recentEvents ?? [],
  };

  const existing = readStoredResults();
  existing.unshift({ fileName, payload });
  writeStoredResults(existing);

  return {
    ok: true,
    filePath: fileName,
    fileName,
    resultName,
    athleteName: payload.athleteName,
    notes: payload.notes,
    savedAtIso: exportedAtIso,
  };
}

export function compareMockResults(request: CompareResultsRequest): CompareResultsPayload {
  const all = readStoredResults();

  const selected = request.fileNames.length
    ? all.filter((item) => request.fileNames.includes(item.fileName))
    : all.slice(0, 4);

  const athleteName =
    typeof request.athleteName === "string" && request.athleteName.trim().length > 0
      ? request.athleteName
      : selected[0]?.payload.athleteName ?? null;

  const filtered = athleteName
    ? selected.filter((item) => (item.payload.athleteName ?? "").toLowerCase() === athleteName.toLowerCase())
    : selected;

  const labels = (filtered[0]?.payload.latestLapResults ?? []).map((lap, index) => {
    const roleLabel = normalizeRoleLabel(lap.roleLabel);
    return roleLabel.length > 0 ? roleLabel : `Point ${index + 1}`;
  });

  const series = filtered.map((item) => ({
    label: item.payload.resultName,
    sourceFileName: item.fileName,
    valuesSeconds: item.payload.latestLapResults.map((lap) => {
      if (!Number.isFinite(lap.elapsedNanos) || Number(lap.elapsedNanos) <= 0) {
        return null;
      }
      return Number((Number(lap.elapsedNanos) / 1_000_000_000).toFixed(3));
    }),
  }));

  return {
    athleteName,
    labels,
    series,
  };
}
