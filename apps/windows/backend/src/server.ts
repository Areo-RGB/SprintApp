import net from "node:net";
import { createServer as createHttpServer } from "node:http";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import cors from "cors";
import express from "express";
import * as flatbuffers from "flatbuffers";
import { WebSocketServer } from "ws";
import {
  ClockResyncRequest as FlatBufferClockResyncRequest,
  DeviceConfigUpdate as FlatBufferDeviceConfigUpdate,
  SessionDeviceRole as FlatBufferSessionDeviceRole,
  SessionSnapshot as FlatBufferSessionSnapshot,
  SessionSnapshotDevice as FlatBufferSessionSnapshotDevice,
  SessionSplitMark as FlatBufferSessionSplitMark,
  SessionTimelineSnapshot as FlatBufferSessionTimelineSnapshot,
  SessionTrigger as FlatBufferSessionTrigger,
  TelemetryEnvelope as FlatBufferTelemetryEnvelope,
  TelemetryPayload as FlatBufferTelemetryPayload,
  TriggerRefinement as FlatBufferTriggerRefinement,
} from "./schema/sprint-sync/schema.js";
import type {
  CameraFacing,
  EventLevel,
  ClientState,
  ClientsByEndpoint,
  ClockDomainState,
  ClockResyncLoopsByEndpoint,
  LatestLapByEndpoint,
  LapResult,
  MessageStats,
  RoleLabel,
  ServerEvent,
  SessionState,
  SocketContext,
  SocketsByEndpoint,
  TimelineLapResult,
  TriggerSpec,
} from "./types.js";
import {
  computeProgressiveRoleOptions,
  formatDateForResultName,
  normalizeAthleteNameForResult,
  ROLE_ORDER,
  roleOrderIndex,
} from "../../shared/src/sessionShared.js";
import {
  isSafeSavedResultsFileName,
  listSavedResultItems,
  loadSavedResultsFile,
  sanitizeFileNameSegment,
} from "./results.js";

type UnknownRecord = Record<string, unknown>;
type TriggerRoleLabel = Exclude<RoleLabel, "Unassigned">;

interface DeviceIdentityMessage {
  stableDeviceId?: unknown;
  deviceName?: unknown;
}

interface DeviceTelemetryMessage {
  stableDeviceId?: unknown;
  sensitivity?: unknown;
  timestampMillis?: unknown;
  latencyMs?: unknown;
  analysisWidth?: unknown;
  analysisHeight?: unknown;
  clockSynced?: unknown;
}

interface LapResultMessage {
  senderDeviceName?: unknown;
  startedSensorNanos?: unknown;
  stoppedSensorNanos?: unknown;
}

interface TriggerRequestMessage {
  role?: unknown;
  mappedHostSensorNanos?: unknown;
}

interface SessionTriggerMessage {
  triggerType?: unknown;
  splitIndex?: unknown;
}

interface TriggerRefinementMessage {
  runId?: unknown;
  role?: unknown;
  provisionalHostSensorNanos?: unknown;
  refinedHostSensorNanos?: unknown;
}

interface TelemetryTriggerRequestMessage {
  role: string;
  triggerSensorNanos: number;
  mappedHostSensorNanos: number | null;
  sourceDeviceId: string;
  sourceElapsedNanos: number;
  mappedAnchorElapsedNanos: number | null;
}

interface TelemetrySessionTriggerMessage {
  triggerType: string;
  splitIndex: number | null;
  triggerSensorNanos: number;
}

interface TelemetryTimelineSnapshotMessage {
  hostStartSensorNanos: number | null;
  hostStopSensorNanos: number | null;
  hostSplitMarks: Array<{ role: string; hostSensorNanos: number }>;
  sentElapsedNanos: number;
}

interface TelemetryDeviceIdentityMessage {
  stableDeviceId: string;
  deviceName: string;
}

interface TelemetryDeviceTelemetryMessage {
  stableDeviceId: string;
  role: string;
  sensitivity: number;
  latencyMs: number | null;
  clockSynced: boolean;
  analysisWidth: number | null;
  analysisHeight: number | null;
  timestampMillis: number;
}

interface TelemetryLapResultMessage {
  senderDeviceName: string;
  startedSensorNanos: number;
  stoppedSensorNanos: number;
}

type TelemetryEnvelopeDecoded =
  | { type: "trigger_request"; message: TelemetryTriggerRequestMessage }
  | { type: "session_trigger"; message: TelemetrySessionTriggerMessage }
  | { type: "timeline_snapshot"; message: TelemetryTimelineSnapshotMessage }
  | { type: "device_identity"; message: TelemetryDeviceIdentityMessage }
  | { type: "device_telemetry"; message: TelemetryDeviceTelemetryMessage }
  | { type: "lap_result"; message: TelemetryLapResultMessage };

const FRAME_KIND_MESSAGE = 1;
const FRAME_KIND_BINARY = 2;
const FRAME_KIND_TELEMETRY_BINARY = 3;
const MAX_FRAME_BYTES = 1_048_576;

const CLOCK_SYNC_VERSION = 1;
const CLOCK_SYNC_TYPE_REQUEST = 1;
const CLOCK_SYNC_TYPE_RESPONSE = 2;
const CLOCK_SYNC_REQUEST_BYTES = 10;
const CLOCK_SYNC_RESPONSE_BYTES = 26;
const CLOCK_RESYNC_MIN_SAMPLE_COUNT = 3;
const CLOCK_RESYNC_MAX_SAMPLE_COUNT = 24;
const CLOCK_RESYNC_DEFAULT_SAMPLE_COUNT = 8;
const CLOCK_RESYNC_TARGET_LATENCY_MS = 50;
const CLOCK_RESYNC_RETRY_DELAY_MS = 1_200;

const TELEMETRY_PAYLOAD_SESSION_TRIGGER_REQUEST = 1;
const TELEMETRY_PAYLOAD_SESSION_TRIGGER = 2;
const TELEMETRY_PAYLOAD_SESSION_TIMELINE_SNAPSHOT = 3;
const TELEMETRY_PAYLOAD_SESSION_SNAPSHOT = 4;
const TELEMETRY_PAYLOAD_TRIGGER_REFINEMENT = 5;
const TELEMETRY_PAYLOAD_DEVICE_CONFIG_UPDATE = 6;
const TELEMETRY_PAYLOAD_CLOCK_RESYNC_REQUEST = 7;
const TELEMETRY_PAYLOAD_DEVICE_IDENTITY = 8;
const TELEMETRY_PAYLOAD_DEVICE_TELEMETRY = 9;
const TELEMETRY_PAYLOAD_LAP_RESULT = 10;
const TELEMETRY_MISSING_OPTIONAL_LONG = -1n;
const TELEMETRY_MISSING_OPTIONAL_INT = -1;
const MAX_SAFE_INT64 = BigInt(Number.MAX_SAFE_INTEGER);
const MIN_SAFE_INT64 = BigInt(Number.MIN_SAFE_INTEGER);

const EVENT_LIMIT = 300;
const HISTORY_LIMIT = 1000;

const SESSION_STAGE_SETUP = "SETUP";
const SESSION_STAGE_LOBBY = "LOBBY";
const SESSION_STAGE_MONITORING = "MONITORING";

const SPLIT_ROLE_OPTIONS: RoleLabel[] = ["Split 1", "Split 2", "Split 3", "Split 4"];
const AUTO_ASSIGN_ROLE_SEQUENCE: RoleLabel[] = ["Start", "Stop", ...SPLIT_ROLE_OPTIONS];
const STOP_ROLE_DEFAULT_DISTANCE_METERS = 20;

const moduleFilePath = typeof __filename === "string" ? __filename : fileURLToPath(import.meta.url);
const moduleDirPath = path.dirname(moduleFilePath);
const backendRootPath = path.resolve(moduleDirPath, "..");
const packagedFrontendDistPath = path.join(backendRootPath, "dist", "ui");
const workspaceFrontendDistPath = path.resolve(backendRootPath, "..", "ui", "dist");

const frontendDistCandidates = [
  process.env.WINDOWS_UI_DIST_DIR,
  packagedFrontendDistPath,
  workspaceFrontendDistPath,
].filter((candidate): candidate is string => Boolean(candidate));

const frontendDistPath =
  frontendDistCandidates.find((candidatePath) => fsSync.existsSync(path.join(candidatePath, "index.html"))) ??
  packagedFrontendDistPath;
const frontendIndexPath = path.join(frontendDistPath, "index.html");
const frontendBundleAvailable = fsSync.existsSync(frontendIndexPath);

const config = {
  tcpHost: process.env.WINDOWS_TCP_HOST ?? "0.0.0.0",
  tcpPort: toPort(process.env.WINDOWS_TCP_PORT, 9000),
  httpHost: process.env.WINDOWS_HTTP_HOST ?? "0.0.0.0",
  httpPort: toPort(process.env.WINDOWS_HTTP_PORT, 8787),
  resultsDir: path.resolve(process.env.WINDOWS_RESULTS_DIR ?? path.join(backendRootPath, "saved-results")),
  frontendDistDir: frontendDistPath,
};

const startedAtMs = Date.now();

const clientsByEndpoint: ClientsByEndpoint = new Map<string, ClientState>();
const socketsByEndpoint: SocketsByEndpoint = new Map<string, SocketContext>();
const latestLapByEndpoint: LatestLapByEndpoint = new Map<string, LapResult>();
const clockResyncLoopsByEndpoint: ClockResyncLoopsByEndpoint = new Map();

const lapHistory: LapResult[] = [];
const recentEvents: ServerEvent[] = [];

const sessionState: SessionState = {
  stage: SESSION_STAGE_LOBBY,
  monitoringActive: false,
  monitoringStartedAtMs: null,
  monitoringStartedIso: null,
  monitoringElapsedMs: 0,
  runId: null,
  hostStartSensorNanos: null,
  hostStopSensorNanos: null,
  hostSplitMarks: [],
  roleAssignments: {},
  deviceSensitivityAssignments: {},
  deviceCameraFacingAssignments: {},
  deviceDistanceAssignments: {},
  lastSavedResultsFilePath: null,
  lastSavedResultsAtIso: null,
};

const messageStats: MessageStats = {
  totalFrames: 0,
  messageFrames: 0,
  binaryFrames: 0,
  parseErrors: 0,
  knownTypes: {},
};

const clockDomainState: ClockDomainState = {
  implemented: true,
  source: "windows_monotonic_elapsed",
  samplesResponded: 0,
  ignoredFrames: 0,
  lastEndpointId: null,
  lastRequestAtIso: null,
  lastResponseAtIso: null,
  lastHostReceiveElapsedNanos: null,
  lastHostSendElapsedNanos: null,
};

let nextEventId = 1;
let nextLapId = 1;

let websocketServer: WebSocketServer | null = null;

const app = express();
app.use(cors());
app.use(express.json({ limit: "256kb" }));

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    timestampIso: new Date().toISOString(),
    uptimeMs: Date.now() - startedAtMs,
  });
});

app.get("/api/state", (_req, res) => {
  res.json(createSnapshot());
});

app.post("/api/control/reset-laps", (_req, res) => {
  resetRunData();
  pushEvent("info", "Operator reset lap results");
  publishState();
  res.json({ ok: true });
});

app.post("/api/control/start-lobby", (_req, res) => {
  sessionState.stage = SESSION_STAGE_LOBBY;
  sessionState.monitoringActive = false;
  sessionState.monitoringStartedAtMs = null;
  sessionState.monitoringStartedIso = null;
  sessionState.monitoringElapsedMs = 0;
  sessionState.runId = null;
  sessionState.hostStartSensorNanos = null;
  sessionState.hostStopSensorNanos = null;
  sessionState.hostSplitMarks = [];
  pushEvent("info", "Session moved to lobby");
  broadcastProtocolSnapshots();
  broadcastTimelineSnapshot();
  publishState();
  res.json({ ok: true });
});

app.post("/api/control/start-monitoring", (_req, res) => {
  if (sessionState.stage !== SESSION_STAGE_LOBBY) {
    sessionState.stage = SESSION_STAGE_LOBBY;
  }

  const connectedDevices = protocolDevicesWithRoles();
  const hasStartRole = connectedDevices.some((device) => device.roleLabel === "Start");
  const hasStopRole = connectedDevices.some((device) => device.roleLabel === "Stop");
  if (!hasStartRole || !hasStopRole) {
    res.status(409).json({ error: "assign start and stop roles before monitoring" });
    return;
  }

  const startedAtMs = Date.now();
  sessionState.stage = SESSION_STAGE_MONITORING;
  sessionState.monitoringActive = true;
  sessionState.monitoringStartedAtMs = startedAtMs;
  sessionState.monitoringStartedIso = new Date(startedAtMs).toISOString();
  sessionState.monitoringElapsedMs = 0;
  sessionState.runId = `run-${startedAtMs}`;
  sessionState.hostStartSensorNanos = null;
  sessionState.hostStopSensorNanos = null;
  sessionState.hostSplitMarks = [];
  resetRunData();
  let resyncScheduledCount = 0;
  for (const endpointId of socketsByEndpoint.keys()) {
    if (
      startClockResyncLoopForEndpoint(
        endpointId,
        CLOCK_RESYNC_DEFAULT_SAMPLE_COUNT,
        CLOCK_RESYNC_TARGET_LATENCY_MS,
      )
    ) {
      resyncScheduledCount += 1;
    }
  }

  pushEvent("info", "Monitoring started", {
    runId: sessionState.runId,
    resyncScheduledCount,
    targetLatencyMs: CLOCK_RESYNC_TARGET_LATENCY_MS,
  });
  broadcastProtocolSnapshots();
  broadcastTimelineSnapshot();
  publishState();
  res.json({ ok: true, runId: sessionState.runId });
});

app.post("/api/control/stop-monitoring", (_req, res) => {
  if (sessionState.monitoringActive && sessionState.monitoringStartedAtMs) {
    sessionState.monitoringElapsedMs = Date.now() - sessionState.monitoringStartedAtMs;
  }
  sessionState.monitoringActive = false;
  sessionState.monitoringStartedAtMs = null;
  sessionState.monitoringStartedIso = null;
  sessionState.stage = SESSION_STAGE_LOBBY;
  pushEvent("info", "Monitoring stopped", { runId: sessionState.runId });
  broadcastProtocolSnapshots();
  publishState();
  res.json({ ok: true });
});

app.post("/api/control/trigger", (req, res) => {
  if (!sessionState.monitoringActive || sessionState.stage !== SESSION_STAGE_MONITORING) {
    res.status(409).json({ error: "monitoring is not active" });
    return;
  }

  const triggerSpec = triggerSpecFromControlPayload(req.body);
  if (!triggerSpec) {
    res.status(400).json({ error: "invalid trigger payload" });
    return;
  }

  const rawTriggerSensorNanos = req.body?.triggerSensorNanos;
  let triggerSensorNanos = Number(rawTriggerSensorNanos);
  if (rawTriggerSensorNanos === null || rawTriggerSensorNanos === undefined || !Number.isFinite(triggerSensorNanos)) {
    triggerSensorNanos = nowHostSensorNanos();
  }
  triggerSensorNanos = Math.trunc(triggerSensorNanos);

  if (!applyTriggerToHostTimeline(triggerSpec, triggerSensorNanos)) {
    res.status(409).json({ error: "trigger rejected by timeline state" });
    return;
  }

  pushEvent("info", `Operator trigger fired: ${triggerLabelForSpec(triggerSpec)}`, {
    triggerType: triggerSpec.triggerType,
    splitIndex: triggerSpec.splitIndex,
    triggerSensorNanos,
  });
  broadcastProtocolTrigger(triggerSpec.triggerType, triggerSensorNanos, triggerSpec.splitIndex);
  broadcastTimelineSnapshot();
  broadcastProtocolSnapshots();
  publishState();
  res.json({
    ok: true,
    triggerType: triggerSpec.triggerType,
    splitIndex: triggerSpec.splitIndex,
    triggerSensorNanos,
  });
});

app.post("/api/control/reset-run", (_req, res) => {
  resetRunData();
  sessionState.monitoringElapsedMs = 0;
  sessionState.runId = sessionState.monitoringActive ? `run-${Date.now()}` : null;
  sessionState.hostStartSensorNanos = null;
  sessionState.hostStopSensorNanos = null;
  sessionState.hostSplitMarks = [];
  pushEvent("info", "Run reset");
  broadcastProtocolSnapshots();
  broadcastTimelineSnapshot();
  publishState();
  res.json({ ok: true });
});

app.post("/api/control/return-setup", (_req, res) => {
  sessionState.stage = SESSION_STAGE_SETUP;
  sessionState.monitoringActive = false;
  sessionState.monitoringStartedAtMs = null;
  sessionState.monitoringStartedIso = null;
  sessionState.monitoringElapsedMs = 0;
  sessionState.runId = null;
  sessionState.hostStartSensorNanos = null;
  sessionState.hostStopSensorNanos = null;
  sessionState.hostSplitMarks = [];
  pushEvent("info", "Session returned to setup");
  broadcastProtocolSnapshots();
  broadcastTimelineSnapshot();
  publishState();
  res.json({ ok: true });
});

app.post("/api/control/assign-role", (req, res) => {
  const targetId = String(req.body?.targetId ?? "").trim();
  const rawRole = String(req.body?.role ?? "").trim();
  const role = ROLE_ORDER.find((candidateRole) => candidateRole === rawRole);

  if (!targetId) {
    res.status(400).json({ error: "targetId is required" });
    return;
  }

  if (!role) {
    res.status(400).json({ error: "invalid role" });
    return;
  }

  const availableRoles = computeRoleOptions();
  const currentlyAssigned = sessionState.roleAssignments[targetId] ?? "Unassigned";
  if (!availableRoles.includes(role) && role !== currentlyAssigned) {
    res.status(400).json({ error: "invalid role" });
    return;
  }

  if (role !== "Unassigned") {
    for (const [assignedTargetId, assignedRole] of Object.entries(sessionState.roleAssignments)) {
      if (assignedTargetId !== targetId && assignedRole === role) {
        delete sessionState.roleAssignments[assignedTargetId];
      }
    }
  }

  if (role === "Unassigned") {
    delete sessionState.roleAssignments[targetId];
  } else {
    sessionState.roleAssignments[targetId] = role;
    applyDefaultDistanceForRole(targetId, role);
  }

  pushEvent("info", `Role assigned: ${targetId} -> ${role}`);
  broadcastProtocolSnapshots();
  publishState();
  res.json({ ok: true });
});

app.post("/api/control/device-config", (req, res) => {
  const targetIdRaw = String(req.body?.targetId ?? "").trim();
  if (!targetIdRaw) {
    res.status(400).json({ error: "targetId is required" });
    return;
  }

  const targetId = canonicalTargetId(targetIdRaw);
  const hasSensitivity = Object.prototype.hasOwnProperty.call(req.body ?? {}, "sensitivity");
  const hasCameraFacing = Object.prototype.hasOwnProperty.call(req.body ?? {}, "cameraFacing");
  const hasDistanceMeters = Object.prototype.hasOwnProperty.call(req.body ?? {}, "distanceMeters");
  if (!hasSensitivity && !hasCameraFacing && !hasDistanceMeters) {
    res.status(400).json({ error: "at least one of sensitivity, cameraFacing, or distanceMeters is required" });
    return;
  }

  let nextSensitivity: number | null = null;
  if (hasSensitivity) {
    const parsedSensitivity = Number(req.body?.sensitivity);
    if (!Number.isInteger(parsedSensitivity) || parsedSensitivity < 1 || parsedSensitivity > 100) {
      res.status(400).json({ error: "sensitivity must be an integer in the range 1..100" });
      return;
    }
    nextSensitivity = parsedSensitivity;
    sessionState.deviceSensitivityAssignments[targetId] = parsedSensitivity;
  }

  let nextCameraFacing: CameraFacing | null = null;
  if (hasCameraFacing) {
    nextCameraFacing = normalizeCameraFacing(req.body?.cameraFacing);
    if (!nextCameraFacing) {
      res.status(400).json({ error: "cameraFacing must be rear or front" });
      return;
    }
    sessionState.deviceCameraFacingAssignments[targetId] = nextCameraFacing;
  }

  let nextDistanceMeters: number | null = null;
  let nextDistanceMetersProvided = false;
  if (hasDistanceMeters) {
    const parsedDistanceMeters = normalizeDistanceMeters(req.body?.distanceMeters);
    if (parsedDistanceMeters === null) {
      res.status(400).json({ error: "distanceMeters must be a number in the range 0..100000" });
      return;
    }
    nextDistanceMeters = parsedDistanceMeters;
    nextDistanceMetersProvided = true;
    sessionState.deviceDistanceAssignments[targetId] = parsedDistanceMeters;
  }

  const endpointIds = resolveEndpointIdsForTargetId(targetId);
  for (const endpointId of endpointIds) {
    const client = clientsByEndpoint.get(endpointId);
    if (nextCameraFacing) {
      upsertClient(endpointId, { cameraFacing: nextCameraFacing });
    }
    if (nextSensitivity !== null) {
      const targetStableDeviceId = client?.stableDeviceId || endpointId;
      sendDeviceConfigUpdateToEndpoint(endpointId, targetStableDeviceId, nextSensitivity);
      upsertClient(endpointId, { telemetrySensitivity: nextSensitivity });
    }
    if (nextDistanceMetersProvided) {
      upsertClient(endpointId, { distanceMeters: nextDistanceMeters });
    }
  }

  pushEvent("info", `Device config updated: ${targetId}`, {
    targetId,
    sensitivity: nextSensitivity,
    cameraFacing: nextCameraFacing,
    distanceMeters: nextDistanceMetersProvided ? nextDistanceMeters : null,
    endpointCount: endpointIds.length,
  });
  broadcastProtocolSnapshots();
  publishState();
  res.json({
    ok: true,
    targetId,
    sensitivity: nextSensitivity,
    cameraFacing: nextCameraFacing,
    distanceMeters: nextDistanceMetersProvided ? nextDistanceMeters : null,
    endpointCount: endpointIds.length,
  });
});

app.post("/api/control/resync-device", (req, res) => {
  const targetIdRaw = String(req.body?.targetId ?? "").trim();
  if (!targetIdRaw) {
    res.status(400).json({ error: "targetId is required" });
    return;
  }

  const sampleCountRaw = req.body?.sampleCount;
  let sampleCount = CLOCK_RESYNC_DEFAULT_SAMPLE_COUNT;
  if (sampleCountRaw !== null && sampleCountRaw !== undefined) {
    const parsedSampleCount = normalizeClockResyncSampleCount(sampleCountRaw);
    if (parsedSampleCount === null) {
      res.status(400).json({
        error: `sampleCount must be an integer in the range ${CLOCK_RESYNC_MIN_SAMPLE_COUNT}..${CLOCK_RESYNC_MAX_SAMPLE_COUNT}`,
      });
      return;
    }
    sampleCount = parsedSampleCount;
  }

  const targetId = canonicalTargetId(targetIdRaw);
  const endpointIds = resolveEndpointIdsForTargetId(targetId);
  if (endpointIds.length === 0) {
    res.status(404).json({ error: `no connected endpoint for targetId ${targetId}` });
    return;
  }

  let dispatchedCount = 0;
  for (const endpointId of endpointIds) {
    if (startClockResyncLoopForEndpoint(endpointId, sampleCount, CLOCK_RESYNC_TARGET_LATENCY_MS)) {
      dispatchedCount += 1;
    }
  }

  if (dispatchedCount === 0) {
    res.status(502).json({ error: `failed to dispatch resync request for targetId ${targetId}` });
    return;
  }

  pushEvent("info", `Clock resync requested: ${targetId}`, {
    targetId,
    sampleCount,
    targetLatencyMs: CLOCK_RESYNC_TARGET_LATENCY_MS,
    endpointCount: endpointIds.length,
    dispatchedCount,
  });
  broadcastProtocolSnapshots();
  publishState();
  res.json({
    ok: true,
    targetId,
    sampleCount,
    targetLatencyMs: CLOCK_RESYNC_TARGET_LATENCY_MS,
    endpointCount: endpointIds.length,
    dispatchedCount,
  });
});

app.post("/api/control/save-results", async (req, res) => {
  try {
    const snapshot = createSnapshot();
    const exportTimestampIso = new Date().toISOString();
    const athleteName = normalizeAthleteNameForResult(req.body?.athleteName);
    const notes = String(req.body?.notes ?? "").trim().slice(0, 240);
    const requestedName = String(req.body?.name ?? "").trim();
    const athleteDateName =
      athleteName !== null ? `${athleteName}_${formatDateForResultName(exportTimestampIso)}` : "";
    const runSegment = sanitizeFileNameSegment(
      requestedName || athleteDateName || snapshot.session.runId || `run_${Date.now()}`,
    );
    const timestampSegment = exportTimestampIso.replace(/[:.]/g, "-");
    const fileName = `${runSegment}_${timestampSegment}.json`;
    const filePath = path.join(config.resultsDir, fileName);

    const exportPayload = {
      type: "windows_results_export",
      resultName: runSegment,
      athleteName,
      notes: notes || null,
      namingFormat: "athlete_dd_MM_yyyy",
      exportedAtIso: exportTimestampIso,
      exportedAtMs: Date.now(),
      runId: snapshot.session.runId,
      session: snapshot.session,
      clients: snapshot.clients,
      latestLapResults: snapshot.latestLapResults,
      lapHistory: snapshot.lapHistory,
      recentEvents: snapshot.recentEvents,
    };

    await fs.mkdir(config.resultsDir, { recursive: true });
    await fs.writeFile(filePath, `${JSON.stringify(exportPayload, null, 2)}\n`, "utf8");

    sessionState.lastSavedResultsFilePath = filePath;
    sessionState.lastSavedResultsAtIso = exportTimestampIso;
    pushEvent("info", `Results saved to ${filePath}`);
    publishState();

    res.json({
      ok: true,
      filePath,
      fileName,
      resultName: runSegment,
      athleteName,
      notes: notes || null,
      savedAtIso: exportTimestampIso,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown save error";
    pushEvent("error", `Failed to save results: ${message}`);
    publishState();
    res.status(500).json({ error: message });
  }
});

app.get("/api/results", async (_req, res) => {
  try {
    const items = await listSavedResultItems(config.resultsDir);
    res.json({ ok: true, items });
  } catch (error) {
    const message = error instanceof Error ? error.message : "failed to list results";
    res.status(500).json({ error: message });
  }
});

app.get("/api/results/:fileName", async (req, res) => {
  const fileName = String(req.params?.fileName ?? "").trim();
  if (!isSafeSavedResultsFileName(fileName)) {
    res.status(400).json({ error: "invalid file name" });
    return;
  }

  try {
    const loaded = await loadSavedResultsFile(config.resultsDir, fileName);
    if (!loaded) {
      res.status(404).json({ error: "saved result not found" });
      return;
    }
    res.json({ ok: true, ...loaded });
  } catch (error) {
    const message = error instanceof Error ? error.message : "failed to load saved result";
    res.status(500).json({ error: message });
  }
});

app.post("/api/control/clear-events", (_req, res) => {
  recentEvents.length = 0;
  pushEvent("info", "Operator cleared event log");
  publishState();
  res.json({ ok: true });
});

if (frontendBundleAvailable) {
  app.use(express.static(config.frontendDistDir));
}

app.use((req, res) => {
  if (frontendBundleAvailable && isFrontendRouteRequest(req)) {
    res.sendFile(frontendIndexPath);
    return;
  }

  res.status(404).json({ error: "Not found" });
});

const httpServer = createHttpServer(app);
websocketServer = new WebSocketServer({ server: httpServer, path: "/ws" });

websocketServer.on("error", (error) => {
  pushEvent("error", `WebSocket server error: ${error.message}`);
  publishState();
});

websocketServer.on("connection", (socket) => {
  sendSocketMessage(socket, {
    type: "snapshot",
    payload: createSnapshot(),
  });
});

const tcpServer = net.createServer((socket) => {
  const endpointId = `${socket.remoteAddress ?? "unknown"}:${socket.remotePort ?? 0}`;
  socket.setNoDelay(true);

  socketsByEndpoint.set(endpointId, {
    endpointId,
    socket,
    buffer: Buffer.alloc(0),
  });

  upsertClient(endpointId, {
    endpointId,
    remoteAddress: socket.remoteAddress ?? "unknown",
    remotePort: socket.remotePort ?? 0,
    connectedAtIso: new Date().toISOString(),
    lastSeenAtIso: new Date().toISOString(),
    stableDeviceId: null,
    deviceName: null,
  });

  autoAssignRoleForNewJoin(endpointId);

  pushEvent("info", `TCP client connected: ${endpointId}`, { endpointId });
  sendProtocolSnapshotToEndpoint(endpointId);
  publishState();

  socket.on("data", (chunk) => {
    handleSocketData(endpointId, chunk);
  });

  socket.on("error", (error) => {
    pushEvent("warn", `Socket error from ${endpointId}: ${error.message}`, { endpointId });
    publishState();
  });

  socket.on("close", () => {
    const client = clientsByEndpoint.get(endpointId);
    const stableId = client?.stableDeviceId;
    stopClockResyncLoopForEndpoint(endpointId);
    socketsByEndpoint.delete(endpointId);
    clientsByEndpoint.delete(endpointId);
    if (!stableId) {
      delete sessionState.roleAssignments[endpointId];
      delete sessionState.deviceSensitivityAssignments[endpointId];
      delete sessionState.deviceCameraFacingAssignments[endpointId];
      delete sessionState.deviceDistanceAssignments[endpointId];
    }
    pushEvent("info", `TCP client disconnected: ${endpointId}`, { endpointId });
    broadcastProtocolSnapshots();
    publishState();
  });
});

tcpServer.on("error", (error) => {
  pushEvent("error", `TCP server error: ${error.message}`);
  publishState();
});

httpServer.on("error", (error) => {
  pushEvent("error", `HTTP server error: ${error.message}`);
  publishState();
});

tcpServer.listen(config.tcpPort, config.tcpHost, () => {
  pushEvent("info", `TCP server listening on ${config.tcpHost}:${config.tcpPort}`);
  publishState();
});

httpServer.listen(config.httpPort, config.httpHost, () => {
  pushEvent("info", `HTTP server listening on ${config.httpHost}:${config.httpPort}`);
  if (frontendBundleAvailable) {
    pushEvent("info", `Serving frontend from ${config.frontendDistDir}`);
  } else {
    pushEvent("info", "Frontend bundle not found; API-only mode enabled");
  }
  publishState();
});

const shutdownSignals: NodeJS.Signals[] = ["SIGINT", "SIGTERM"];
for (const signal of shutdownSignals) {
  process.on(signal, () => {
    shutdown(signal);
  });
}

function toPort(value: unknown, fallback: number): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
    return fallback;
  }
  return parsed;
}

function isFrontendRouteRequest(req: { method: string; path: string }): boolean {
  return (
    (req.method === "GET" || req.method === "HEAD") &&
    !req.path.startsWith("/api") &&
    req.path !== "/ws"
  );
}

function appendBounded<T>(array: T[], value: T, maxSize: number): void {
  array.push(value);
  if (array.length > maxSize) {
    array.splice(0, array.length - maxSize);
  }
}

function safeParseJson(raw: string): unknown | null {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function upsertClient(endpointId: string, patch: Partial<ClientState>): void {
  const existing = clientsByEndpoint.get(endpointId) ?? {
    endpointId,
    remoteAddress: "unknown",
    remotePort: 0,
    connectedAtIso: new Date().toISOString(),
    lastSeenAtIso: new Date().toISOString(),
    stableDeviceId: null,
    deviceName: null,
    cameraFacing: "rear",
    distanceMeters: null,
    telemetrySensitivity: 100,
    telemetryLatencyMs: null,
    telemetryClockSynced: false,
    telemetryAnalysisWidth: null,
    telemetryAnalysisHeight: null,
    telemetryTimestampMillis: null,
  };
  clientsByEndpoint.set(endpointId, { ...existing, ...patch });
}

function incrementMessageType(typeName: string): void {
  const current = messageStats.knownTypes[typeName] ?? 0;
  messageStats.knownTypes[typeName] = current + 1;
}

function handleSocketData(endpointId: string, chunk: Buffer): void {
  const context = socketsByEndpoint.get(endpointId);
  if (!context) {
    return;
  }

  context.buffer = Buffer.concat([context.buffer, chunk]);
  upsertClient(endpointId, { lastSeenAtIso: new Date().toISOString() });

  while (context.buffer.length >= 5) {
    const frameKind = context.buffer.readUInt8(0);
    const frameLength = context.buffer.readInt32BE(1);
    if (frameLength <= 0 || frameLength > MAX_FRAME_BYTES) {
      messageStats.parseErrors += 1;
      pushEvent("warn", `Dropping client ${endpointId}: invalid frame length ${frameLength}`, {
        endpointId,
      });
      context.socket.destroy();
      publishState();
      return;
    }

    const frameTotalSize = 5 + frameLength;
    if (context.buffer.length < frameTotalSize) {
      break;
    }

    const payload = Buffer.from(context.buffer.subarray(5, frameTotalSize));
    context.buffer = Buffer.from(context.buffer.subarray(frameTotalSize));

    messageStats.totalFrames += 1;

    if (frameKind === FRAME_KIND_MESSAGE) {
      messageStats.messageFrames += 1;
      handleMessageFrame(endpointId, payload);
      continue;
    }

    if (frameKind === FRAME_KIND_BINARY) {
      messageStats.binaryFrames += 1;
      handleBinaryFrame(endpointId, payload);
      continue;
    }

    if (frameKind === FRAME_KIND_TELEMETRY_BINARY) {
      messageStats.binaryFrames += 1;
      handleTelemetryBinaryFrame(endpointId, payload);
      continue;
    }

    messageStats.parseErrors += 1;
    pushEvent("warn", `Unsupported frame kind ${frameKind} from ${endpointId}`, { endpointId });
  }

  publishState();
}

function handleMessageFrame(endpointId: string, payload: Buffer): void {
  const rawMessage = payload.toString("utf8");
  const decoded = safeParseJson(rawMessage);
  if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) {
    messageStats.parseErrors += 1;
    pushEvent("warn", `Non-JSON message from ${endpointId}`, {
      endpointId,
      preview: rawMessage.slice(0, 120),
    });
    return;
  }

  const message = decoded as UnknownRecord;

  const messageType = typeof message.type === "string" ? message.type : "unknown";
  incrementMessageType(messageType);

  if (messageType === "device_identity") {
    handleDeviceIdentity(endpointId, message);
    return;
  }

  if (messageType === "lap_result") {
    handleLapResult(endpointId, message);
    return;
  }

  if (messageType === "device_telemetry") {
    handleDeviceTelemetry(endpointId, message);
    return;
  }

  if (messageType === "trigger_request") {
    handleTriggerRequest(endpointId, message);
    return;
  }

  if (messageType === "session_trigger") {
    handleSessionTrigger(endpointId, message);
    return;
  }

  if (messageType === "trigger_refinement") {
    handleTriggerRefinement(endpointId, message);
    return;
  }
}

function handleBinaryFrame(endpointId: string, payload: Buffer): void {
  if (payload.length < 2) {
    clockDomainState.ignoredFrames += 1;
    messageStats.parseErrors += 1;
    return;
  }

  const version = payload.readUInt8(0);
  if (version !== CLOCK_SYNC_VERSION) {
    clockDomainState.ignoredFrames += 1;
    return;
  }

  const payloadType = payload.readUInt8(1);
  if (payloadType === CLOCK_SYNC_TYPE_REQUEST) {
    handleClockSyncRequest(endpointId, payload);
    return;
  }

  // RESPONSE frames are expected from host to client, not the other way around.
  clockDomainState.ignoredFrames += 1;
}

function handleTelemetryBinaryFrame(endpointId: string, payload: Buffer): void {
  const decoded = decodeTelemetryEnvelope(payload);
  if (!decoded) {
    messageStats.parseErrors += 1;
    pushEvent("warn", `Invalid telemetry envelope from ${endpointId}`, { endpointId });
    return;
  }

  if (decoded.type === "trigger_request") {
    incrementMessageType("telemetry_trigger_request");
    handleTriggerRequest(endpointId, decoded.message);
    return;
  }

  if (decoded.type === "session_trigger") {
    incrementMessageType("telemetry_session_trigger");
    handleSessionTrigger(endpointId, decoded.message);
    return;
  }

  if (decoded.type === "timeline_snapshot") {
    // Windows backend is authoritative for timeline state in this mode.
    incrementMessageType("telemetry_timeline_snapshot");
    return;
  }

  if (decoded.type === "device_identity") {
    incrementMessageType("telemetry_device_identity");
    handleDeviceIdentity(endpointId, decoded.message);
    return;
  }

  if (decoded.type === "device_telemetry") {
    incrementMessageType("telemetry_device_telemetry");
    handleDeviceTelemetry(endpointId, decoded.message);
    return;
  }

  if (decoded.type === "lap_result") {
    incrementMessageType("telemetry_lap_result");
    handleLapResult(endpointId, decoded.message);
    return;
  }

  messageStats.parseErrors += 1;
  pushEvent("warn", `Unsupported telemetry payload from ${endpointId}`, { endpointId });
}

function decodeTelemetryEnvelope(payload: Buffer): TelemetryEnvelopeDecoded | null {
  try {
    const rootTableAddress = readFlatBufferRootTableAddress(payload);
    if (rootTableAddress === null) {
      return null;
    }

    const payloadTypeAddress = readFlatBufferFieldAddress(payload, rootTableAddress, 0);
    const payloadAddressField = readFlatBufferFieldAddress(payload, rootTableAddress, 1);
    if (payloadTypeAddress === null || payloadAddressField === null || payloadTypeAddress + 1 > payload.length) {
      return null;
    }

    const payloadType = payload.readUInt8(payloadTypeAddress);
    const payloadTableAddress = readFlatBufferUOffsetTarget(payload, payloadAddressField);
    if (payloadTableAddress === null) {
      return null;
    }

    if (payloadType === TELEMETRY_PAYLOAD_SESSION_TRIGGER_REQUEST) {
      const message = decodeTelemetryTriggerRequest(payload, payloadTableAddress);
      return message ? { type: "trigger_request", message } : null;
    }

    if (payloadType === TELEMETRY_PAYLOAD_SESSION_TRIGGER) {
      const message = decodeTelemetrySessionTrigger(payload, payloadTableAddress);
      return message ? { type: "session_trigger", message } : null;
    }

    if (payloadType === TELEMETRY_PAYLOAD_SESSION_TIMELINE_SNAPSHOT) {
      const message = decodeTelemetryTimelineSnapshot(payload, payloadTableAddress);
      return message ? { type: "timeline_snapshot", message } : null;
    }

    if (payloadType === TELEMETRY_PAYLOAD_DEVICE_IDENTITY) {
      const message = decodeTelemetryDeviceIdentity(payload, payloadTableAddress);
      return message ? { type: "device_identity", message } : null;
    }

    if (payloadType === TELEMETRY_PAYLOAD_DEVICE_TELEMETRY) {
      const message = decodeTelemetryDeviceTelemetry(payload, payloadTableAddress);
      return message ? { type: "device_telemetry", message } : null;
    }

    if (payloadType === TELEMETRY_PAYLOAD_LAP_RESULT) {
      const message = decodeTelemetryLapResult(payload, payloadTableAddress);
      return message ? { type: "lap_result", message } : null;
    }

    return null;
  } catch {
    return null;
  }
}

function decodeTelemetryTriggerRequest(
  payload: Buffer,
  tableAddress: number,
): TelemetryTriggerRequestMessage | null {
  const roleAddress = readFlatBufferFieldAddress(payload, tableAddress, 0);
  const triggerSensorNanosAddress = readFlatBufferFieldAddress(payload, tableAddress, 1);
  const mappedHostSensorNanosAddress = readFlatBufferFieldAddress(payload, tableAddress, 2);
  const sourceDeviceIdAddress = readFlatBufferFieldAddress(payload, tableAddress, 3);
  const sourceElapsedNanosAddress = readFlatBufferFieldAddress(payload, tableAddress, 4);
  const mappedAnchorElapsedNanosAddress = readFlatBufferFieldAddress(payload, tableAddress, 5);

  if (roleAddress === null || triggerSensorNanosAddress === null || sourceDeviceIdAddress === null) {
    return null;
  }
  if (roleAddress + 1 > payload.length || triggerSensorNanosAddress + 8 > payload.length) {
    return null;
  }

  const role = telemetryRoleByteToWireRole(payload.readUInt8(roleAddress));
  const triggerSensorNanos = readFlatBufferInt64AsNumber(payload, triggerSensorNanosAddress);
  const sourceDeviceId = readFlatBufferString(payload, sourceDeviceIdAddress);
  const sourceElapsedNanos =
    sourceElapsedNanosAddress === null ? 0 : readFlatBufferInt64AsNumber(payload, sourceElapsedNanosAddress);
  if (!sourceDeviceId || !Number.isFinite(triggerSensorNanos) || !Number.isFinite(sourceElapsedNanos)) {
    return null;
  }

  const mappedHostSensorNanos = readOptionalInt64(
    payload,
    mappedHostSensorNanosAddress,
    TELEMETRY_MISSING_OPTIONAL_LONG,
  );
  const mappedAnchorElapsedNanos = readOptionalInt64(
    payload,
    mappedAnchorElapsedNanosAddress,
    TELEMETRY_MISSING_OPTIONAL_LONG,
  );

  return {
    role,
    triggerSensorNanos,
    mappedHostSensorNanos,
    sourceDeviceId,
    sourceElapsedNanos,
    mappedAnchorElapsedNanos,
  };
}

function decodeTelemetrySessionTrigger(
  payload: Buffer,
  tableAddress: number,
): TelemetrySessionTriggerMessage | null {
  const triggerTypeAddress = readFlatBufferFieldAddress(payload, tableAddress, 0);
  const splitIndexAddress = readFlatBufferFieldAddress(payload, tableAddress, 1);
  const triggerSensorNanosAddress = readFlatBufferFieldAddress(payload, tableAddress, 2);
  if (triggerTypeAddress === null || triggerSensorNanosAddress === null) {
    return null;
  }

  const triggerType = readFlatBufferString(payload, triggerTypeAddress);
  const triggerSensorNanos = readFlatBufferInt64AsNumber(payload, triggerSensorNanosAddress);
  if (!triggerType || !Number.isFinite(triggerSensorNanos)) {
    return null;
  }

  let splitIndex: number | null = null;
  if (splitIndexAddress !== null) {
    if (splitIndexAddress + 4 > payload.length) {
      return null;
    }
    const decodedSplitIndex = payload.readInt32LE(splitIndexAddress);
    splitIndex = decodedSplitIndex === TELEMETRY_MISSING_OPTIONAL_INT ? null : decodedSplitIndex;
  }

  return {
    triggerType,
    splitIndex,
    triggerSensorNanos,
  };
}

function decodeTelemetryTimelineSnapshot(
  payload: Buffer,
  tableAddress: number,
): TelemetryTimelineSnapshotMessage | null {
  const startAddress = readFlatBufferFieldAddress(payload, tableAddress, 0);
  const stopAddress = readFlatBufferFieldAddress(payload, tableAddress, 1);
  const splitMarksVectorAddress = readFlatBufferFieldAddress(payload, tableAddress, 2);
  const sentElapsedAddress = readFlatBufferFieldAddress(payload, tableAddress, 3);

  const hostStartSensorNanos = readOptionalInt64(payload, startAddress, TELEMETRY_MISSING_OPTIONAL_LONG);
  const hostStopSensorNanos = readOptionalInt64(payload, stopAddress, TELEMETRY_MISSING_OPTIONAL_LONG);
  const sentElapsedNanos = sentElapsedAddress === null ? 0 : readFlatBufferInt64AsNumber(payload, sentElapsedAddress);
  if (!Number.isFinite(sentElapsedNanos)) {
    return null;
  }

  const hostSplitMarks: Array<{ role: string; hostSensorNanos: number }> = [];
  if (splitMarksVectorAddress !== null) {
    const vectorAddress = readFlatBufferUOffsetTarget(payload, splitMarksVectorAddress);
    if (vectorAddress === null || vectorAddress + 4 > payload.length) {
      return null;
    }
    const vectorLength = payload.readUInt32LE(vectorAddress);
    for (let index = 0; index < vectorLength; index += 1) {
      const elementOffsetAddress = vectorAddress + 4 + index * 4;
      const splitMarkTableAddress = readFlatBufferUOffsetTarget(payload, elementOffsetAddress);
      if (splitMarkTableAddress === null) {
        continue;
      }

      const roleAddress = readFlatBufferFieldAddress(payload, splitMarkTableAddress, 0);
      const sensorAddress = readFlatBufferFieldAddress(payload, splitMarkTableAddress, 1);
      if (roleAddress === null || sensorAddress === null || roleAddress + 1 > payload.length) {
        continue;
      }
      const role = telemetryRoleByteToWireRole(payload.readUInt8(roleAddress));
      const hostSensorNanos = readFlatBufferInt64AsNumber(payload, sensorAddress);
      if (!Number.isFinite(hostSensorNanos)) {
        continue;
      }
      hostSplitMarks.push({ role, hostSensorNanos });
    }
  }

  return {
    hostStartSensorNanos,
    hostStopSensorNanos,
    hostSplitMarks,
    sentElapsedNanos,
  };
}

function decodeTelemetryDeviceIdentity(
  payload: Buffer,
  tableAddress: number,
): TelemetryDeviceIdentityMessage | null {
  const stableDeviceIdAddress = readFlatBufferFieldAddress(payload, tableAddress, 0);
  const deviceNameAddress = readFlatBufferFieldAddress(payload, tableAddress, 1);
  if (stableDeviceIdAddress === null || deviceNameAddress === null) {
    return null;
  }

  const stableDeviceId = String(readFlatBufferString(payload, stableDeviceIdAddress) ?? "").trim();
  const deviceName = String(readFlatBufferString(payload, deviceNameAddress) ?? "").trim();
  if (!stableDeviceId || !deviceName) {
    return null;
  }

  return {
    stableDeviceId,
    deviceName,
  };
}

function decodeTelemetryDeviceTelemetry(
  payload: Buffer,
  tableAddress: number,
): TelemetryDeviceTelemetryMessage | null {
  const stableDeviceIdAddress = readFlatBufferFieldAddress(payload, tableAddress, 0);
  const roleAddress = readFlatBufferFieldAddress(payload, tableAddress, 1);
  const sensitivityAddress = readFlatBufferFieldAddress(payload, tableAddress, 2);
  const latencyMsAddress = readFlatBufferFieldAddress(payload, tableAddress, 3);
  const clockSyncedAddress = readFlatBufferFieldAddress(payload, tableAddress, 4);
  const analysisWidthAddress = readFlatBufferFieldAddress(payload, tableAddress, 5);
  const analysisHeightAddress = readFlatBufferFieldAddress(payload, tableAddress, 6);
  const timestampMillisAddress = readFlatBufferFieldAddress(payload, tableAddress, 7);

  if (
    stableDeviceIdAddress === null ||
    roleAddress === null ||
    sensitivityAddress === null ||
    clockSyncedAddress === null ||
    timestampMillisAddress === null
  ) {
    return null;
  }
  if (roleAddress + 1 > payload.length || clockSyncedAddress + 1 > payload.length) {
    return null;
  }

  const stableDeviceId = String(readFlatBufferString(payload, stableDeviceIdAddress) ?? "").trim();
  const role = telemetryRoleByteToWireRole(payload.readUInt8(roleAddress));
  const sensitivity = readFlatBufferInt32(payload, sensitivityAddress);
  const latencyMs = readOptionalInt32(payload, latencyMsAddress, TELEMETRY_MISSING_OPTIONAL_INT);
  const analysisWidth = readOptionalInt32(payload, analysisWidthAddress, TELEMETRY_MISSING_OPTIONAL_INT);
  const analysisHeight = readOptionalInt32(payload, analysisHeightAddress, TELEMETRY_MISSING_OPTIONAL_INT);
  const timestampMillis = readFlatBufferInt64AsNumber(payload, timestampMillisAddress);
  const clockSynced = payload.readUInt8(clockSyncedAddress) !== 0;

  if (!stableDeviceId || !Number.isInteger(sensitivity) || sensitivity < 1 || sensitivity > 100) {
    return null;
  }
  if (latencyMs !== null && (!Number.isInteger(latencyMs) || latencyMs < 0)) {
    return null;
  }
  if ((analysisWidth === null) !== (analysisHeight === null)) {
    return null;
  }
  if (analysisWidth !== null && analysisHeight !== null) {
    if (!Number.isInteger(analysisWidth) || !Number.isInteger(analysisHeight) || analysisWidth <= 0 || analysisHeight <= 0) {
      return null;
    }
  }
  if (!Number.isFinite(timestampMillis) || timestampMillis <= 0) {
    return null;
  }

  return {
    stableDeviceId,
    role,
    sensitivity,
    latencyMs,
    clockSynced,
    analysisWidth,
    analysisHeight,
    timestampMillis,
  };
}

function decodeTelemetryLapResult(
  payload: Buffer,
  tableAddress: number,
): TelemetryLapResultMessage | null {
  const senderDeviceNameAddress = readFlatBufferFieldAddress(payload, tableAddress, 0);
  const startedSensorNanosAddress = readFlatBufferFieldAddress(payload, tableAddress, 1);
  const stoppedSensorNanosAddress = readFlatBufferFieldAddress(payload, tableAddress, 2);
  if (senderDeviceNameAddress === null || startedSensorNanosAddress === null || stoppedSensorNanosAddress === null) {
    return null;
  }

  const senderDeviceName = String(readFlatBufferString(payload, senderDeviceNameAddress) ?? "").trim();
  const startedSensorNanos = readFlatBufferInt64AsNumber(payload, startedSensorNanosAddress);
  const stoppedSensorNanos = readFlatBufferInt64AsNumber(payload, stoppedSensorNanosAddress);
  if (
    !senderDeviceName ||
    !Number.isFinite(startedSensorNanos) ||
    !Number.isFinite(stoppedSensorNanos) ||
    stoppedSensorNanos <= startedSensorNanos
  ) {
    return null;
  }

  return {
    senderDeviceName,
    startedSensorNanos,
    stoppedSensorNanos,
  };
}

function readOptionalInt64(payload: Buffer, fieldAddress: number | null, missingValue: bigint): number | null {
  if (fieldAddress === null) {
    return null;
  }
  if (fieldAddress + 8 > payload.length) {
    return null;
  }
  const value = payload.readBigInt64LE(fieldAddress);
  if (value === missingValue) {
    return null;
  }
  return safeInt64ToNumber(value);
}

function readOptionalInt32(payload: Buffer, fieldAddress: number | null, missingValue: number): number | null {
  if (fieldAddress === null) {
    return null;
  }
  const value = readFlatBufferInt32(payload, fieldAddress);
  if (!Number.isFinite(value)) {
    return null;
  }
  if (value === missingValue) {
    return null;
  }
  return value;
}

function readFlatBufferRootTableAddress(payload: Buffer): number | null {
  if (payload.length < 4) {
    return null;
  }
  const rootAddress = payload.readUInt32LE(0);
  if (rootAddress < 0 || rootAddress >= payload.length) {
    return null;
  }
  return rootAddress;
}

function readFlatBufferFieldAddress(payload: Buffer, tableAddress: number, fieldIndex: number): number | null {
  if (tableAddress + 4 > payload.length) {
    return null;
  }
  const vtableOffset = payload.readInt32LE(tableAddress);
  const vtableAddress = tableAddress - vtableOffset;
  if (vtableAddress < 0 || vtableAddress + 4 > payload.length) {
    return null;
  }
  const vtableLength = payload.readUInt16LE(vtableAddress);
  const fieldOffsetAddress = vtableAddress + 4 + fieldIndex * 2;
  if (fieldOffsetAddress + 2 > vtableAddress + vtableLength || fieldOffsetAddress + 2 > payload.length) {
    return null;
  }
  const fieldOffset = payload.readUInt16LE(fieldOffsetAddress);
  if (fieldOffset === 0) {
    return null;
  }
  const fieldAddress = tableAddress + fieldOffset;
  if (fieldAddress < 0 || fieldAddress >= payload.length) {
    return null;
  }
  return fieldAddress;
}

function readFlatBufferUOffsetTarget(payload: Buffer, offsetAddress: number): number | null {
  if (offsetAddress + 4 > payload.length) {
    return null;
  }
  const relativeOffset = payload.readUInt32LE(offsetAddress);
  const targetAddress = offsetAddress + relativeOffset;
  if (targetAddress < 0 || targetAddress >= payload.length) {
    return null;
  }
  return targetAddress;
}

function readFlatBufferString(payload: Buffer, offsetAddress: number): string | null {
  const stringAddress = readFlatBufferUOffsetTarget(payload, offsetAddress);
  if (stringAddress === null || stringAddress + 4 > payload.length) {
    return null;
  }
  const length = payload.readUInt32LE(stringAddress);
  const valueStart = stringAddress + 4;
  const valueEnd = valueStart + length;
  if (valueEnd > payload.length) {
    return null;
  }
  return payload.toString("utf8", valueStart, valueEnd);
}

function readFlatBufferInt64AsNumber(payload: Buffer, fieldAddress: number): number {
  if (fieldAddress + 8 > payload.length) {
    return Number.NaN;
  }
  return safeInt64ToNumber(payload.readBigInt64LE(fieldAddress));
}

function readFlatBufferInt32(payload: Buffer, fieldAddress: number): number {
  if (fieldAddress + 4 > payload.length) {
    return Number.NaN;
  }
  return payload.readInt32LE(fieldAddress);
}

function safeInt64ToNumber(value: bigint): number {
  if (value > MAX_SAFE_INT64) {
    return Number.MAX_SAFE_INTEGER;
  }
  if (value < MIN_SAFE_INT64) {
    return Number.MIN_SAFE_INTEGER;
  }
  return Number(value);
}

function telemetryRoleByteToWireRole(roleByte: number): string {
  if (roleByte === 1) {
    return "start";
  }
  if (roleByte === 2) {
    return "split1";
  }
  if (roleByte === 3) {
    return "split2";
  }
  if (roleByte === 4) {
    return "split3";
  }
  if (roleByte === 5) {
    return "split4";
  }
  if (roleByte === 6) {
    return "stop";
  }
  if (roleByte === 7) {
    return "display";
  }
  return "unassigned";
}

function handleClockSyncRequest(endpointId: string, payload: Buffer): void {
  if (payload.length !== CLOCK_SYNC_REQUEST_BYTES) {
    clockDomainState.ignoredFrames += 1;
    messageStats.parseErrors += 1;
    return;
  }

  let clientSendElapsedNanos;
  try {
    clientSendElapsedNanos = payload.readBigInt64BE(2);
  } catch {
    clockDomainState.ignoredFrames += 1;
    messageStats.parseErrors += 1;
    return;
  }

  const hostReceiveElapsedNanos = nowHostElapsedNanos();
  const hostSendElapsedNanos = nowHostElapsedNanos();

  const responsePayload = Buffer.alloc(CLOCK_SYNC_RESPONSE_BYTES);
  responsePayload.writeUInt8(CLOCK_SYNC_VERSION, 0);
  responsePayload.writeUInt8(CLOCK_SYNC_TYPE_RESPONSE, 1);
  responsePayload.writeBigInt64BE(clientSendElapsedNanos, 2);
  responsePayload.writeBigInt64BE(hostReceiveElapsedNanos, 10);
  responsePayload.writeBigInt64BE(hostSendElapsedNanos, 18);

  if (!sendTcpFrame(endpointId, FRAME_KIND_BINARY, responsePayload)) {
    clockDomainState.ignoredFrames += 1;
    return;
  }

  const timestampIso = new Date().toISOString();
  clockDomainState.samplesResponded += 1;
  clockDomainState.lastEndpointId = endpointId;
  clockDomainState.lastRequestAtIso = timestampIso;
  clockDomainState.lastResponseAtIso = timestampIso;
  clockDomainState.lastHostReceiveElapsedNanos = hostReceiveElapsedNanos.toString();
  clockDomainState.lastHostSendElapsedNanos = hostSendElapsedNanos.toString();
}

function nowHostElapsedNanos() {
  return process.hrtime.bigint();
}

function handleDeviceIdentity(endpointId: string, decoded: DeviceIdentityMessage): void {
  const stableDeviceId = String(decoded.stableDeviceId ?? "").trim();
  const deviceName = String(decoded.deviceName ?? "").trim();
  if (!stableDeviceId || !deviceName) {
    messageStats.parseErrors += 1;
    pushEvent("warn", `Invalid device_identity payload from ${endpointId}`, { endpointId });
    return;
  }

  const existing = clientsByEndpoint.get(endpointId);
  if (existing?.stableDeviceId && existing.stableDeviceId !== stableDeviceId) {
    const previousRole = sessionState.roleAssignments[existing.stableDeviceId];
    if (previousRole) {
      sessionState.roleAssignments[stableDeviceId] = previousRole;
      delete sessionState.roleAssignments[existing.stableDeviceId];
    }
    migrateAssignmentKey(sessionState.deviceSensitivityAssignments, existing.stableDeviceId, stableDeviceId);
    migrateAssignmentKey(sessionState.deviceCameraFacingAssignments, existing.stableDeviceId, stableDeviceId);
    migrateAssignmentKey(sessionState.deviceDistanceAssignments, existing.stableDeviceId, stableDeviceId);
  }

  const endpointRole = sessionState.roleAssignments[endpointId];
  if (endpointRole && !sessionState.roleAssignments[stableDeviceId]) {
    sessionState.roleAssignments[stableDeviceId] = endpointRole;
    delete sessionState.roleAssignments[endpointId];
  }
  migrateAssignmentKey(sessionState.deviceSensitivityAssignments, endpointId, stableDeviceId);
  migrateAssignmentKey(sessionState.deviceCameraFacingAssignments, endpointId, stableDeviceId);
  migrateAssignmentKey(sessionState.deviceDistanceAssignments, endpointId, stableDeviceId);

  upsertClient(endpointId, {
    stableDeviceId,
    deviceName,
    lastSeenAtIso: new Date().toISOString(),
  });

  const configuredSensitivity = sessionState.deviceSensitivityAssignments[stableDeviceId];
  if (Number.isInteger(configuredSensitivity) && configuredSensitivity >= 1 && configuredSensitivity <= 100) {
    sendDeviceConfigUpdateToEndpoint(endpointId, stableDeviceId, configuredSensitivity);
    upsertClient(endpointId, { telemetrySensitivity: configuredSensitivity });
  }

  pushEvent("info", `Identity update ${deviceName} (${stableDeviceId})`, {
    endpointId,
    stableDeviceId,
    deviceName,
  });
  broadcastProtocolSnapshots();
}

function handleDeviceTelemetry(endpointId: string, decoded: DeviceTelemetryMessage): void {
  const stableDeviceId = String(decoded.stableDeviceId ?? "").trim();
  const sensitivity = Number(decoded.sensitivity);
  const timestampMillis = Number(decoded.timestampMillis);
  if (!stableDeviceId || !Number.isInteger(sensitivity) || sensitivity < 1 || sensitivity > 100) {
    messageStats.parseErrors += 1;
    return;
  }
  if (!Number.isFinite(timestampMillis) || timestampMillis <= 0) {
    messageStats.parseErrors += 1;
    return;
  }

  let latencyMs: number | null = null;
  if (decoded.latencyMs !== null && decoded.latencyMs !== undefined) {
    const parsedLatency = Number(decoded.latencyMs);
    if (!Number.isInteger(parsedLatency) || parsedLatency < 0) {
      messageStats.parseErrors += 1;
      return;
    }
    latencyMs = parsedLatency;
  }

  let analysisWidth: number | null = null;
  let analysisHeight: number | null = null;
  const hasAnalysisWidth = decoded.analysisWidth !== null && decoded.analysisWidth !== undefined;
  const hasAnalysisHeight = decoded.analysisHeight !== null && decoded.analysisHeight !== undefined;
  if (hasAnalysisWidth || hasAnalysisHeight) {
    const parsedWidth = Number(decoded.analysisWidth);
    const parsedHeight = Number(decoded.analysisHeight);
    if (
      !Number.isInteger(parsedWidth) ||
      !Number.isInteger(parsedHeight) ||
      parsedWidth <= 0 ||
      parsedHeight <= 0
    ) {
      messageStats.parseErrors += 1;
      return;
    }
    analysisWidth = parsedWidth;
    analysisHeight = parsedHeight;
  }

  const existing = clientsByEndpoint.get(endpointId);
  const roleTarget = existing?.stableDeviceId || stableDeviceId;
  const configuredSensitivity =
    sessionState.deviceSensitivityAssignments[roleTarget] ??
    sessionState.deviceSensitivityAssignments[endpointId] ??
    sensitivity;

  upsertClient(endpointId, {
    stableDeviceId,
    telemetrySensitivity: Number.isInteger(configuredSensitivity) ? configuredSensitivity : sensitivity,
    telemetryLatencyMs: latencyMs,
    telemetryClockSynced: Boolean(decoded.clockSynced),
    telemetryAnalysisWidth: analysisWidth,
    telemetryAnalysisHeight: analysisHeight,
    telemetryTimestampMillis: Math.trunc(timestampMillis),
  });

  tryCompleteClockResyncLoop(endpointId, "telemetry");
}

function handleLapResult(endpointId: string, decoded: LapResultMessage): void {
  const senderDeviceName = String(decoded.senderDeviceName ?? "").trim();
  const startedSensorNanos = Number(decoded.startedSensorNanos);
  const stoppedSensorNanos = Number(decoded.stoppedSensorNanos);

  if (
    !senderDeviceName ||
    !Number.isFinite(startedSensorNanos) ||
    !Number.isFinite(stoppedSensorNanos) ||
    stoppedSensorNanos <= startedSensorNanos
  ) {
    messageStats.parseErrors += 1;
    pushEvent("warn", `Invalid lap_result payload from ${endpointId}`, { endpointId });
    return;
  }

  const elapsedNanos = Math.trunc(stoppedSensorNanos - startedSensorNanos);
  const lapResult = {
    id: `lap-${nextLapId}`,
    endpointId,
    senderDeviceName,
    startedSensorNanos: Math.trunc(startedSensorNanos),
    stoppedSensorNanos: Math.trunc(stoppedSensorNanos),
    elapsedNanos,
    elapsedMillis: Math.round(elapsedNanos / 1_000_000),
    receivedAtIso: new Date().toISOString(),
  };
  nextLapId += 1;

  latestLapByEndpoint.set(endpointId, lapResult);
  appendBounded(lapHistory, lapResult, HISTORY_LIMIT);

  const existing = clientsByEndpoint.get(endpointId);
  if (!existing?.deviceName) {
    upsertClient(endpointId, { deviceName: senderDeviceName });
  }

  pushEvent("info", `Lap result from ${senderDeviceName}: ${lapResult.elapsedMillis} ms`, {
    endpointId,
    senderDeviceName,
    elapsedMillis: lapResult.elapsedMillis,
  });
}

function assignedRoleForEndpoint(endpointId: string): RoleLabel {
  const client = clientsByEndpoint.get(endpointId);
  const roleTarget = client?.stableDeviceId || endpointId;
  return (
    sessionState.roleAssignments[roleTarget] ??
    sessionState.roleAssignments[endpointId] ??
    "Unassigned"
  );
}

function rejectTriggerRequest(endpointId: string, reason: string, details: UnknownRecord = {}): void {
  pushEvent("warn", `Trigger request rejected from ${endpointId}: ${reason}`, {
    endpointId,
    ...details,
  });
}

function triggerSpecMatchesRole(roleLabel: RoleLabel, triggerSpec: TriggerSpec): boolean {
  const expected = triggerSpecForRole(roleLabel);
  if (!expected) {
    return false;
  }
  return (
    expected.triggerType === triggerSpec.triggerType &&
    Number(expected.splitIndex ?? 0) === Number(triggerSpec.splitIndex ?? 0)
  );
}

function handleSessionTrigger(endpointId: string, decoded: SessionTriggerMessage): void {
  if (!sessionState.monitoringActive || sessionState.stage !== SESSION_STAGE_MONITORING) {
    return;
  }

  const assignedRole = assignedRoleForEndpoint(endpointId);
  if (assignedRole === "Unassigned") {
    rejectTriggerRequest(endpointId, "unassigned role", { sourceType: "session_trigger" });
    return;
  }

  const triggerSpec = triggerSpecForType(decoded.triggerType, decoded.splitIndex);
  if (!triggerSpec) {
    rejectTriggerRequest(endpointId, "invalid trigger payload", { sourceType: "session_trigger" });
    return;
  }
  if (!triggerSpecMatchesRole(assignedRole, triggerSpec)) {
    rejectTriggerRequest(endpointId, "role mismatch", {
      sourceType: "session_trigger",
      assignedRole,
      triggerType: triggerSpec.triggerType,
      splitIndex: triggerSpec.splitIndex,
    });
    return;
  }

  // Compatibility path for older clients: use host receive time as canonical trigger timestamp.
  const triggerSensorNanos = nowHostSensorNanos();
  if (!applyTriggerToHostTimeline(triggerSpec, triggerSensorNanos)) {
    rejectTriggerRequest(endpointId, "timeline state rejected", {
      sourceType: "session_trigger",
      triggerType: triggerSpec.triggerType,
      splitIndex: triggerSpec.splitIndex,
    });
    return;
  }

  pushEvent("info", `Trigger accepted from ${endpointId}: ${triggerSpec.triggerType}`, {
    endpointId,
    sourceType: "session_trigger",
    triggerType: triggerSpec.triggerType,
    splitIndex: triggerSpec.splitIndex,
    triggerSensorNanos,
  });
  broadcastProtocolTrigger(triggerSpec.triggerType, triggerSensorNanos, triggerSpec.splitIndex);
  broadcastTimelineSnapshot();
  broadcastProtocolSnapshots();
  publishState();
}

function handleTriggerRequest(endpointId: string, decoded: TriggerRequestMessage): void {
  if (!sessionState.monitoringActive || sessionState.stage !== SESSION_STAGE_MONITORING) {
    rejectTriggerRequest(endpointId, "monitoring inactive", { sourceType: "trigger_request" });
    return;
  }

  const requestedRoleLabel = wireRoleToRoleLabel(decoded.role);
  if (!requestedRoleLabel) {
    rejectTriggerRequest(endpointId, "invalid role", {
      sourceType: "trigger_request",
      role: decoded.role,
    });
    return;
  }

  const assignedRole = assignedRoleForEndpoint(endpointId);
  if (assignedRole !== requestedRoleLabel) {
    rejectTriggerRequest(endpointId, "role mismatch", {
      sourceType: "trigger_request",
      role: decoded.role,
      assignedRole,
    });
    return;
  }

  const triggerSpec = triggerSpecForRole(assignedRole);
  if (!triggerSpec) {
    rejectTriggerRequest(endpointId, "role has no trigger mapping", {
      sourceType: "trigger_request",
      assignedRole,
    });
    return;
  }

  let triggerSensorNanos: number | null = null;
  let mappingFallbackUsed = false;
  const rawMappedHostSensorNanos = decoded.mappedHostSensorNanos;
  if (rawMappedHostSensorNanos !== null && rawMappedHostSensorNanos !== undefined) {
    const mappedHostSensorNanos = Number(rawMappedHostSensorNanos);
    if (Number.isFinite(mappedHostSensorNanos)) {
      triggerSensorNanos = Math.trunc(mappedHostSensorNanos);
    }
  }
  if (triggerSensorNanos === null) {
    triggerSensorNanos = nowHostSensorNanos();
    mappingFallbackUsed = true;
    pushEvent("warn", `Trigger mapping unavailable from ${endpointId}; using host receive timestamp`, {
      endpointId,
      sourceType: "trigger_request",
      assignedRole,
    });
  }

  if (!applyTriggerToHostTimeline(triggerSpec, triggerSensorNanos)) {
    rejectTriggerRequest(endpointId, "timeline state rejected", {
      sourceType: "trigger_request",
      triggerType: triggerSpec.triggerType,
      splitIndex: triggerSpec.splitIndex,
    });
    return;
  }

  pushEvent("info", `Trigger accepted from ${endpointId}: ${triggerSpec.triggerType}`, {
    endpointId,
    triggerType: triggerSpec.triggerType,
    splitIndex: triggerSpec.splitIndex,
    mappingFallbackUsed,
  });
  broadcastProtocolTrigger(triggerSpec.triggerType, triggerSensorNanos, triggerSpec.splitIndex);
  broadcastTimelineSnapshot();
  broadcastProtocolSnapshots();
  publishState();
}

function handleTriggerRefinement(endpointId: string, decoded: TriggerRefinementMessage): void {
  const runId = String(decoded.runId ?? "").trim();
  if (!runId || runId !== sessionState.runId) {
    return;
  }

  const requestedRoleLabel = wireRoleToRoleLabel(decoded.role);
  if (!requestedRoleLabel || requestedRoleLabel === "Unassigned") {
    return;
  }

  const client = clientsByEndpoint.get(endpointId);
  const roleTarget = client?.stableDeviceId || endpointId;
  const assignedRole =
    sessionState.roleAssignments[roleTarget] ??
    sessionState.roleAssignments[endpointId] ??
    "Unassigned";
  if (assignedRole !== requestedRoleLabel) {
    return;
  }

  const rawProvisionalHostSensorNanos = decoded.provisionalHostSensorNanos;
  const rawRefinedHostSensorNanos = decoded.refinedHostSensorNanos;
  if (
    rawProvisionalHostSensorNanos === null ||
    rawProvisionalHostSensorNanos === undefined ||
    rawRefinedHostSensorNanos === null ||
    rawRefinedHostSensorNanos === undefined
  ) {
    return;
  }

  const provisionalHostSensorNanos = Number(rawProvisionalHostSensorNanos);
  const refinedHostSensorNanos = Number(rawRefinedHostSensorNanos);
  if (!Number.isFinite(provisionalHostSensorNanos) || !Number.isFinite(refinedHostSensorNanos)) {
    return;
  }

  const provisional = Math.trunc(provisionalHostSensorNanos);
  const refined = Math.trunc(refinedHostSensorNanos);
  if (!applyTriggerRefinementToHostTimeline(requestedRoleLabel, provisional, refined)) {
    return;
  }

  pushEvent("info", `Trigger refinement accepted from ${endpointId}: ${requestedRoleLabel}`, {
    endpointId,
    roleLabel: requestedRoleLabel,
    provisionalHostSensorNanos: provisional,
    refinedHostSensorNanos: refined,
  });
  broadcastProtocolTriggerRefinement(requestedRoleLabel, provisional, refined);
  broadcastTimelineSnapshot();
  broadcastProtocolSnapshots();
  publishState();
}

function pushEvent(level: EventLevel, message: string, details: UnknownRecord = {}): void {
  const event = {
    id: `event-${nextEventId}`,
    timestampIso: new Date().toISOString(),
    level,
    message,
    ...details,
  };
  nextEventId += 1;
  appendBounded(recentEvents, event, EVENT_LIMIT);
  broadcast({ type: "server:event", payload: event });
}

function resetRunData() {
  latestLapByEndpoint.clear();
  lapHistory.length = 0;
}

function normalizeCameraFacing(rawCameraFacing: unknown): CameraFacing | null {
  const normalized = String(rawCameraFacing ?? "").trim().toLowerCase();
  if (normalized === "rear") {
    return "rear";
  }
  if (normalized === "front") {
    return "front";
  }
  return null;
}

function normalizeDistanceMeters(rawDistanceMeters: unknown): number | null {
  const parsed = Number(rawDistanceMeters);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100000) {
    return null;
  }
  return Math.round(parsed * 1000) / 1000;
}

function canonicalTargetId(targetId: string): string {
  const directClient = clientsByEndpoint.get(targetId);
  if (directClient?.stableDeviceId) {
    return directClient.stableDeviceId;
  }
  for (const client of clientsByEndpoint.values()) {
    if (client.stableDeviceId === targetId) {
      return targetId;
    }
  }
  return targetId;
}

function resolveEndpointIdsForTargetId(targetId: string): string[] {
  const resolved: string[] = [];
  for (const client of clientsByEndpoint.values()) {
    if (client.endpointId === targetId || client.stableDeviceId === targetId) {
      resolved.push(client.endpointId);
    }
  }
  return resolved;
}

function resolveCameraFacingForRoleTarget(
  roleTarget: string | null,
  fallbackFacing: CameraFacing = "rear",
): CameraFacing {
  const configured = roleTarget ? sessionState.deviceCameraFacingAssignments[roleTarget] : null;
  return normalizeCameraFacing(configured) ?? normalizeCameraFacing(fallbackFacing) ?? "rear";
}

function resolveSensitivityForRoleTarget(roleTarget: string | null, fallbackSensitivity = 100): number {
  const configured = roleTarget ? Number(sessionState.deviceSensitivityAssignments[roleTarget]) : Number.NaN;
  if (Number.isInteger(configured) && configured >= 1 && configured <= 100) {
    return configured;
  }
  const fallback = Number(fallbackSensitivity);
  if (Number.isInteger(fallback) && fallback >= 1 && fallback <= 100) {
    return fallback;
  }
  return 100;
}

function resolveDistanceForRoleTarget(roleTarget: string | null, fallbackDistanceMeters: number | null = null): number | null {
  const configured = roleTarget ? normalizeDistanceMeters(sessionState.deviceDistanceAssignments[roleTarget]) : null;
  if (configured !== null) {
    return configured;
  }
  return normalizeDistanceMeters(fallbackDistanceMeters);
}

function defaultDistanceForRole(role: RoleLabel): number | null {
  return role === "Stop" ? STOP_ROLE_DEFAULT_DISTANCE_METERS : null;
}

function applyDefaultDistanceForRole(targetId: string, role: RoleLabel): void {
  const defaultDistanceMeters = defaultDistanceForRole(role);
  if (defaultDistanceMeters === null) {
    return;
  }

  const normalizedDistanceMeters = normalizeDistanceMeters(defaultDistanceMeters);
  if (normalizedDistanceMeters === null) {
    return;
  }

  sessionState.deviceDistanceAssignments[targetId] = normalizedDistanceMeters;

  const endpointIds = resolveEndpointIdsForTargetId(targetId);
  for (const endpointId of endpointIds) {
    upsertClient(endpointId, { distanceMeters: normalizedDistanceMeters });
  }
}

function migrateAssignmentKey<T>(targetMap: Record<string, T>, oldKey: string, newKey: string): void {
  if (!oldKey || !newKey || oldKey === newKey) {
    return;
  }
  if (!(oldKey in targetMap)) {
    return;
  }
  if (!(newKey in targetMap)) {
    targetMap[newKey] = targetMap[oldKey];
  }
  delete targetMap[oldKey];
}

function sendDeviceConfigUpdateToEndpoint(endpointId: string, targetStableDeviceId: string, sensitivity: number): boolean {
  const normalizedSensitivity = Number(sensitivity);
  if (!Number.isInteger(normalizedSensitivity) || normalizedSensitivity < 1 || normalizedSensitivity > 100) {
    return false;
  }
  return sendTcpTelemetryConfigUpdate(endpointId, targetStableDeviceId, normalizedSensitivity);
}

function sendClockResyncRequestToEndpoint(endpointId: string, sampleCount = CLOCK_RESYNC_DEFAULT_SAMPLE_COUNT): boolean {
  const normalizedSampleCount = normalizeClockResyncSampleCount(sampleCount);
  if (normalizedSampleCount === null) {
    return false;
  }
  return sendTcpTelemetryClockResync(endpointId, normalizedSampleCount);
}

function normalizeClockResyncSampleCount(sampleCount: unknown): number | null {
  const parsed = Number(sampleCount);
  if (!Number.isInteger(parsed)) {
    return null;
  }
  return Math.min(CLOCK_RESYNC_MAX_SAMPLE_COUNT, Math.max(CLOCK_RESYNC_MIN_SAMPLE_COUNT, parsed));
}

function stopClockResyncLoopForEndpoint(endpointId: string): void {
  const existing = clockResyncLoopsByEndpoint.get(endpointId);
  if (!existing) {
    return;
  }
  if (existing.timerHandle) {
    clearTimeout(existing.timerHandle);
  }
  clockResyncLoopsByEndpoint.delete(endpointId);
}

function stopAllClockResyncLoops() {
  for (const endpointId of clockResyncLoopsByEndpoint.keys()) {
    stopClockResyncLoopForEndpoint(endpointId);
  }
}

function tryCompleteClockResyncLoop(endpointId: string, source: string): void {
  const loopState = clockResyncLoopsByEndpoint.get(endpointId);
  if (!loopState) {
    return;
  }

  const client = clientsByEndpoint.get(endpointId);
  const latencyMs = Number(client?.telemetryLatencyMs);
  if (!Number.isInteger(latencyMs) || latencyMs < 0) {
    return;
  }
  if (latencyMs >= loopState.targetLatencyMs) {
    return;
  }

  pushEvent("info", `Clock resync target reached for ${endpointId}`, {
    endpointId,
    latencyMs,
    targetLatencyMs: loopState.targetLatencyMs,
    attempts: loopState.attempts,
    source,
  });
  stopClockResyncLoopForEndpoint(endpointId);
}

function startClockResyncLoopForEndpoint(
  endpointId: string,
  sampleCount = CLOCK_RESYNC_DEFAULT_SAMPLE_COUNT,
  targetLatencyMs = CLOCK_RESYNC_TARGET_LATENCY_MS,
): boolean {
  if (!socketsByEndpoint.has(endpointId)) {
    return false;
  }

  const normalizedSampleCount = normalizeClockResyncSampleCount(sampleCount);
  if (normalizedSampleCount === null) {
    return false;
  }

  const parsedTargetLatencyMs = Number(targetLatencyMs);
  const normalizedTargetLatencyMs =
    Number.isFinite(parsedTargetLatencyMs) && parsedTargetLatencyMs > 0
      ? Math.trunc(parsedTargetLatencyMs)
      : CLOCK_RESYNC_TARGET_LATENCY_MS;

  stopClockResyncLoopForEndpoint(endpointId);

  const loopState = {
    sampleCount: normalizedSampleCount,
    targetLatencyMs: normalizedTargetLatencyMs,
    attempts: 0,
    timerHandle: null,
  };
  clockResyncLoopsByEndpoint.set(endpointId, loopState);

  const runAttempt = () => {
    const current = clockResyncLoopsByEndpoint.get(endpointId);
    if (!current) {
      return;
    }
    if (!socketsByEndpoint.has(endpointId)) {
      stopClockResyncLoopForEndpoint(endpointId);
      return;
    }

    tryCompleteClockResyncLoop(endpointId, "before_send");
    if (!clockResyncLoopsByEndpoint.has(endpointId)) {
      return;
    }

    if (!sendClockResyncRequestToEndpoint(endpointId, current.sampleCount)) {
      pushEvent("warn", `Clock resync request send failed for ${endpointId}`, {
        endpointId,
        attempts: current.attempts,
      });
      stopClockResyncLoopForEndpoint(endpointId);
      return;
    }

    current.attempts += 1;
    current.timerHandle = setTimeout(runAttempt, CLOCK_RESYNC_RETRY_DELAY_MS);
  };

  runAttempt();
  return true;
}

function autoAssignRoleForNewJoin(endpointId: string): void {
  const existingRole = sessionState.roleAssignments[endpointId];
  if (existingRole) {
    return;
  }

  const assignedRoles = new Set(Object.values(sessionState.roleAssignments));
  const nextRole = AUTO_ASSIGN_ROLE_SEQUENCE.find((role) => !assignedRoles.has(role));
  if (!nextRole) {
    return;
  }

  sessionState.roleAssignments[endpointId] = nextRole;
  applyDefaultDistanceForRole(endpointId, nextRole);
  pushEvent("info", `Role auto-assigned: ${endpointId} -> ${nextRole}`);
}

function computeRoleOptions() {
  return computeProgressiveRoleOptions(Object.values(sessionState.roleAssignments)) as RoleLabel[];
}

function roleLabelToWireRole(roleLabel: string): string {
  const normalized = String(roleLabel ?? "").trim().toLowerCase().replace(/\s+/g, "");
  if (normalized === "start") {
    return "start";
  }
  if (normalized === "split1" || normalized === "split") {
    return "split1";
  }
  if (normalized === "split2") {
    return "split2";
  }
  if (normalized === "split3") {
    return "split3";
  }
  if (normalized === "split4") {
    return "split4";
  }
  if (normalized === "stop") {
    return "stop";
  }
  return "unassigned";
}

function wireRoleToRoleLabel(rawRole: unknown): RoleLabel | null {
  const normalized = String(rawRole ?? "").trim().toLowerCase();
  if (normalized === "start") {
    return "Start";
  }
  if (normalized === "split" || normalized === "split1") {
    return "Split 1";
  }
  if (normalized === "split2") {
    return "Split 2";
  }
  if (normalized === "split3") {
    return "Split 3";
  }
  if (normalized === "split4") {
    return "Split 4";
  }
  if (normalized === "stop") {
    return "Stop";
  }
  if (normalized === "unassigned") {
    return "Unassigned";
  }
  return null;
}

function triggerSpecForRole(roleLabel: string): TriggerSpec | null {
  if (roleLabel === "Start") {
    return { triggerType: "start", splitIndex: 0 };
  }
  if (roleLabel === "Split 1") {
    return { triggerType: "split", splitIndex: 1 };
  }
  if (roleLabel === "Split 2") {
    return { triggerType: "split", splitIndex: 2 };
  }
  if (roleLabel === "Split 3") {
    return { triggerType: "split", splitIndex: 3 };
  }
  if (roleLabel === "Split 4") {
    return { triggerType: "split", splitIndex: 4 };
  }
  if (roleLabel === "Stop") {
    return { triggerType: "stop", splitIndex: 0 };
  }
  return null;
}

function triggerSpecForType(triggerType: unknown, splitIndex: unknown = 0): TriggerSpec | null {
  const normalizedType = String(triggerType ?? "").trim().toLowerCase();
  if (normalizedType === "start") {
    return { triggerType: "start", splitIndex: 0 };
  }
  if (normalizedType === "stop") {
    return { triggerType: "stop", splitIndex: 0 };
  }
  if (normalizedType === "split") {
    const numericSplitIndex = Number(splitIndex);
    if (!Number.isInteger(numericSplitIndex) || numericSplitIndex < 1 || numericSplitIndex > 4) {
      return null;
    }
    return { triggerType: "split", splitIndex: numericSplitIndex };
  }
  return null;
}

function triggerSpecFromControlPayload(payload: UnknownRecord | null | undefined): TriggerSpec | null {
  const explicitRole = String(payload?.role ?? "").trim();
  if (explicitRole.length > 0) {
    const directRole = triggerSpecForRole(explicitRole);
    if (directRole) {
      return directRole;
    }
    const parsedWireRole = wireRoleToRoleLabel(explicitRole);
    if (parsedWireRole) {
      return triggerSpecForRole(parsedWireRole);
    }
  }

  return triggerSpecForType(payload?.triggerType, payload?.splitIndex);
}

function triggerLabelForSpec(triggerSpec: TriggerSpec) {
  if (triggerSpec.triggerType === "start") {
    return "Start";
  }
  if (triggerSpec.triggerType === "stop") {
    return "Stop";
  }
  if (triggerSpec.triggerType === "split") {
    return `Split ${triggerSpec.splitIndex}`;
  }
  return triggerSpec.triggerType;
}

function applyTriggerToHostTimeline(triggerSpec: TriggerSpec, triggerSensorNanos: number): boolean {
  if (!Number.isFinite(triggerSensorNanos)) {
    return false;
  }
  const normalizedSensorNanos = Math.trunc(triggerSensorNanos);

  if (triggerSpec.triggerType === "start") {
    if (Number.isFinite(sessionState.hostStartSensorNanos)) {
      return false;
    }
    sessionState.hostStartSensorNanos = normalizedSensorNanos;
    return true;
  }

  if (triggerSpec.triggerType === "stop") {
    if (!Number.isFinite(sessionState.hostStartSensorNanos) || Number.isFinite(sessionState.hostStopSensorNanos)) {
      return false;
    }
    sessionState.hostStopSensorNanos = normalizedSensorNanos;
    return true;
  }

  if (triggerSpec.triggerType === "split") {
    if (!Number.isFinite(sessionState.hostStartSensorNanos) || Number.isFinite(sessionState.hostStopSensorNanos)) {
      return false;
    }

    const splitIndex = Number(triggerSpec.splitIndex);
    if (!Number.isInteger(splitIndex) || splitIndex < 1 || splitIndex > 4) {
      return false;
    }

    const roleLabel = `Split ${splitIndex}` as RoleLabel;
    if (sessionState.hostSplitMarks.some((splitMark) => splitMark.roleLabel === roleLabel)) {
      return false;
    }

    const lastMarker =
      sessionState.hostSplitMarks.length > 0
        ? sessionState.hostSplitMarks[sessionState.hostSplitMarks.length - 1].hostSensorNanos
        : sessionState.hostStartSensorNanos;
    const lastMarkerNanos = Number(lastMarker);
    if (!Number.isFinite(lastMarkerNanos) || normalizedSensorNanos <= lastMarkerNanos) {
      return false;
    }

    sessionState.hostSplitMarks = [
      ...sessionState.hostSplitMarks,
      { roleLabel, hostSensorNanos: normalizedSensorNanos },
    ];
    return true;
  }

  return false;
}

function applyTriggerRefinementToHostTimeline(
  roleLabel: TriggerRoleLabel,
  provisionalHostSensorNanos: number,
  refinedHostSensorNanos: number,
): boolean {
  if (
    !Number.isFinite(provisionalHostSensorNanos) ||
    !Number.isFinite(refinedHostSensorNanos)
  ) {
    return false;
  }

  if (roleLabel === "Start") {
    if (!Number.isFinite(sessionState.hostStartSensorNanos)) {
      return false;
    }
    if (sessionState.hostStartSensorNanos !== provisionalHostSensorNanos) {
      return false;
    }

      const earliestFutureMarker = sessionState.hostSplitMarks.length
      ? sessionState.hostSplitMarks[0].hostSensorNanos
      : sessionState.hostStopSensorNanos;
      const earliestFutureMarkerNanos = Number(earliestFutureMarker);
      if (Number.isFinite(earliestFutureMarkerNanos) && refinedHostSensorNanos >= earliestFutureMarkerNanos) {
      return false;
    }

    sessionState.hostStartSensorNanos = refinedHostSensorNanos;
    return true;
  }

  if (roleLabel === "Stop") {
    if (!Number.isFinite(sessionState.hostStopSensorNanos)) {
      return false;
    }
    if (sessionState.hostStopSensorNanos !== provisionalHostSensorNanos) {
      return false;
    }

      const previousMarker =
      sessionState.hostSplitMarks.length > 0
        ? sessionState.hostSplitMarks[sessionState.hostSplitMarks.length - 1].hostSensorNanos
        : sessionState.hostStartSensorNanos;
      const previousMarkerNanos = Number(previousMarker);
      if (!Number.isFinite(previousMarkerNanos) || refinedHostSensorNanos <= previousMarkerNanos) {
      return false;
    }

    sessionState.hostStopSensorNanos = refinedHostSensorNanos;
    return true;
  }

  if (roleLabel.startsWith("Split ")) {
    const splitMarkIndex = sessionState.hostSplitMarks.findIndex((mark) => mark.roleLabel === roleLabel);
    if (splitMarkIndex === -1) {
      return false;
    }

    const currentMark = sessionState.hostSplitMarks[splitMarkIndex];
    if (currentMark.hostSensorNanos !== provisionalHostSensorNanos) {
      return false;
    }

    const previousMarker =
      splitMarkIndex > 0
        ? sessionState.hostSplitMarks[splitMarkIndex - 1].hostSensorNanos
        : sessionState.hostStartSensorNanos;
    const nextMarker =
      splitMarkIndex < sessionState.hostSplitMarks.length - 1
        ? sessionState.hostSplitMarks[splitMarkIndex + 1].hostSensorNanos
        : sessionState.hostStopSensorNanos;

      const previousMarkerNanos = Number(previousMarker);
      const nextMarkerNanos = Number(nextMarker);
      if (!Number.isFinite(previousMarkerNanos) || refinedHostSensorNanos <= previousMarkerNanos) {
      return false;
    }
      if (Number.isFinite(nextMarkerNanos) && refinedHostSensorNanos >= nextMarkerNanos) {
      return false;
    }

    sessionState.hostSplitMarks = sessionState.hostSplitMarks.map((mark, index) =>
      index === splitMarkIndex
        ? { ...mark, hostSensorNanos: refinedHostSensorNanos }
        : mark,
    );
    return true;
  }

  return false;
}

function roleTargetForRole(roleLabel: RoleLabel): string | null {
  for (const [targetId, assignedRole] of Object.entries(sessionState.roleAssignments)) {
    if (assignedRole === roleLabel) {
      return targetId;
    }
  }
  return null;
}

function clientForRoleTarget(roleTarget: string | null): ClientState | null {
  if (!roleTarget) {
    return null;
  }
  for (const client of clientsByEndpoint.values()) {
    if (client.stableDeviceId === roleTarget || client.endpointId === roleTarget) {
      return client;
    }
  }
  return null;
}

function computeSpeedMps(distanceMeters: number | null, elapsedNanos: number): number | null {
  const normalizedDistance = normalizeDistanceMeters(distanceMeters);
  const elapsed = Number(elapsedNanos);
  if (normalizedDistance === null || !Number.isFinite(elapsed) || elapsed <= 0) {
    return null;
  }
  const metersPerSecond = normalizedDistance / (elapsed / 1_000_000_000);
  if (!Number.isFinite(metersPerSecond) || metersPerSecond < 0) {
    return null;
  }
  return Math.round(metersPerSecond * 1000) / 1000;
}

function createTimelineLapResults() {
  const rawStartSensorNanos = Number(sessionState.hostStartSensorNanos);
  if (!Number.isFinite(rawStartSensorNanos)) {
    return [];
  }
  const startSensorNanos = Math.trunc(rawStartSensorNanos);

  const timelineMarkers: Array<{ roleLabel: RoleLabel; hostSensorNanos: number }> = [];
  for (const splitMark of sessionState.hostSplitMarks) {
    const roleLabel = splitMark?.roleLabel;
    const markerSensorNanos = Number(splitMark?.hostSensorNanos);
    if (!roleLabel || !Number.isFinite(markerSensorNanos)) {
      continue;
    }
    timelineMarkers.push({ roleLabel, hostSensorNanos: Math.trunc(markerSensorNanos) });
  }

  const rawStopSensorNanos = Number(sessionState.hostStopSensorNanos);
  if (Number.isFinite(rawStopSensorNanos)) {
    timelineMarkers.push({ roleLabel: "Stop", hostSensorNanos: Math.trunc(rawStopSensorNanos) });
  }

  if (timelineMarkers.length === 0) {
    return [];
  }

  timelineMarkers.sort((left, right) => left.hostSensorNanos - right.hostSensorNanos);

  const startRoleTarget = roleTargetForRole("Start");
  let previousHostSensorNanos = startSensorNanos;
  let previousDistanceMeters = resolveDistanceForRoleTarget(startRoleTarget, 0) ?? 0;

  const results: TimelineLapResult[] = [];
  for (const marker of timelineMarkers) {
    const elapsedNanos = marker.hostSensorNanos - startSensorNanos;
    const lapElapsedNanos = marker.hostSensorNanos - previousHostSensorNanos;
    if (elapsedNanos <= 0 || lapElapsedNanos <= 0) {
      continue;
    }

    const roleTarget = roleTargetForRole(marker.roleLabel);
    const client = clientForRoleTarget(roleTarget);
    const distanceFallback = client?.distanceMeters ?? defaultDistanceForRole(marker.roleLabel);
    const distanceMeters = resolveDistanceForRoleTarget(roleTarget, distanceFallback);

    let lapDistanceMeters: number | null = null;
    if (distanceMeters !== null && Number.isFinite(previousDistanceMeters)) {
      const segmentDistance = normalizeDistanceMeters(distanceMeters - previousDistanceMeters);
      if (segmentDistance !== null) {
        lapDistanceMeters = segmentDistance;
      }
    }

    const averageSpeedMps = computeSpeedMps(distanceMeters, elapsedNanos);
    const lapSpeedMps = computeSpeedMps(lapDistanceMeters, lapElapsedNanos);

    const roleSegment = marker.roleLabel.toLowerCase().replace(/\s+/g, "-");
    results.push({
      id: `timeline-${sessionState.runId ?? "run"}-${roleSegment}`,
      source: "timeline",
      endpointId: client?.endpointId ?? roleTarget ?? `role:${roleSegment}`,
      senderDeviceName: client?.deviceName ?? roleTarget ?? marker.roleLabel,
      roleLabel: marker.roleLabel,
      startedSensorNanos: startSensorNanos,
      stoppedSensorNanos: marker.hostSensorNanos,
      elapsedNanos,
      elapsedMillis: Math.round(elapsedNanos / 1_000_000),
      lapElapsedNanos,
      lapElapsedMillis: Math.round(lapElapsedNanos / 1_000_000),
      distanceMeters,
      lapDistanceMeters,
      averageSpeedMps,
      lapSpeedMps,
      receivedAtIso: new Date().toISOString(),
    });

    previousHostSensorNanos = marker.hostSensorNanos;
    if (distanceMeters !== null) {
      previousDistanceMeters = distanceMeters;
    }
  }

  return results.sort((left, right) => left.elapsedNanos - right.elapsedNanos);
}

function stageToWireStage(stage: SessionState["stage"]): string {
  return String(stage ?? SESSION_STAGE_LOBBY).toLowerCase();
}

function nowHostSensorNanos() {
  const value = nowHostElapsedNanos();
  const maxSafe = BigInt(Number.MAX_SAFE_INTEGER);
  if (value > maxSafe) {
    return Number(maxSafe);
  }
  return Number(value);
}

function protocolDevicesWithRoles() {
  return Array.from(clientsByEndpoint.values())
    .sort((left, right) => left.connectedAtIso.localeCompare(right.connectedAtIso))
    .map((client) => {
      const deviceId = client.stableDeviceId || client.endpointId;
      const fallbackRole = sessionState.roleAssignments[client.endpointId] ?? "Unassigned";
      const assignedRole = sessionState.roleAssignments[deviceId] ?? fallbackRole;
      const cameraFacing = resolveCameraFacingForRoleTarget(deviceId, client.cameraFacing);
      return {
        endpointId: client.endpointId,
        id: deviceId,
        name: client.deviceName || client.endpointId,
        roleLabel: assignedRole,
        cameraFacing,
      };
    });
}

function createProtocolSnapshotForEndpoint(endpointId: string) {
  const protocolDevices = protocolDevicesWithRoles();
  if (protocolDevices.length === 0) {
    return null;
  }

  const selfDevice = protocolDevices.find((device) => device.endpointId === endpointId);
  const anchorDevice = protocolDevices.find((device) => roleLabelToWireRole(device.roleLabel) === "start");

  return {
    type: "snapshot",
    stage: stageToWireStage(sessionState.stage),
    monitoringActive: sessionState.monitoringActive,
    devices: protocolDevices.map((device) => ({
      id: device.id,
      name: device.name,
      role: roleLabelToWireRole(device.roleLabel),
      cameraFacing: device.cameraFacing,
      isLocal: false,
    })),
    timeline: {
      hostStartSensorNanos:
        Number.isFinite(sessionState.hostStartSensorNanos) ? sessionState.hostStartSensorNanos : null,
      hostStopSensorNanos:
        Number.isFinite(sessionState.hostStopSensorNanos) ? sessionState.hostStopSensorNanos : null,
      hostSplitMarks: sessionState.hostSplitMarks.map((split) => ({
        role: roleLabelToWireRole(split.roleLabel),
        hostSensorNanos: split.hostSensorNanos,
      })),
      hostSplitSensorNanos: sessionState.hostSplitMarks.map((split) => split.hostSensorNanos),
    },
    runId: sessionState.runId,
    hostSensorMinusElapsedNanos: 0,
    hostGpsUtcOffsetNanos: null,
    hostGpsFixAgeNanos: null,
    selfDeviceId: selfDevice?.id ?? null,
    anchorDeviceId: anchorDevice?.id ?? null,
    anchorState: sessionState.monitoringActive ? "active" : "ready",
  };
}

function sendTcpJsonMessage(endpointId: string, payloadObject: unknown): boolean {
  const payloadBuffer = Buffer.from(JSON.stringify(payloadObject), "utf8");
  return sendTcpFrame(endpointId, FRAME_KIND_MESSAGE, payloadBuffer);
}

function createOptionalFlatBufferString(
  builder: flatbuffers.Builder,
  value: string | null | undefined,
): flatbuffers.Offset {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) {
    return 0;
  }
  return builder.createString(normalized);
}

function toTelemetryInt64(value: number | null | undefined, fallback: bigint): bigint {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  const truncated = Math.trunc(numeric);
  if (truncated > Number.MAX_SAFE_INTEGER) {
    return MAX_SAFE_INT64;
  }
  if (truncated < Number.MIN_SAFE_INTEGER) {
    return MIN_SAFE_INT64;
  }
  return BigInt(truncated);
}

function wireRoleToTelemetryRole(rawRole: unknown): FlatBufferSessionDeviceRole {
  const normalized = String(rawRole ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
  if (normalized === "start") {
    return FlatBufferSessionDeviceRole.START;
  }
  if (normalized === "split" || normalized === "split1") {
    return FlatBufferSessionDeviceRole.SPLIT1;
  }
  if (normalized === "split2") {
    return FlatBufferSessionDeviceRole.SPLIT2;
  }
  if (normalized === "split3") {
    return FlatBufferSessionDeviceRole.SPLIT3;
  }
  if (normalized === "split4") {
    return FlatBufferSessionDeviceRole.SPLIT4;
  }
  if (normalized === "stop") {
    return FlatBufferSessionDeviceRole.STOP;
  }
  if (normalized === "display") {
    return FlatBufferSessionDeviceRole.DISPLAY;
  }
  return FlatBufferSessionDeviceRole.UNASSIGNED;
}

function sendTelemetryEnvelopeFrame(
  endpointId: string,
  payloadType: FlatBufferTelemetryPayload,
  buildPayload: (builder: flatbuffers.Builder) => flatbuffers.Offset,
  initialSize = 256,
): boolean {
  const builder = new flatbuffers.Builder(initialSize);
  const payloadOffset = buildPayload(builder);
  const envelopeOffset = FlatBufferTelemetryEnvelope.createTelemetryEnvelope(builder, payloadType, payloadOffset);
  FlatBufferTelemetryEnvelope.finishTelemetryEnvelopeBuffer(builder, envelopeOffset);
  return sendTcpFrame(endpointId, FRAME_KIND_TELEMETRY_BINARY, Buffer.from(builder.asUint8Array()));
}

function sendTcpTelemetryTrigger(
  endpointId: string,
  triggerType: string,
  triggerSensorNanos: number,
  splitIndex: number | null,
): boolean {
  if (!triggerType.trim()) {
    return false;
  }
  return sendTelemetryEnvelopeFrame(
    endpointId,
    FlatBufferTelemetryPayload.SessionTrigger,
    (builder) => {
      const triggerTypeOffset = builder.createString(triggerType);
      const normalizedSplitIndex = Number.isInteger(splitIndex)
        ? Number(splitIndex)
        : TELEMETRY_MISSING_OPTIONAL_INT;
      return FlatBufferSessionTrigger.createSessionTrigger(
        builder,
        triggerTypeOffset,
        normalizedSplitIndex,
        toTelemetryInt64(triggerSensorNanos, 0n),
      );
    },
    128,
  );
}

function sendTcpTelemetryTriggerRefinement(
  endpointId: string,
  runId: string,
  role: string,
  provisionalHostSensorNanos: number,
  refinedHostSensorNanos: number,
): boolean {
  if (!runId.trim()) {
    return false;
  }
  const roleEnum = wireRoleToTelemetryRole(role);
  if (roleEnum === FlatBufferSessionDeviceRole.UNASSIGNED) {
    return false;
  }
  return sendTelemetryEnvelopeFrame(
    endpointId,
    FlatBufferTelemetryPayload.TriggerRefinement,
    (builder) => {
      const runIdOffset = builder.createString(runId);
      return FlatBufferTriggerRefinement.createTriggerRefinement(
        builder,
        runIdOffset,
        roleEnum,
        toTelemetryInt64(provisionalHostSensorNanos, 0n),
        toTelemetryInt64(refinedHostSensorNanos, 0n),
      );
    },
    192,
  );
}

function sendTcpTelemetryTimelineSnapshot(
  endpointId: string,
  payload: {
    hostStartSensorNanos: number | null;
    hostStopSensorNanos: number | null;
    hostSplitMarks: Array<{ role: string; hostSensorNanos: number }>;
    sentElapsedNanos: number;
  },
): boolean {
  return sendTelemetryEnvelopeFrame(
    endpointId,
    FlatBufferTelemetryPayload.SessionTimelineSnapshot,
    (builder) => {
      const splitMarkOffsets: flatbuffers.Offset[] = [];
      for (const splitMark of payload.hostSplitMarks) {
        const roleEnum = wireRoleToTelemetryRole(splitMark.role);
        if (roleEnum === FlatBufferSessionDeviceRole.UNASSIGNED) {
          continue;
        }
        splitMarkOffsets.push(
          FlatBufferSessionSplitMark.createSessionSplitMark(
            builder,
            roleEnum,
            toTelemetryInt64(splitMark.hostSensorNanos, 0n),
          ),
        );
      }
      const splitMarksVectorOffset =
        splitMarkOffsets.length > 0
          ? FlatBufferSessionTimelineSnapshot.createHostSplitMarksVector(builder, splitMarkOffsets)
          : 0;
      return FlatBufferSessionTimelineSnapshot.createSessionTimelineSnapshot(
        builder,
        toTelemetryInt64(payload.hostStartSensorNanos, TELEMETRY_MISSING_OPTIONAL_LONG),
        toTelemetryInt64(payload.hostStopSensorNanos, TELEMETRY_MISSING_OPTIONAL_LONG),
        splitMarksVectorOffset,
        toTelemetryInt64(payload.sentElapsedNanos, 0n),
      );
    },
    384,
  );
}

function sendTcpTelemetrySnapshot(
  endpointId: string,
  payload: {
    stage: string;
    monitoringActive: boolean;
    devices: Array<{ id: string; name: string; role: string; cameraFacing: string; isLocal: boolean }>;
    timeline: {
      hostStartSensorNanos: number | null;
      hostStopSensorNanos: number | null;
      hostSplitMarks: Array<{ role: string; hostSensorNanos: number }>;
    };
    runId: string | null;
    hostSensorMinusElapsedNanos: number | null;
    hostGpsUtcOffsetNanos: number | null;
    hostGpsFixAgeNanos: number | null;
    selfDeviceId: string | null;
    anchorDeviceId: string | null;
    anchorState: string | null;
  },
): boolean {
  return sendTelemetryEnvelopeFrame(
    endpointId,
    FlatBufferTelemetryPayload.SessionSnapshot,
    (builder) => {
      const stageOffset = builder.createString(payload.stage);
      const deviceOffsets: flatbuffers.Offset[] = payload.devices.map((device) => {
        const idOffset = builder.createString(device.id);
        const nameOffset = builder.createString(device.name);
        const roleOffset = builder.createString(device.role);
        const cameraFacingOffset = builder.createString(device.cameraFacing);
        return FlatBufferSessionSnapshotDevice.createSessionSnapshotDevice(
          builder,
          idOffset,
          nameOffset,
          roleOffset,
          cameraFacingOffset,
          Boolean(device.isLocal),
        );
      });
      const devicesVectorOffset =
        deviceOffsets.length > 0
          ? FlatBufferSessionSnapshot.createDevicesVector(builder, deviceOffsets)
          : 0;

      const splitMarkOffsets: flatbuffers.Offset[] = [];
      for (const splitMark of payload.timeline.hostSplitMarks) {
        const roleEnum = wireRoleToTelemetryRole(splitMark.role);
        if (roleEnum === FlatBufferSessionDeviceRole.UNASSIGNED) {
          continue;
        }
        splitMarkOffsets.push(
          FlatBufferSessionSplitMark.createSessionSplitMark(
            builder,
            roleEnum,
            toTelemetryInt64(splitMark.hostSensorNanos, 0n),
          ),
        );
      }
      const splitMarksVectorOffset =
        splitMarkOffsets.length > 0
          ? FlatBufferSessionSnapshot.createHostSplitMarksVector(builder, splitMarkOffsets)
          : 0;

      const runIdOffset = createOptionalFlatBufferString(builder, payload.runId);
      const selfDeviceIdOffset = createOptionalFlatBufferString(builder, payload.selfDeviceId);
      const anchorDeviceIdOffset = createOptionalFlatBufferString(builder, payload.anchorDeviceId);
      const anchorStateOffset = createOptionalFlatBufferString(builder, payload.anchorState);

      return FlatBufferSessionSnapshot.createSessionSnapshot(
        builder,
        stageOffset,
        payload.monitoringActive,
        devicesVectorOffset,
        toTelemetryInt64(payload.timeline.hostStartSensorNanos, TELEMETRY_MISSING_OPTIONAL_LONG),
        toTelemetryInt64(payload.timeline.hostStopSensorNanos, TELEMETRY_MISSING_OPTIONAL_LONG),
        splitMarksVectorOffset,
        runIdOffset,
        toTelemetryInt64(payload.hostSensorMinusElapsedNanos, TELEMETRY_MISSING_OPTIONAL_LONG),
        toTelemetryInt64(payload.hostGpsUtcOffsetNanos, TELEMETRY_MISSING_OPTIONAL_LONG),
        toTelemetryInt64(payload.hostGpsFixAgeNanos, TELEMETRY_MISSING_OPTIONAL_LONG),
        selfDeviceIdOffset,
        anchorDeviceIdOffset,
        anchorStateOffset,
      );
    },
    768,
  );
}

function sendTcpTelemetryConfigUpdate(endpointId: string, targetStableDeviceId: string, sensitivity: number): boolean {
  if (!targetStableDeviceId.trim()) {
    return false;
  }
  return sendTelemetryEnvelopeFrame(
    endpointId,
    FlatBufferTelemetryPayload.DeviceConfigUpdate,
    (builder) => {
      const targetStableDeviceIdOffset = builder.createString(targetStableDeviceId);
      return FlatBufferDeviceConfigUpdate.createDeviceConfigUpdate(
        builder,
        targetStableDeviceIdOffset,
        sensitivity,
      );
    },
    96,
  );
}

function sendTcpTelemetryClockResync(endpointId: string, sampleCount: number): boolean {
  return sendTelemetryEnvelopeFrame(
    endpointId,
    FlatBufferTelemetryPayload.ClockResyncRequest,
    (builder) => FlatBufferClockResyncRequest.createClockResyncRequest(builder, sampleCount),
    64,
  );
}

function sendProtocolSnapshotToEndpoint(endpointId: string): boolean {
  const payload = createProtocolSnapshotForEndpoint(endpointId);
  if (!payload) {
    return false;
  }
  return sendTcpTelemetrySnapshot(endpointId, payload);
}

function broadcastProtocolSnapshots() {
  for (const endpointId of socketsByEndpoint.keys()) {
    sendProtocolSnapshotToEndpoint(endpointId);
  }
}

function broadcastProtocolTrigger(triggerType: string, triggerSensorNanos: number, splitIndex: number | null = null) {
  for (const endpointId of socketsByEndpoint.keys()) {
    sendTcpTelemetryTrigger(endpointId, triggerType, triggerSensorNanos, splitIndex);
  }
}

function broadcastProtocolTriggerRefinement(
  roleLabel: RoleLabel,
  provisionalHostSensorNanos: number,
  refinedHostSensorNanos: number,
) {
  const role = roleLabelToWireRole(roleLabel);
  if (role === "unassigned") {
    return;
  }
  if (!sessionState.runId) {
    return;
  }

  for (const endpointId of socketsByEndpoint.keys()) {
    sendTcpTelemetryTriggerRefinement(
      endpointId,
      sessionState.runId,
      role,
      provisionalHostSensorNanos,
      refinedHostSensorNanos,
    );
  }
}

function createTimelineSnapshotPayload() {
  return {
    type: "timeline_snapshot",
    hostStartSensorNanos:
      Number.isFinite(sessionState.hostStartSensorNanos) ? sessionState.hostStartSensorNanos : null,
    hostStopSensorNanos:
      Number.isFinite(sessionState.hostStopSensorNanos) ? sessionState.hostStopSensorNanos : null,
    hostSplitMarks: sessionState.hostSplitMarks.map((split) => ({
      role: roleLabelToWireRole(split.roleLabel),
      hostSensorNanos: split.hostSensorNanos,
    })),
    hostSplitSensorNanos: sessionState.hostSplitMarks.map((split) => split.hostSensorNanos),
    sentElapsedNanos: nowHostSensorNanos(),
  };
}

function broadcastTimelineSnapshot() {
  const payload = createTimelineSnapshotPayload();
  for (const endpointId of socketsByEndpoint.keys()) {
    sendTcpTelemetryTimelineSnapshot(endpointId, payload);
  }
}

function sessionElapsedMsNow() {
  if (sessionState.monitoringActive && sessionState.monitoringStartedAtMs) {
    return Math.max(0, Date.now() - sessionState.monitoringStartedAtMs);
  }
  return Math.max(0, sessionState.monitoringElapsedMs);
}

function createSnapshot() {
  const timelineLapResults = createTimelineLapResults();
  const latestLapResults =
    timelineLapResults.length > 0
      ? timelineLapResults
      : Array.from(latestLapByEndpoint.values()).sort((a, b) => a.elapsedNanos - b.elapsedNanos);
  const clients = Array.from(clientsByEndpoint.values()).sort((a, b) =>
    a.connectedAtIso.localeCompare(b.connectedAtIso),
  );

  const clientsWithRoles = clients.map((client) => {
    const roleTarget = client.stableDeviceId || client.endpointId;
    const role = sessionState.roleAssignments[roleTarget] ?? "Unassigned";
    const sensitivity = resolveSensitivityForRoleTarget(roleTarget, client.telemetrySensitivity);
    const cameraFacing = resolveCameraFacingForRoleTarget(roleTarget, client.cameraFacing);
    const distanceFallback = client.distanceMeters ?? defaultDistanceForRole(role);
    const distanceMeters = resolveDistanceForRoleTarget(roleTarget, distanceFallback);
    return {
      ...client,
      assignedRole: role,
      roleTarget,
      sensitivity,
      cameraFacing,
      distanceMeters,
    };
  });

  const monitoringElapsedMs = sessionElapsedMsNow();

  return {
    server: {
      name: "Sprint Sync Windows Backend",
      timestampIso: new Date().toISOString(),
      startedAtIso: new Date(startedAtMs).toISOString(),
      uptimeMs: Date.now() - startedAtMs,
      tcp: {
        host: config.tcpHost,
        port: config.tcpPort,
      },
      http: {
        host: config.httpHost,
        port: config.httpPort,
      },
    },
    stats: {
      connectedClients: clientsWithRoles.length,
      totalFrames: messageStats.totalFrames,
      messageFrames: messageStats.messageFrames,
      binaryFrames: messageStats.binaryFrames,
      parseErrors: messageStats.parseErrors,
      totalLapResults: lapHistory.length,
      knownTypes: messageStats.knownTypes,
    },
    session: {
      stage: sessionState.stage,
      monitoringActive: sessionState.monitoringActive,
      monitoringStartedAtMs: sessionState.monitoringStartedAtMs,
      monitoringStartedIso: sessionState.monitoringStartedIso,
      monitoringElapsedMs,
      runId: sessionState.runId,
      hostStartSensorNanos:
        Number.isFinite(sessionState.hostStartSensorNanos) ? sessionState.hostStartSensorNanos : null,
      hostStopSensorNanos:
        Number.isFinite(sessionState.hostStopSensorNanos) ? sessionState.hostStopSensorNanos : null,
      hostSplitMarks: sessionState.hostSplitMarks,
      roleOptions: computeRoleOptions(),
      roleAssignments: sessionState.roleAssignments,
      distanceAssignments: sessionState.deviceDistanceAssignments,
    },
    resultsExport: {
      directory: config.resultsDir,
      lastSavedFilePath: sessionState.lastSavedResultsFilePath,
      lastSavedAtIso: sessionState.lastSavedResultsAtIso,
    },
    clockDomainMapping: {
      implemented: clockDomainState.implemented,
      source: clockDomainState.source,
      samplesResponded: clockDomainState.samplesResponded,
      ignoredFrames: clockDomainState.ignoredFrames,
      lastEndpointId: clockDomainState.lastEndpointId,
      lastRequestAtIso: clockDomainState.lastRequestAtIso,
      lastResponseAtIso: clockDomainState.lastResponseAtIso,
      lastHostReceiveElapsedNanos: clockDomainState.lastHostReceiveElapsedNanos,
      lastHostSendElapsedNanos: clockDomainState.lastHostSendElapsedNanos,
      description:
        "Windows host now responds to binary clock-sync requests and acts as the active host elapsed time-domain source for connected clients.",
    },
    clients: clientsWithRoles,
    latestLapResults,
    lapHistory: [...lapHistory].reverse(),
    recentEvents: [...recentEvents].reverse(),
  };
}

function sendSocketMessage(socket: { readyState: number; send(data: string): void }, payload: unknown): void {
  if (socket.readyState === 1) {
    socket.send(JSON.stringify(payload));
  }
}

function sendTcpFrame(endpointId: string, frameKind: number, payloadBuffer: Buffer): boolean {
  const context = socketsByEndpoint.get(endpointId);
  if (!context || !context.socket || context.socket.destroyed) {
    return false;
  }

  const frame = Buffer.alloc(5 + payloadBuffer.length);
  frame.writeUInt8(frameKind, 0);
  frame.writeInt32BE(payloadBuffer.length, 1);
  payloadBuffer.copy(frame, 5);

  try {
    context.socket.write(frame);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown write error";
    pushEvent("warn", `Failed to send TCP frame to ${endpointId}: ${message}`, { endpointId });
    return false;
  }
}

function broadcast(payload: unknown): void {
  if (!websocketServer) {
    return;
  }
  const encoded = JSON.stringify(payload);
  for (const client of websocketServer.clients) {
    if (client.readyState === 1) {
      client.send(encoded);
    }
  }
}

let publishQueued = false;

function publishStateNow(): void {
  publishQueued = false;
  broadcast({ type: "state:update", payload: createSnapshot() });
}

function publishState() {
  if (publishQueued) {
    return;
  }

  publishQueued = true;
  queueMicrotask(() => {
    if (!publishQueued) {
      return;
    }

    publishStateNow();
  });
}

function shutdown(signal: NodeJS.Signals): void {
  pushEvent("info", `Shutting down after ${signal}`);
  publishStateNow();

  for (const context of socketsByEndpoint.values()) {
    context.socket.destroy();
  }
  stopAllClockResyncLoops();
  socketsByEndpoint.clear();

  tcpServer.close(() => {
    httpServer.close(() => {
      process.exit(0);
    });
  });

  setTimeout(() => process.exit(1), 2_000).unref();
}
