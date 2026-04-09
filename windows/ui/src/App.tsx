import React, { useEffect, useMemo, useRef, useState } from "react";
import { deriveMonitoringElapsedMs } from "./raceClock.js";
import {
  assignRole as tauriAssignRole,
  compareResults as tauriCompareResults,
  getState as tauriGetState,
  isTauriRuntime,
  listResults as tauriListResults,
  loadResult as tauriLoadResult,
  resetRun as tauriResetRun,
  resyncDevice as tauriResyncDevice,
  saveResults as tauriSaveResults,
  startMonitoring as tauriStartMonitoring,
  stopMonitoring as tauriStopMonitoring,
  subscribeStateUpdates,
  updateDeviceConfig as tauriUpdateDeviceConfig,
} from "./api/tauriApi";
import {
  applyMockControl,
  compareMockResults,
  createMockSnapshot,
  listMockResults,
  loadMockResult,
  saveMockResults,
} from "./api/mockApi";
import type {
  CompareResultsPayload,
  ControlPath,
  MonitoringPointRow,
  RoleLabel,
  SaveResultsRequest,
  SavedResultSummary,
  SavedResultsFilePayload,
  Snapshot,
} from "./api/types";
import {
  buildMonitoringPointRows,
  computeProgressiveRoleOptions,
  formatDateForResultName,
  formatDurationNanos,
  formatIsoTime,
  formatMeters,
  formatRaceClockMs,
  normalizeAthleteNameDraft,
  normalizeRoleOptions,
  roleOrderIndex,
  stageLabel,
} from "./utils";
import Card from "./components/Card";
import DeviceCard from "./components/DeviceCard";
import RaceTimerPanel from "./components/RaceTimerPanel";
import SavedResultsPanel from "./components/SavedResultsPanel";
import SystemDetails from "./components/SystemDetails";

const AUTO_APPLY_DELAY_MS = 350;
const DEV_UI_MOCK_MODE = import.meta.env.VITE_USE_DEV_MOCK === "true";
const USE_MOCK_API = DEV_UI_MOCK_MODE || !isTauriRuntime();

export default function App() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(() => (USE_MOCK_API ? createMockSnapshot() : null));
  const [wsConnected, setWsConnected] = useState(() => USE_MOCK_API);
  const [busyAction, setBusyAction] = useState("");
  const [lastError, setLastError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [sensitivityDraftByTarget, setSensitivityDraftByTarget] = useState<Record<string, string>>({});
  const [distanceDraftByTarget, setDistanceDraftByTarget] = useState<Record<string, string>>({});
  const [activeTab, setActiveTab] = useState("live");
  const [speedUnit, setSpeedUnit] = useState("kmh");
  const [savedResults, setSavedResults] = useState<SavedResultSummary[]>([]);
  const [savedResultsLoading, setSavedResultsLoading] = useState(false);
  const [savedResultLoading, setSavedResultLoading] = useState(false);
  const [selectedSavedFileName, setSelectedSavedFileName] = useState("");
  const [selectedSavedMeta, setSelectedSavedMeta] = useState<SavedResultSummary | null>(null);
  const [selectedSavedPayload, setSelectedSavedPayload] = useState<SavedResultsFilePayload | null>(null);
  const [compareResultsPayload, setCompareResultsPayload] = useState<CompareResultsPayload | null>(null);
  const [runHistory, setRunHistory] = useState<Array<{ key: string; rows: MonitoringPointRow[] }>>([]);
  const [raceClockTickMs, setRaceClockTickMs] = useState(() => Date.now());
  const raceClockBaseMsRef = useRef<number | null>(null);
  const raceClockAnchorRef = useRef({
    elapsedMs: 0,
    capturedAtMs: Date.now(),
  });
  const sensitivityApplyTimeoutsRef = useRef<Map<string, number>>(new Map());
  const distanceApplyTimeoutsRef = useRef<Map<string, number>>(new Map());

  async function fetchState() {
    setRefreshing(true);
    try {
      if (USE_MOCK_API) {
        setSnapshot((previous) => previous ?? createMockSnapshot());
        setWsConnected(true);
        setLastError("");
        return;
      }

      const latestState = await tauriGetState();
      setSnapshot(latestState);
      setWsConnected(true);
      setLastError("");
    } catch (error) {
      setWsConnected(false);
      setLastError(error instanceof Error ? error.message : "State fetch failed");
    } finally {
      setRefreshing(false);
    }
  }

  async function postControl(path: ControlPath, body: unknown = null, actionKey: string = path): Promise<any> {
    setBusyAction(actionKey);
    try {
      if (USE_MOCK_API) {
        if (path === "/api/control/save-results") {
          const saved = saveMockResults((body ?? {}) as SaveResultsRequest, snapshot);
          setLastError("");
          return saved;
        }

        setSnapshot((previous) => applyMockControl(previous, path, (body as Record<string, unknown> | null) ?? null));
        setLastError("");
        return { ok: true, mock: true };
      }

      let payload: any = {};
      switch (path) {
        case "/api/control/start-monitoring":
          payload = await tauriStartMonitoring();
          break;
        case "/api/control/stop-monitoring":
          payload = await tauriStopMonitoring();
          break;
        case "/api/control/reset-run":
          payload = await tauriResetRun();
          break;
        case "/api/control/save-results":
          payload = await tauriSaveResults((body ?? {}) as any);
          break;
        case "/api/control/assign-role":
          payload = await tauriAssignRole((body ?? {}) as any);
          break;
        case "/api/control/device-config":
          payload = await tauriUpdateDeviceConfig((body ?? {}) as any);
          break;
        case "/api/control/resync-device":
          payload = await tauriResyncDevice((body ?? {}) as any);
          break;
        default:
          payload = { ok: true };
          break;
      }

      await fetchState();
      setLastError("");
      return payload;
    } catch (error) {
      setLastError(error instanceof Error ? error.message : "Control request failed");
      return null;
    } finally {
      setBusyAction("");
    }
  }

  async function fetchSavedResultsList(preferredFileName: string | null = null) {
    setSavedResultsLoading(true);
    try {
      if (USE_MOCK_API) {
        const payload = listMockResults();
        const items = Array.isArray(payload?.items) ? payload.items : [];
        setSavedResults(items);

        if (items.length === 0) {
          setSelectedSavedFileName("");
          setSelectedSavedMeta(null);
          setSelectedSavedPayload(null);
          setCompareResultsPayload(null);
          return;
        }

        const desired = preferredFileName || selectedSavedFileName;
        const selected = items.find((item) => item.fileName === desired) ?? items[0];
        setSelectedSavedFileName(selected.fileName);
        setSelectedSavedMeta(selected);

        const comparePayload = compareMockResults({
          fileNames: items.slice(0, 6).map((item) => item.fileName),
          athleteName: selected.athleteName ?? undefined,
        });
        setCompareResultsPayload(comparePayload);
        setLastError("");
        return;
      }

      const payload = await tauriListResults();
      const items = Array.isArray(payload?.items) ? payload.items : [];
      setSavedResults(items);

      if (items.length === 0) {
        setSelectedSavedFileName("");
        setSelectedSavedMeta(null);
        setSelectedSavedPayload(null);
        setCompareResultsPayload(null);
        return;
      }

      const desired = preferredFileName || selectedSavedFileName;
      const selected = items.find((item) => item.fileName === desired) ?? items[0];
      setSelectedSavedFileName(selected.fileName);
      setSelectedSavedMeta(selected);

      const comparePayload = await tauriCompareResults({
        fileNames: items.slice(0, 6).map((item) => item.fileName),
        athleteName: selected.athleteName ?? undefined,
      });
      setCompareResultsPayload(comparePayload);
    } catch (error) {
      setLastError(error instanceof Error ? error.message : "Saved results fetch failed");
      setCompareResultsPayload(null);
    } finally {
      setSavedResultsLoading(false);
    }
  }

  async function loadSavedResult(fileName: string) {
    if (!fileName) {
      setSelectedSavedPayload(null);
      return;
    }

    setSavedResultLoading(true);
    try {
      if (USE_MOCK_API) {
        const payload = loadMockResult(fileName);
        setSelectedSavedPayload(payload.payload);

        const comparePayload = compareMockResults({
          fileNames: savedResults.slice(0, 6).map((item) => item.fileName),
          athleteName: selectedSavedMeta?.athleteName ?? payload.payload.athleteName ?? undefined,
        });
        setCompareResultsPayload(comparePayload);
        setLastError("");
        return;
      }

      const payload = await tauriLoadResult(fileName);
      setSelectedSavedPayload(payload?.payload ?? null);

      const comparePayload = await tauriCompareResults({
        fileNames: savedResults.slice(0, 6).map((item) => item.fileName),
        athleteName: selectedSavedMeta?.athleteName ?? payload?.payload?.athleteName ?? undefined,
      });
      setCompareResultsPayload(comparePayload);
      setLastError("");
    } catch (error) {
      setSelectedSavedPayload(null);
      setCompareResultsPayload(null);
      setLastError(error instanceof Error ? error.message : "Saved result load failed");
    } finally {
      setSavedResultLoading(false);
    }
  }

  function assignRole(targetId: string, role: RoleLabel) {
    postControl("/api/control/assign-role", { targetId, role }, `assign-role:${targetId}`);
  }

  function updateDeviceConfig(
    targetId: string,
    patch: { sensitivity?: number; cameraFacing?: string; distanceMeters?: number },
    actionKey: string,
  ) {
    postControl("/api/control/device-config", { targetId, ...patch }, actionKey);
  }

  function clearScheduledApply(timeoutsRef: React.MutableRefObject<Map<string, number>>, targetId: string) {
    const timeoutId = timeoutsRef.current.get(targetId);
    if (timeoutId) {
      window.clearTimeout(timeoutId);
      timeoutsRef.current.delete(targetId);
    }
  }

  function setCameraFacing(targetId: string, cameraFacing: "front" | "rear") {
    updateDeviceConfig(targetId, { cameraFacing }, `device-config-camera:${targetId}`);
  }

  function toggleCameraFacing(targetId: string, currentCameraFacing: "front" | "rear") {
    const nextCameraFacing = currentCameraFacing === "front" ? "rear" : "front";
    setCameraFacing(targetId, nextCameraFacing);
  }

  function requestDeviceClockResync(targetId: string) {
    postControl("/api/control/resync-device", { targetId }, `device-resync:${targetId}`);
  }

  function updateSensitivityDraft(targetId: string, rawValue: string, fallbackSensitivity: number) {
    setSensitivityDraftByTarget((previous) => ({
      ...previous,
      [targetId]: rawValue,
    }));

    clearScheduledApply(sensitivityApplyTimeoutsRef, targetId);
    if (String(rawValue).trim().length === 0) {
      setLastError("");
      return;
    }

    const parsedValue = Number(rawValue);
    if (!Number.isInteger(parsedValue) || parsedValue < 1 || parsedValue > 100) {
      setLastError("Sensitivity must be an integer in the range 1 to 100.");
      return;
    }

    const effectiveSensitivity = Number.isInteger(fallbackSensitivity) ? fallbackSensitivity : 100;
    if (parsedValue === effectiveSensitivity) {
      setLastError("");
      return;
    }

    setLastError("");
    const timeoutId = window.setTimeout(() => {
      updateDeviceConfig(targetId, { sensitivity: parsedValue }, `device-config-sensitivity:${targetId}`);
      setSensitivityDraftByTarget((previous) => ({
        ...previous,
        [targetId]: String(parsedValue),
      }));
      sensitivityApplyTimeoutsRef.current.delete(targetId);
    }, AUTO_APPLY_DELAY_MS);
    sensitivityApplyTimeoutsRef.current.set(targetId, timeoutId);
  }

  function updateDistanceDraft(targetId: string, rawValue: string, fallbackDistanceMeters: number) {
    setDistanceDraftByTarget((previous) => ({
      ...previous,
      [targetId]: rawValue,
    }));

    clearScheduledApply(distanceApplyTimeoutsRef, targetId);
    if (String(rawValue).trim().length === 0) {
      setLastError("");
      return;
    }

    const parsedValue = Number(rawValue);
    if (!Number.isFinite(parsedValue) || parsedValue < 0 || parsedValue > 100000) {
      setLastError("Distance must be a number in the range 0 to 100000 meters.");
      return;
    }

    const normalizedDistance = Math.round(parsedValue * 1000) / 1000;
    const effectiveDistance = Number.isFinite(fallbackDistanceMeters) && fallbackDistanceMeters >= 0 ? fallbackDistanceMeters : 0;
    const normalizedFallbackDistance = Math.round(effectiveDistance * 1000) / 1000;
    if (normalizedDistance === normalizedFallbackDistance) {
      setLastError("");
      return;
    }

    setLastError("");
    const timeoutId = window.setTimeout(() => {
      updateDeviceConfig(targetId, { distanceMeters: normalizedDistance }, `device-config-distance:${targetId}`);
      setDistanceDraftByTarget((previous) => ({
        ...previous,
        [targetId]: String(normalizedDistance),
      }));
      distanceApplyTimeoutsRef.current.delete(targetId);
    }, AUTO_APPLY_DELAY_MS);
    distanceApplyTimeoutsRef.current.set(targetId, timeoutId);
  }

  async function saveResultsJson() {
    const athletePrompt = window.prompt("Athlete Name (saved name format: athlete_dd_MM_yyyy)", "");
    if (athletePrompt === null) return;

    const suggestedAthleteSegment = normalizeAthleteNameDraft(athletePrompt);
    const suggestedResultName =
      suggestedAthleteSegment.length > 0
        ? `${suggestedAthleteSegment}_${formatDateForResultName(new Date())}`
        : (snapshot?.session?.runId ?? "");

    const namePrompt = window.prompt("Save Result Name", suggestedResultName);
    if (namePrompt === null) return;

    const notesPrompt = window.prompt("Notes (optional)", "");
    if (notesPrompt === null) return;

    const response = await postControl(
      "/api/control/save-results",
      {
        name: namePrompt,
        athleteName: athletePrompt,
        notes: notesPrompt,
      },
      "/api/control/save-results",
    );

    if (response?.fileName) {
      await fetchSavedResultsList(response.fileName);
      setActiveTab("saved");
    }
  }

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;

    async function bootstrap() {
      await fetchState();
      await fetchSavedResultsList();

      if (USE_MOCK_API || disposed) {
        setWsConnected(true);
        return;
      }

      try {
        unlisten = await subscribeStateUpdates((nextSnapshot) => {
          if (disposed) {
            return;
          }
          setSnapshot(nextSnapshot);
          setWsConnected(true);
          setLastError("");
        });
        setWsConnected(true);
      } catch (error) {
        if (!disposed) {
          setWsConnected(false);
          setLastError(error instanceof Error ? error.message : "Failed to listen for backend updates");
        }
      }
    }

    void bootstrap();

    return () => {
      disposed = true;
      if (unlisten) {
        unlisten();
      }
    };
  }, []);

  useEffect(() => {
    loadSavedResult(selectedSavedFileName);
  }, [selectedSavedFileName]);

  useEffect(() => {
    return () => {
      for (const timeoutId of sensitivityApplyTimeoutsRef.current.values()) {
        window.clearTimeout(timeoutId);
      }
      for (const timeoutId of distanceApplyTimeoutsRef.current.values()) {
        window.clearTimeout(timeoutId);
      }
      sensitivityApplyTimeoutsRef.current.clear();
      distanceApplyTimeoutsRef.current.clear();
    };
  }, []);

  const session = snapshot?.session ?? {
    stage: "LOBBY",
    monitoringActive: false,
    monitoringStartedAtMs: null,
    monitoringElapsedMs: 0,
    hostStartSensorNanos: null,
    hostStopSensorNanos: null,
    hostSplitMarks: [],
    roleOptions: [],
  };
  const stage = session.stage ?? "LOBBY";
  const monitoringActive = stage === "MONITORING" || Boolean(session.monitoringActive);
  const hostStartSensorNanos = Number.isFinite(session.hostStartSensorNanos)
    ? session.hostStartSensorNanos
    : null;
  const hostStopSensorNanos = Number.isFinite(session.hostStopSensorNanos)
    ? session.hostStopSensorNanos
    : null;
  const monitoringStartedAtMs = Number.isFinite(session.monitoringStartedAtMs)
    ? session.monitoringStartedAtMs
    : null;
  const monitoringElapsedMs = deriveMonitoringElapsedMs({
    monitoringActive,
    monitoringStartedAtMs,
    monitoringElapsedMs: session.monitoringElapsedMs,
    nowMs: raceClockTickMs,
  });
  const hostSplitMarks = Array.isArray(session.hostSplitMarks) ? session.hostSplitMarks : [];
  const clients = snapshot?.clients ?? [];
  const latestLapResults = snapshot?.latestLapResults ?? [];
  const recentEvents = snapshot?.recentEvents ?? [];
  const resultsExport = snapshot?.resultsExport ?? {};
  const lastSavedFilePath =
    typeof resultsExport.lastSavedFilePath === "string" ? resultsExport.lastSavedFilePath : "";
  const lastSavedAtIso = typeof resultsExport.lastSavedAtIso === "string" ? resultsExport.lastSavedAtIso : "";
  const canSaveResults =
    latestLapResults.length > 0 ||
    (hostStartSensorNanos !== null && hostStopSensorNanos !== null && hostStopSensorNanos > hostStartSensorNanos);
  const runCompleted = hostStartSensorNanos !== null && hostStopSensorNanos !== null && hostStopSensorNanos > hostStartSensorNanos;
  const timerStateLabel = monitoringActive ? "Monitoring" : runCompleted ? "Run Complete" : "Ready";

  const knownTypes = useMemo(() => {
    const values = (snapshot?.stats?.knownTypes ?? {}) as Record<string, number>;
    return Object.entries(values).sort(([a], [b]) => a.localeCompare(b));
  }, [snapshot]);

  const fallbackRoleOptions = useMemo(
    () =>
      computeProgressiveRoleOptions(
        clients
          .map((client) => client.assignedRole)
          .filter((roleLabel): roleLabel is string => typeof roleLabel === "string"),
      ),
    [clients],
  );
  const serverRoleOptions = useMemo(
    () => normalizeRoleOptions(Array.isArray(session.roleOptions) ? session.roleOptions : []),
    [session.roleOptions],
  );
  const roleOptions = serverRoleOptions.length > 0 ? serverRoleOptions : fallbackRoleOptions;
  const hasStartAssignment = clients.some((client) => client.assignedRole === "Start");
  const hasStopAssignment = clients.some((client) => client.assignedRole === "Stop");
  const canStartMonitoring = clients.length > 0 && hasStartAssignment && hasStopAssignment && !monitoringActive;

  const savedLatestLapResults = Array.isArray(selectedSavedPayload?.latestLapResults)
    ? selectedSavedPayload.latestLapResults
    : [];

  const savedMonitoringPointRows = useMemo(
    () => buildMonitoringPointRows(savedLatestLapResults) as MonitoringPointRow[],
    [savedLatestLapResults],
  );

  const monitoringPointRows = useMemo(
    () => buildMonitoringPointRows(latestLapResults) as MonitoringPointRow[],
    [latestLapResults],
  );

  useEffect(() => {
    if (
      hostStartSensorNanos === null ||
      hostStopSensorNanos === null ||
      hostStopSensorNanos <= hostStartSensorNanos ||
      monitoringPointRows.length === 0
    ) {
      return;
    }

    const runKey = `${hostStartSensorNanos}-${hostStopSensorNanos}`;
    setRunHistory((previous) => {
      if (previous.some((entry) => entry.key === runKey)) {
        return previous;
      }

      const snapshotRows = monitoringPointRows.map((row) => ({
        ...row,
        lap: row?.lap && typeof row.lap === "object" ? { ...row.lap } : row?.lap,
      }));

      return [...previous, { key: runKey, rows: snapshotRows }];
    });
  }, [hostStartSensorNanos, hostStopSensorNanos, monitoringPointRows]);

  const monitoringHistoryRows = useMemo(() => {
    const rowsFromHistory = runHistory.flatMap((entry, runIndex) =>
      entry.rows.map((row) => {
        const checkpointLabel = row?.lap?.roleLabel ?? row?.lap?.senderDeviceName ?? "Checkpoint";
        return {
          ...row,
          lap: {
            ...(row?.lap ?? {}),
            roleLabel: `Run ${runIndex + 1} · ${checkpointLabel}`,
          },
        };
      }),
    );

    const currentRunInProgress =
      hostStartSensorNanos !== null && hostStopSensorNanos === null && monitoringPointRows.length > 0;

    if (!currentRunInProgress) {
      return rowsFromHistory.length > 0 ? rowsFromHistory : monitoringPointRows;
    }

    const currentRunIndex = runHistory.length + 1;
    const liveRows = monitoringPointRows.map((row) => {
      const checkpointLabel = row?.lap?.roleLabel ?? row?.lap?.senderDeviceName ?? "Checkpoint";
      return {
        ...row,
        lap: {
          ...(row?.lap ?? {}),
          roleLabel: `Run ${currentRunIndex} · ${checkpointLabel}`,
        },
      };
    });

    return [...rowsFromHistory, ...liveRows];
  }, [runHistory, hostStartSensorNanos, hostStopSensorNanos, monitoringPointRows]);

  useEffect(() => {
    const runStopped =
      hostStartSensorNanos !== null && hostStopSensorNanos !== null && hostStopSensorNanos > hostStartSensorNanos;
    if (!monitoringActive || hostStartSensorNanos === null || runStopped) {
      return;
    }

    raceClockAnchorRef.current = {
      elapsedMs: monitoringElapsedMs,
      capturedAtMs: Date.now(),
    };
  }, [hostStartSensorNanos, hostStopSensorNanos, monitoringActive, monitoringElapsedMs]);

  useEffect(() => {
    const runStopped =
      hostStartSensorNanos !== null && hostStopSensorNanos !== null && hostStopSensorNanos > hostStartSensorNanos;
    if (!monitoringActive || hostStartSensorNanos === null || runStopped) {
      return;
    }

    const tickHandle = window.setInterval(() => {
      setRaceClockTickMs(Date.now());
    }, 33);

    return () => {
      window.clearInterval(tickHandle);
    };
  }, [hostStartSensorNanos, hostStopSensorNanos, monitoringActive]);

  useEffect(() => {
    if (hostStartSensorNanos === null) {
      raceClockBaseMsRef.current = null;
      return;
    }
    if (raceClockBaseMsRef.current === null && Number.isFinite(monitoringElapsedMs)) {
      raceClockBaseMsRef.current = monitoringElapsedMs;
    }
  }, [hostStartSensorNanos, monitoringElapsedMs]);

  const raceClockDisplay = useMemo(() => {
    if (hostStartSensorNanos === null) {
      return "00.00s";
    }
    if (hostStopSensorNanos !== null && hostStopSensorNanos > hostStartSensorNanos) {
      return formatDurationNanos(hostStopSensorNanos - hostStartSensorNanos);
    }
    if (!monitoringActive) {
      return "00.00s";
    }

    const baseMs = Number.isFinite(raceClockBaseMsRef.current) ? raceClockBaseMsRef.current! : monitoringElapsedMs;
    const anchorElapsedMs = Number.isFinite(raceClockAnchorRef.current.elapsedMs) ? raceClockAnchorRef.current.elapsedMs : monitoringElapsedMs;
    const anchorCapturedAtMs = Number.isFinite(raceClockAnchorRef.current.capturedAtMs)
      ? raceClockAnchorRef.current.capturedAtMs
      : raceClockTickMs;
    const interpolatedElapsedMs = anchorElapsedMs + Math.max(0, raceClockTickMs - anchorCapturedAtMs);
    const effectiveElapsedMs = Math.max(monitoringElapsedMs, interpolatedElapsedMs);

    return formatRaceClockMs(Math.max(0, effectiveElapsedMs - baseMs));
  }, [hostStartSensorNanos, hostStopSensorNanos, monitoringActive, raceClockTickMs, monitoringElapsedMs]);

  function toggleSpeedUnit() {
    setSpeedUnit((previous) => (previous === "kmh" ? "mps" : "kmh"));
  }

  return (
    <div className="min-h-screen bg-[#f4f4f0] text-black font-sans">
      <main className="flex w-full flex-col gap-4 px-2 pb-2 pt-0 md:px-3 md:pb-3 md:pt-0">
        <section className="space-y-4">
          {lastError ? (
            <div className="border-[3px] border-black bg-[#FF1744] p-4 text-white shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]">
              <p className="font-bold uppercase tracking-wide">Error</p>
              <p className="font-mono text-sm">{lastError}</p>
            </div>
          ) : null}

        {activeTab === "saved" ? (
          <>
            <div className="flex justify-center mt-4">
              <nav className="inline-flex items-center gap-2 border-[3px] border-black bg-white p-1 shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]">
                <button
                  type="button"
                  onClick={() => setActiveTab("live")}
                  className="px-6 py-2 text-sm font-bold uppercase tracking-widest text-black transition-colors hover:bg-gray-100"
                >
                  Live Monitor
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setActiveTab("saved");
                    fetchSavedResultsList();
                  }}
                  className="bg-black px-6 py-2 text-sm font-bold uppercase tracking-widest text-[#FFEA00] transition-colors"
                >
                  <span>Saved Results</span>
                  <span className="ml-2 inline-flex min-w-6 items-center justify-center bg-[#FFEA00] px-1.5 py-0.5 text-xs text-black">
                    {savedResults.length}
                  </span>
                </button>
              </nav>
            </div>
            <SavedResultsPanel
              savedResultsLoading={savedResultsLoading}
              fetchSavedResultsList={fetchSavedResultsList}
              savedResults={savedResults}
              selectedSavedFileName={selectedSavedFileName}
              setSelectedSavedFileName={setSelectedSavedFileName}
              setSelectedSavedMeta={setSelectedSavedMeta}
              savedResultLoading={savedResultLoading}
              selectedSavedPayload={selectedSavedPayload}
              selectedSavedMeta={selectedSavedMeta}
              savedLatestLapResults={savedLatestLapResults}
              savedMonitoringPointRows={savedMonitoringPointRows}
              compareResultsPayload={compareResultsPayload}
            />
          </>
        ) : (
          <>
            <div className="pt-3">
              <RaceTimerPanel
                raceClockDisplay={raceClockDisplay}
                timerStateLabel={timerStateLabel}
                activeTab={activeTab}
                onOpenSavedResults={() => {
                  setActiveTab("saved");
                  fetchSavedResultsList();
                }}
                busyAction={busyAction}
                postControl={postControl}
                canStartMonitoring={canStartMonitoring}
                monitoringActive={monitoringActive}
                saveResultsJson={saveResultsJson}
                canSaveResults={canSaveResults}
                monitoringPointRows={monitoringPointRows}
                speedUnit={speedUnit}
                toggleSpeedUnit={toggleSpeedUnit}
              />
            </div>

            <div className="space-y-6">
              <details open className="border-[3px] border-black bg-white p-5 shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]">
                <summary className="cursor-pointer text-sm font-bold uppercase tracking-widest text-black hover:text-[#FF1744] transition-colors">
                  Display Results
                </summary>
                {monitoringHistoryRows.length === 0 ? (
                  <div className="mt-4 border-[3px] border-black bg-gray-100 px-5 py-8 text-center text-lg font-bold uppercase text-gray-500 shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]">
                    Waiting for split/finish results...
                  </div>
                ) : (
                  <div className="mt-4 flex gap-4 overflow-x-auto pb-2">
                    {monitoringHistoryRows.map(({ lap }, index) => {
                      const checkpointLabel = lap.roleLabel ?? lap.senderDeviceName ?? `Checkpoint ${index + 1}`;
                      const timeDisplay = formatDurationNanos(lap.elapsedNanos);
                      const timeValue = timeDisplay.endsWith("s") ? timeDisplay.slice(0, -1) : timeDisplay;
                      const hasSecondsSuffix = timeDisplay.endsWith("s");
                      const [timeLeft, timeRight] = timeValue.split(".");
                      const hasDecimal = typeof timeRight === "string" && timeRight.length > 0;

                      return (
                        <div
                          key={`display-result-${lap.id ?? `${checkpointLabel}-${index}-${lap.elapsedNanos}`}`}
                          className="min-w-[360px] flex-1 border-[3px] border-black bg-white px-5 py-5 shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]"
                        >
                          <div className="mt-2 grid min-h-[170px] grid-rows-[1fr_auto_2fr]">
                            <div className="flex flex-col items-center justify-center text-center">
                              <p className="text-sm font-bold uppercase tracking-[0.2em] text-black">{checkpointLabel}</p>
                              <p className="mt-2 font-mono text-4xl font-black leading-none text-black md:text-5xl">
                                {formatMeters(lap.distanceMeters)}
                              </p>
                            </div>

                            <div className="my-5 h-[3px] w-full bg-black" />

                            <div className="flex items-center justify-center">
                              <p className="inline-flex w-full items-baseline justify-center gap-1.5 text-center font-mono leading-none">
                                <span className="inline-flex items-baseline text-7xl font-black leading-[0.9] text-black md:text-8xl">
                                  <span>{timeLeft}</span>
                                  {hasDecimal ? <span className="mx-[-0.08em]">.</span> : null}
                                  {hasDecimal ? <span>{timeRight}</span> : null}
                                </span>
                                {hasSecondsSuffix ? (
                                  <span className="text-5xl font-bold leading-[0.9] text-black md:text-6xl">s</span>
                                ) : null}
                              </p>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </details>

              <details open className="border-[3px] border-black bg-white p-5 shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]">
                <summary className="cursor-pointer text-sm font-bold uppercase tracking-widest text-black hover:text-[#FF1744] transition-colors">
                  {monitoringActive ? "Monitoring Devices" : "Connected Devices"}
                </summary>
                <p className="mt-3 mb-5 text-xs font-bold uppercase tracking-wide text-gray-600">
                  {monitoringActive
                    ? "Roles are locked while monitoring. Camera, sensitivity, and distance settings remain editable."
                    : "Assign roles and configure camera, sensitivity, and physical distance per device."}
                </p>
                {clients.length === 0 ? (
                  <p className="text-sm font-bold uppercase text-gray-500">No peers connected yet.</p>
                ) : (
                  <div className="flex gap-4 overflow-x-auto pb-2">
                    {clients.map((client) => {
                      const targetId = client.roleTarget ?? client.endpointId ?? "unknown-target";
                      const actionKey = `assign-role:${targetId}`;
                      const cameraActionKey = `device-config-camera:${targetId}`;
                      const sensitivityActionKey = `device-config-sensitivity:${targetId}`;
                      const distanceActionKey = `device-config-distance:${targetId}`;
                      const resyncActionKey = `device-resync:${targetId}`;
                      const assignedRole = typeof client.assignedRole === "string" ? client.assignedRole : "Unassigned";
                      const effectiveSensitivity =
                        Number.isInteger(client.sensitivity) && Number(client.sensitivity) >= 1 && Number(client.sensitivity) <= 100
                          ? Number(client.sensitivity)
                          : 100;
                      const sensitivityDraft = sensitivityDraftByTarget[targetId] ?? String(effectiveSensitivity);
                      const effectiveDistance =
                        Number.isFinite(client.distanceMeters) && Number(client.distanceMeters) >= 0 ? Number(client.distanceMeters) : 0;
                      const distanceDraft = distanceDraftByTarget[targetId] ?? String(effectiveDistance);
                      const cameraFacing = client.cameraFacing === "front" ? "front" : "rear";
                      const latencyLabel =
                        Number.isInteger(client.telemetryLatencyMs) && Number(client.telemetryLatencyMs) >= 0
                          ? `${client.telemetryLatencyMs} ms`
                          : "-";
                      const syncLabel = client.telemetryClockSynced ? "Synced" : "Unsynced";
                      const clientRoleOptions = roleOptions.includes(assignedRole)
                        ? roleOptions
                        : [...roleOptions, assignedRole].sort(
                            (left, right) => roleOrderIndex(left) - roleOrderIndex(right),
                          );

                      return (
                        <DeviceCard
                          key={client.endpointId || targetId}
                          client={client}
                          targetId={targetId}
                          assignedRole={assignedRole}
                          monitoringActive={monitoringActive}
                          busyAction={busyAction}
                          actionKey={actionKey}
                          cameraActionKey={cameraActionKey}
                          sensitivityActionKey={sensitivityActionKey}
                          distanceActionKey={distanceActionKey}
                          resyncActionKey={resyncActionKey}
                          cameraFacing={cameraFacing}
                          latencyLabel={latencyLabel}
                          syncLabel={syncLabel}
                          clientRoleOptions={clientRoleOptions}
                          sensitivityDraft={sensitivityDraft}
                          distanceDraft={distanceDraft}
                          effectiveSensitivity={effectiveSensitivity}
                          effectiveDistance={effectiveDistance}
                          assignRole={assignRole}
                          toggleCameraFacing={toggleCameraFacing}
                          updateSensitivityDraft={updateSensitivityDraft}
                          updateDistanceDraft={updateDistanceDraft}
                          requestDeviceClockResync={requestDeviceClockResync}
                        />
                      );
                    })}
                  </div>
                )}
              </details>
            </div>

            <SystemDetails
              stage={stage}
              session={session}
              monitoringActive={monitoringActive}
              hostStartSensorNanos={hostStartSensorNanos}
              hostSplitMarks={hostSplitMarks}
              hostStopSensorNanos={hostStopSensorNanos}
              snapshot={snapshot}
            />

            <details className="border-[3px] border-black bg-white p-5 shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]">
              <summary className="cursor-pointer text-sm font-bold uppercase tracking-widest text-black hover:text-[#FF1744] transition-colors">
                Traffic and Events
              </summary>
              <div className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-2">
                <Card title="Protocol Message Types" subtitle="Observed input traffic">
                  {knownTypes.length === 0 ? (
                    <p className="text-sm font-bold uppercase text-gray-500">No message types observed yet.</p>
                  ) : (
                    <ul className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
                      {knownTypes.map(([name, count]) => (
                        <li
                          key={name}
                          className="flex items-center justify-between border-[2px] border-black bg-gray-100 px-3 py-2 shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]"
                        >
                          <span className="font-mono text-xs font-bold text-black">{name}</span>
                          <span className="bg-black px-2 py-0.5 text-xs font-bold text-white">{count}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>

                <Card title="Recent Events" subtitle="Newest first">
                  {recentEvents.length === 0 ? (
                    <p className="text-sm font-bold uppercase text-gray-500">No events logged yet.</p>
                  ) : (
                    <ul className="max-h-80 space-y-3 overflow-auto text-sm pr-2">
                      {recentEvents.map((event) => (
                        <li key={event.id} className="border-[2px] border-black bg-gray-100 px-4 py-3 shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]">
                          <div className="flex items-center justify-between gap-3">
                            <span className="font-bold text-black">{event.message}</span>
                            <span className={`text-xs font-bold uppercase tracking-widest px-2 py-1 border-[2px] border-black ${event.level === 'error' ? 'bg-[#FF1744] text-white' : 'bg-white text-black'}`}>{event.level}</span>
                          </div>
                          <div className="mt-2 text-xs font-bold text-gray-500 font-mono">{event.timestampIso ?? "-"}</div>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              </div>
            </details>
          </>
        )}
        </section>
      </main>
    </div>
  );
}
