import { useEffect, useMemo, useRef, useState } from "react";
import { deriveMonitoringElapsedMs } from "./raceClock.js";
import {
  buildMonitoringPointRows,
  computeProgressiveRoleOptions,
  formatAcceleration,
  formatDateForResultName,
  formatDurationNanos,
  formatIsoTime,
  formatMeters,
  formatRaceClockMs,
  formatSpeedWithUnit,
  normalizeAthleteNameDraft,
  normalizeRoleOptions,
  roleOrderIndex,
  stageLabel,
} from "./utils";
import ActionButton from "./components/ActionButton";
import Card from "./components/Card";
import DeviceCard from "./components/DeviceCard";
import MonitoringControls from "./components/MonitoringControls";
import RaceTimerPanel from "./components/RaceTimerPanel";
import SavedResultsPanel from "./components/SavedResultsPanel";
import SystemDetails from "./components/SystemDetails";

const AUTO_APPLY_DELAY_MS = 350;
const DEV_UI_MOCK_MODE = import.meta.env.DEV;

function createDevMockSnapshot() {
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
      { id: "dev-evt-1", message: "Monitoring active (dev mock)", level: "info", timestampIso: new Date(now - 8000).toISOString() },
      { id: "dev-evt-2", message: "Split 1 captured", level: "info", timestampIso: new Date(now - 5200).toISOString() },
      { id: "dev-evt-3", message: "Split 2 captured", level: "info", timestampIso: new Date(now - 1600).toISOString() },
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

function applyDevMockControl(currentSnapshot: any, path: string, body: any) {
  if (!currentSnapshot || typeof currentSnapshot !== "object") {
    return currentSnapshot;
  }

  const nextSnapshot = {
    ...currentSnapshot,
    session: { ...(currentSnapshot.session ?? {}) },
    clients: Array.isArray(currentSnapshot.clients) ? [...currentSnapshot.clients] : [],
    latestLapResults: Array.isArray(currentSnapshot.latestLapResults) ? [...currentSnapshot.latestLapResults] : [],
  };

  const session = nextSnapshot.session;
  const now = Date.now();

  switch (path) {
    case "/api/control/start-monitoring":
      session.stage = "MONITORING";
      session.monitoringActive = true;
      session.monitoringStartedAtMs = now;
      return nextSnapshot;
    case "/api/control/stop-monitoring":
      session.stage = "SETUP";
      session.monitoringActive = false;
      return nextSnapshot;
    case "/api/control/reset-run":
      session.stage = "SETUP";
      session.monitoringActive = false;
      session.monitoringStartedAtMs = null;
      session.monitoringElapsedMs = 0;
      session.hostStartSensorNanos = null;
      session.hostStopSensorNanos = null;
      session.hostSplitMarks = [];
      nextSnapshot.latestLapResults = [];
      return nextSnapshot;
    case "/api/control/assign-role": {
      const targetId = body?.targetId;
      const role = body?.role;
      if (typeof targetId === "string" && typeof role === "string") {
        nextSnapshot.clients = nextSnapshot.clients.map((client: any) =>
          client?.roleTarget === targetId ? { ...client, assignedRole: role } : client,
        );
      }
      return nextSnapshot;
    }
    case "/api/control/device-config": {
      const targetId = body?.targetId;
      if (typeof targetId === "string") {
        nextSnapshot.clients = nextSnapshot.clients.map((client: any) => {
          if (client?.roleTarget !== targetId) return client;
          return {
            ...client,
            ...(body?.cameraFacing ? { cameraFacing: body.cameraFacing } : {}),
            ...(Number.isInteger(body?.sensitivity) ? { sensitivity: body.sensitivity } : {}),
            ...(Number.isFinite(body?.distanceMeters) ? { distanceMeters: body.distanceMeters } : {}),
          };
        });
      }
      return nextSnapshot;
    }
    default:
      return nextSnapshot;
  }
}

export default function App() {
  const [snapshot, setSnapshot] = useState<any>(() => (DEV_UI_MOCK_MODE ? createDevMockSnapshot() : null));
  const [wsConnected, setWsConnected] = useState(() => DEV_UI_MOCK_MODE);
  const [busyAction, setBusyAction] = useState("");
  const [lastError, setLastError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [sensitivityDraftByTarget, setSensitivityDraftByTarget] = useState({});
  const [distanceDraftByTarget, setDistanceDraftByTarget] = useState({});
  const [activeTab, setActiveTab] = useState("live");
  const [speedUnit, setSpeedUnit] = useState("kmh");
  const [savedResults, setSavedResults] = useState([]);
  const [savedResultsLoading, setSavedResultsLoading] = useState(false);
  const [savedResultLoading, setSavedResultLoading] = useState(false);
  const [selectedSavedFileName, setSelectedSavedFileName] = useState("");
  const [selectedSavedMeta, setSelectedSavedMeta] = useState(null);
  const [selectedSavedPayload, setSelectedSavedPayload] = useState(null);
  const [runHistory, setRunHistory] = useState<Array<{ key: string; rows: any[] }>>([]);
  const [raceClockTickMs, setRaceClockTickMs] = useState(() => Date.now());
  const raceClockBaseMsRef = useRef(null);
  const raceClockAnchorRef = useRef({
    elapsedMs: 0,
    capturedAtMs: Date.now(),
  });
  const sensitivityApplyTimeoutsRef = useRef(new Map());
  const distanceApplyTimeoutsRef = useRef(new Map());

  async function fetchState() {
    setRefreshing(true);
    try {
      if (DEV_UI_MOCK_MODE) {
        setLastError("");
        return;
      }
      const response = await fetch("/api/state");
      if (!response.ok) throw new Error(`State request failed (${response.status})`);
      setSnapshot(await response.json());
      setLastError("");
    } catch (error) {
      setLastError(error instanceof Error ? error.message : "State fetch failed");
    } finally {
      setRefreshing(false);
    }
  }

  async function postControl(path: string, body: unknown = null, actionKey = path): Promise<any> {
    setBusyAction(actionKey);
    try {
      if (DEV_UI_MOCK_MODE) {
        setSnapshot((previous: any) => applyDevMockControl(previous, path, body));
        setLastError("");
        return { ok: true, mock: true };
      }

      const response = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });

      let payload: any = {};
      try {
        payload = await response.json();
      } catch {
        payload = {};
      }

      if (!response.ok) {
        const message = typeof payload?.error === "string" ? payload.error : `Request failed (${response.status})`;
        throw new Error(message);
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

  async function fetchSavedResultsList(preferredFileName = null) {
    setSavedResultsLoading(true);
    try {
      if (DEV_UI_MOCK_MODE) {
        setSavedResults([]);
        setSelectedSavedFileName("");
        setSelectedSavedMeta(null);
        setSelectedSavedPayload(null);
        setLastError("");
        return;
      }

      const response = await fetch("/api/results");
      if (!response.ok) throw new Error(`Saved results request failed (${response.status})`);
      const payload = await response.json();
      const items = Array.isArray(payload?.items) ? payload.items : [];
      setSavedResults(items);

      if (items.length === 0) {
        setSelectedSavedFileName("");
        setSelectedSavedMeta(null);
        setSelectedSavedPayload(null);
        return;
      }

      const desired = preferredFileName || selectedSavedFileName;
      const selected = items.find((item) => item.fileName === desired) ?? items[0];
      setSelectedSavedFileName(selected.fileName);
      setSelectedSavedMeta(selected);
    } catch (error) {
      setLastError(error instanceof Error ? error.message : "Saved results fetch failed");
    } finally {
      setSavedResultsLoading(false);
    }
  }

  async function loadSavedResult(fileName) {
    if (!fileName) {
      setSelectedSavedPayload(null);
      return;
    }

    setSavedResultLoading(true);
    try {
      if (DEV_UI_MOCK_MODE) {
        setSelectedSavedPayload(null);
        setLastError("");
        return;
      }

      const response = await fetch(`/api/results/${encodeURIComponent(fileName)}`);
      if (!response.ok) throw new Error(`Saved result load failed (${response.status})`);
      const payload = await response.json();
      setSelectedSavedPayload(payload?.payload ?? null);
      setLastError("");
    } catch (error) {
      setSelectedSavedPayload(null);
      setLastError(error instanceof Error ? error.message : "Saved result load failed");
    } finally {
      setSavedResultLoading(false);
    }
  }

  function assignRole(targetId, role) {
    postControl("/api/control/assign-role", { targetId, role }, `assign-role:${targetId}`);
  }

  function fireTrigger(role) {
    postControl("/api/control/trigger", { role }, `trigger:${role}`);
  }

  function updateDeviceConfig(targetId, patch, actionKey) {
    postControl("/api/control/device-config", { targetId, ...patch }, actionKey);
  }

  function clearScheduledApply(timeoutsRef, targetId) {
    const timeoutId = timeoutsRef.current.get(targetId);
    if (timeoutId) {
      window.clearTimeout(timeoutId);
      timeoutsRef.current.delete(targetId);
    }
  }

  function setCameraFacing(targetId, cameraFacing) {
    updateDeviceConfig(targetId, { cameraFacing }, `device-config-camera:${targetId}`);
  }

  function toggleCameraFacing(targetId, currentCameraFacing) {
    const nextCameraFacing = currentCameraFacing === "front" ? "rear" : "front";
    setCameraFacing(targetId, nextCameraFacing);
  }

  function requestDeviceClockResync(targetId) {
    postControl("/api/control/resync-device", { targetId }, `device-resync:${targetId}`);
  }

  function updateSensitivityDraft(targetId, rawValue, fallbackSensitivity) {
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

  function updateDistanceDraft(targetId, rawValue, fallbackDistanceMeters) {
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
    if (DEV_UI_MOCK_MODE) {
      return;
    }

    let socket;
    let disposed = false;
    let reconnectHandle;

    function connect() {
      const protocol = window.location.protocol === "https:" ? "wss" : "ws";
      socket = new WebSocket(`${protocol}://${window.location.host}/ws`);

      socket.onopen = () => {
        if (disposed) return;
        setWsConnected(true);
      };

      socket.onmessage = (event) => {
        if (disposed) return;
        try {
          const payload = JSON.parse(event.data);
          if (payload.type === "snapshot" || payload.type === "state:update") {
            setSnapshot(payload.payload);
          }
        } catch {
          setLastError("Malformed WebSocket payload");
        }
      };

      socket.onclose = () => {
        if (disposed) return;
        setWsConnected(false);
        reconnectHandle = window.setTimeout(connect, 1500);
      };

      socket.onerror = () => {
        if (disposed) return;
        setLastError("WebSocket error");
      };
    }

    fetchState();
    fetchSavedResultsList();
    connect();

    return () => {
      disposed = true;
      if (reconnectHandle) window.clearTimeout(reconnectHandle);
      if (socket) socket.close();
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
  const firedSplitRoles = new Set(
    hostSplitMarks
      .map((splitMark) => splitMark?.roleLabel)
      .filter((roleLabel) => typeof roleLabel === "string"),
  );
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

  const fallbackRoleOptions = useMemo(() => computeProgressiveRoleOptions(clients), [clients]);
  const serverRoleOptions = useMemo(() => normalizeRoleOptions(session.roleOptions), [session.roleOptions]);
  const roleOptions = serverRoleOptions.length > 0 ? serverRoleOptions : fallbackRoleOptions;
  const triggerRoles = ["Start", "Split 1", "Split 2", "Split 3", "Split 4", "Stop"];
  const hasStartAssignment = clients.some((client) => client.assignedRole === "Start");
  const hasStopAssignment = clients.some((client) => client.assignedRole === "Stop");
  const canStartMonitoring = clients.length > 0 && hasStartAssignment && hasStopAssignment && !monitoringActive;

  const savedLatestLapResults = Array.isArray(selectedSavedPayload?.latestLapResults)
    ? selectedSavedPayload.latestLapResults
    : [];

  const savedMonitoringPointRows = useMemo(
    () => buildMonitoringPointRows(savedLatestLapResults),
    [savedLatestLapResults],
  );

  const monitoringPointRows = useMemo(() => buildMonitoringPointRows(latestLapResults), [latestLapResults]);

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

    const baseMs = Number.isFinite(raceClockBaseMsRef.current) ? raceClockBaseMsRef.current : monitoringElapsedMs;
    const anchorElapsedMs = Number.isFinite(raceClockAnchorRef.current.elapsedMs) ? raceClockAnchorRef.current.elapsedMs : monitoringElapsedMs;
    const anchorCapturedAtMs = Number.isFinite(raceClockAnchorRef.current.capturedAtMs)
      ? raceClockAnchorRef.current.capturedAtMs
      : raceClockTickMs;
    const interpolatedElapsedMs = anchorElapsedMs + Math.max(0, raceClockTickMs - anchorCapturedAtMs);
    const effectiveElapsedMs = Math.max(monitoringElapsedMs, interpolatedElapsedMs);

    return formatRaceClockMs(Math.max(0, effectiveElapsedMs - baseMs));
  }, [hostStartSensorNanos, hostStopSensorNanos, monitoringActive, raceClockTickMs, monitoringElapsedMs]);

  function triggerDisabled(roleLabel) {
    if (!monitoringActive) {
      return true;
    }

    if (roleLabel === "Start") {
      return hostStartSensorNanos !== null;
    }

    if (roleLabel === "Stop") {
      return hostStartSensorNanos === null || hostStopSensorNanos !== null;
    }

    const splitMatch = /^Split\s+(\d)$/i.exec(roleLabel);
    if (!splitMatch) {
      return false;
    }

    const splitIndex = Number(splitMatch[1]);
    if (hostStartSensorNanos === null || hostStopSensorNanos !== null) {
      return true;
    }
    if (firedSplitRoles.has(roleLabel)) {
      return true;
    }
    if (splitIndex > 1 && !firedSplitRoles.has(`Split ${splitIndex - 1}`)) {
      return true;
    }
    return false;
  }

  function triggerActive(roleLabel) {
    if (roleLabel === "Start") {
      return hostStartSensorNanos !== null && hostStopSensorNanos === null;
    }
    if (roleLabel === "Stop") {
      return hostStopSensorNanos !== null;
    }
    return firedSplitRoles.has(roleLabel);
  }

  function toggleSpeedUnit() {
    setSpeedUnit((previous) => (previous === "kmh" ? "mps" : "kmh"));
  }

  return (
    <div className="min-h-screen bg-black text-slate-900">
      <main className="flex w-full flex-col gap-4 px-2 pb-2 pt-0 md:px-3 md:pb-3 md:pt-0">
        <section className="space-y-4">
          {lastError ? (
            <p className="rounded-md bg-rose-100 px-3 py-2 text-sm text-rose-700">{lastError}</p>
          ) : null}

        {activeTab === "saved" ? (
          <>
            <div className="flex justify-center">
              <nav className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-800/80 p-1">
                <button
                  type="button"
                  onClick={() => setActiveTab("live")}
                  className="rounded-lg px-4 py-2 text-sm font-semibold text-slate-300 transition-colors hover:bg-slate-700/60 hover:text-white"
                >
                  Live Monitor
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setActiveTab("saved");
                    fetchSavedResultsList();
                  }}
                  className="rounded-lg bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-900 transition-colors"
                >
                  <span>Saved Results</span>
                  <span className="ml-2 inline-flex min-w-6 items-center justify-center rounded-full bg-slate-700 px-1.5 py-0.5 text-xs text-white">
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
              speedUnit={speedUnit}
              toggleSpeedUnit={toggleSpeedUnit}
            />
          </>
        ) : (
          <>
            <div className="relative pt-3">
              <div className="absolute left-1/2 top-6 z-20 -translate-x-1/2">
                <nav className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-800/80 p-1">
                  <button
                    type="button"
                    onClick={() => setActiveTab("live")}
                    className={`rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
                      activeTab === "live"
                        ? "bg-slate-100 text-slate-900"
                        : "text-slate-300 hover:bg-slate-700/60 hover:text-white"
                    }`}
                  >
                    Live Monitor
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setActiveTab("saved");
                      fetchSavedResultsList();
                    }}
                    className={`rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
                      activeTab === "saved"
                        ? "bg-slate-100 text-slate-900"
                        : "text-slate-300 hover:bg-slate-700/60 hover:text-white"
                    }`}
                  >
                    <span>Saved Results</span>
                    {activeTab === "saved" ? (
                      <span
                        className={`ml-2 inline-flex min-w-6 items-center justify-center rounded-full px-1.5 py-0.5 text-xs ${
                          activeTab === "saved" ? "bg-slate-700 text-white" : "bg-slate-100 text-slate-600"
                        }`}
                      >
                        {savedResults.length}
                      </span>
                    ) : null}
                  </button>
                </nav>
              </div>
              <RaceTimerPanel
                raceClockDisplay={raceClockDisplay}
                timerStateLabel={timerStateLabel}
                hostStartSensorNanos={hostStartSensorNanos}
                hostSplitMarks={hostSplitMarks}
                hostStopSensorNanos={hostStopSensorNanos}
                monitoringPointRows={monitoringHistoryRows}
                speedUnit={speedUnit}
                toggleSpeedUnit={toggleSpeedUnit}
                withFloatingTabs
              />
            </div>

            <MonitoringControls
              refreshing={refreshing}
              fetchState={fetchState}
              busyAction={busyAction}
              postControl={postControl}
              canStartMonitoring={canStartMonitoring}
              monitoringActive={monitoringActive}
              saveResultsJson={saveResultsJson}
              canSaveResults={canSaveResults}
              triggerRoles={triggerRoles}
              fireTrigger={fireTrigger}
              triggerDisabled={triggerDisabled}
              triggerActive={triggerActive}
              hasStartAssignment={hasStartAssignment}
              hasStopAssignment={hasStopAssignment}
              lastSavedFilePath={lastSavedFilePath}
              lastSavedAtIso={lastSavedAtIso}
              formatIsoTime={formatIsoTime}
            />

            <div className="space-y-4">
              <details open className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <summary className="cursor-pointer text-sm font-semibold uppercase tracking-wide text-slate-700">
                  {monitoringActive ? "Monitoring Results" : "Latest Lap Results"}
                </summary>
                <p className="mt-2 mb-3 text-xs text-slate-500">Distance checkpoints with time, speed at point, and acceleration</p>
                {latestLapResults.length === 0 ? (
                  <p className="text-sm text-slate-500">
                    No monitoring results recorded yet. Fire Start and Stop triggers (with splits if needed) to generate results.
                  </p>
                ) : (
                  <div className="overflow-auto">
                    <table className="min-w-full text-left text-sm">
                      <thead className="text-xs uppercase tracking-wide text-slate-500">
                        <tr>
                          <th className="pb-2 pr-3">Distance</th>
                          <th className="pb-2 pr-3">Time</th>
                          <th className="pb-2 pr-3">Speed</th>
                          <th className="pb-2">Acceleration (m/s^2)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {monitoringPointRows.map(({ lap, pointSpeedMps, accelerationMps2 }) => {
                          return (
                            <tr key={lap.id}>
                              <td className="py-2 pr-3 text-slate-700">{formatMeters(lap.distanceMeters)}</td>
                              <td className="py-2 pr-3 font-mono text-slate-900">{formatDurationNanos(lap.elapsedNanos)}</td>
                              <td className="py-2 pr-3 text-slate-700">
                                <button type="button" onClick={toggleSpeedUnit} className="font-mono">
                                  {formatSpeedWithUnit(pointSpeedMps, speedUnit)}
                                </button>
                              </td>
                              <td className="py-2 text-slate-700">{formatAcceleration(accelerationMps2)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </details>

              <details open className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <summary className="cursor-pointer text-sm font-semibold uppercase tracking-wide text-slate-700">
                  {monitoringActive ? "Monitoring Devices" : "Connected Devices"}
                </summary>
                <p className="mt-2 mb-3 text-xs text-slate-500">
                  {monitoringActive
                    ? "Roles are locked while monitoring. Camera, sensitivity, and distance settings remain editable."
                    : "Assign roles and configure camera, sensitivity, and physical distance per device."}
                </p>
                {clients.length === 0 ? (
                  <p className="text-sm text-slate-500">No peers connected yet.</p>
                ) : (
                  <div className="flex gap-3 overflow-x-auto pb-1">
                    {clients.map((client) => {
                      const targetId = client.roleTarget;
                      const actionKey = `assign-role:${targetId}`;
                      const cameraActionKey = `device-config-camera:${targetId}`;
                      const sensitivityActionKey = `device-config-sensitivity:${targetId}`;
                      const distanceActionKey = `device-config-distance:${targetId}`;
                      const resyncActionKey = `device-resync:${targetId}`;
                      const assignedRole = client.assignedRole ?? "Unassigned";
                      const effectiveSensitivity =
                        Number.isInteger(client.sensitivity) && client.sensitivity >= 1 && client.sensitivity <= 100
                          ? client.sensitivity
                          : 100;
                      const sensitivityDraft = sensitivityDraftByTarget[targetId] ?? String(effectiveSensitivity);
                      const effectiveDistance =
                        Number.isFinite(client.distanceMeters) && client.distanceMeters >= 0 ? client.distanceMeters : 0;
                      const distanceDraft = distanceDraftByTarget[targetId] ?? String(effectiveDistance);
                      const cameraFacing = client.cameraFacing === "front" ? "front" : "rear";
                      const latencyLabel =
                        Number.isInteger(client.telemetryLatencyMs) && client.telemetryLatencyMs >= 0
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

            <details className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <summary className="cursor-pointer text-sm font-semibold uppercase tracking-wide text-slate-700">
                Traffic and Events
              </summary>
              <div className="mt-3 grid grid-cols-1 gap-4 xl:grid-cols-2">
                <Card title="Protocol Message Types" subtitle="Observed input traffic">
                  {knownTypes.length === 0 ? (
                    <p className="text-sm text-slate-500">No message types observed yet.</p>
                  ) : (
                    <ul className="grid grid-cols-1 gap-1 text-sm sm:grid-cols-2">
                      {knownTypes.map(([name, count]) => (
                        <li
                          key={name}
                          className="flex items-center justify-between rounded border border-slate-200 bg-slate-50 px-2 py-1"
                        >
                          <span className="font-mono text-xs">{name}</span>
                          <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-semibold">{count}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>

                <Card title="Recent Events" subtitle="Newest first">
                  {recentEvents.length === 0 ? (
                    <p className="text-sm text-slate-500">No events logged yet.</p>
                  ) : (
                    <ul className="max-h-80 space-y-2 overflow-auto text-sm">
                      {recentEvents.map((event) => (
                        <li key={event.id} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-semibold text-slate-800">{event.message}</span>
                            <span className="text-xs uppercase tracking-wide text-slate-500">{event.level}</span>
                          </div>
                          <div className="mt-1 text-xs text-slate-500">{event.timestampIso}</div>
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
