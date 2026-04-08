import type { Socket } from "node:net";

export type SessionStage = "SETUP" | "LOBBY" | "MONITORING";

export type RoleLabel =
  | "Unassigned"
  | "Start"
  | "Split 1"
  | "Split 2"
  | "Split 3"
  | "Split 4"
  | "Stop";

export type WireRole =
  | "unassigned"
  | "start"
  | "split"
  | "split1"
  | "split2"
  | "split3"
  | "split4"
  | "stop"
  | "display";

export type TriggerType = "start" | "split" | "stop";

export type CameraFacing = "rear" | "front";

export type EventLevel = "info" | "warn" | "error";

export interface TriggerSpec {
  triggerType: TriggerType;
  splitIndex: number;
}

export interface SessionSplitMark {
  roleLabel: RoleLabel;
  hostSensorNanos: number;
}

export interface SessionState {
  stage: SessionStage;
  monitoringActive: boolean;
  monitoringStartedAtMs: number | null;
  monitoringStartedIso: string | null;
  monitoringElapsedMs: number;
  runId: string | null;
  hostStartSensorNanos: number | null;
  hostStopSensorNanos: number | null;
  hostSplitMarks: SessionSplitMark[];
  roleAssignments: Record<string, RoleLabel>;
  deviceSensitivityAssignments: Record<string, number>;
  deviceCameraFacingAssignments: Record<string, CameraFacing>;
  deviceDistanceAssignments: Record<string, number>;
  lastSavedResultsFilePath: string | null;
  lastSavedResultsAtIso: string | null;
}

export interface ClientState {
  endpointId: string;
  remoteAddress: string;
  remotePort: number;
  connectedAtIso: string;
  lastSeenAtIso: string;
  stableDeviceId: string | null;
  deviceName: string | null;
  cameraFacing: CameraFacing;
  distanceMeters: number | null;
  telemetrySensitivity: number;
  telemetryLatencyMs: number | null;
  telemetryClockSynced: boolean;
  telemetryAnalysisWidth: number | null;
  telemetryAnalysisHeight: number | null;
  telemetryTimestampMillis: number | null;
}

export interface SocketContext {
  endpointId: string;
  socket: Socket;
  buffer: Buffer;
}

export interface ClockResyncLoopState {
  sampleCount: number;
  targetLatencyMs: number;
  attempts: number;
  timerHandle: NodeJS.Timeout | null;
}

export interface LapResult {
  id: string;
  endpointId: string;
  senderDeviceName: string;
  startedSensorNanos: number;
  stoppedSensorNanos: number;
  elapsedNanos: number;
  elapsedMillis: number;
  receivedAtIso: string;
}

export interface TimelineLapResult extends LapResult {
  source: "timeline";
  roleLabel: RoleLabel;
  lapElapsedNanos: number;
  lapElapsedMillis: number;
  distanceMeters: number | null;
  lapDistanceMeters: number | null;
  averageSpeedMps: number | null;
  lapSpeedMps: number | null;
}

export interface SavedResultSummary {
  fileName: string;
  filePath: string;
  resultName: string;
  athleteName: string | null;
  notes: string | null;
  runId: string | null;
  savedAtIso: string;
  resultCount: number;
  bestElapsedNanos: number | null;
}

export interface ServerEvent {
  id: string;
  timestampIso: string;
  level: EventLevel;
  message: string;
  [key: string]: unknown;
}

export interface MessageStats {
  totalFrames: number;
  messageFrames: number;
  binaryFrames: number;
  parseErrors: number;
  knownTypes: Record<string, number>;
}

export interface ClockDomainState {
  implemented: boolean;
  source: string;
  samplesResponded: number;
  ignoredFrames: number;
  lastEndpointId: string | null;
  lastRequestAtIso: string | null;
  lastResponseAtIso: string | null;
  lastHostReceiveElapsedNanos: string | null;
  lastHostSendElapsedNanos: string | null;
}

export type ClientsByEndpoint = Map<string, ClientState>;

export type SocketsByEndpoint = Map<string, SocketContext>;

export type LatestLapByEndpoint = Map<string, LapResult>;

export type ClockResyncLoopsByEndpoint = Map<string, ClockResyncLoopState>;