export type SessionStage = "SETUP" | "LOBBY" | "MONITORING";
export type RoleLabel =
  | "Unassigned"
  | "Start"
  | "Split 1"
  | "Split 2"
  | "Split 3"
  | "Split 4"
  | "Stop"
  | string;

export type CameraFacing = "rear" | "front" | string;
export type EventLevel = "info" | "warn" | "error" | string;

export interface SessionSplitMark {
  roleLabel?: RoleLabel;
  hostSensorNanos?: number;
  elapsedNanos?: number;
}

export interface SessionSnapshot {
  stage?: SessionStage;
  monitoringActive?: boolean;
  monitoringStartedAtMs?: number | null;
  monitoringElapsedMs?: number;
  hostStartSensorNanos?: number | null;
  hostStopSensorNanos?: number | null;
  hostSplitMarks?: SessionSplitMark[];
  roleOptions?: RoleLabel[];
  runId?: string | null;
}

export interface ClientSnapshot {
  endpointId?: string;
  roleTarget?: string;
  senderDeviceName?: string;
  stableDeviceId?: string;
  deviceName?: string;
  assignedRole?: RoleLabel;
  sensitivity?: number;
  distanceMeters?: number;
  cameraFacing?: CameraFacing;
  telemetryLatencyMs?: number | null;
  telemetryClockSynced?: boolean;
}

export interface LapResult {
  id?: string;
  senderDeviceName?: string;
  startedSensorNanos?: number;
  stoppedSensorNanos?: number;
  elapsedNanos?: number;
  timestampIso?: string;
}

export interface TimelineLapResult extends LapResult {
  roleLabel?: RoleLabel;
  lapElapsedNanos?: number;
  lapElapsedMillis?: number;
  distanceMeters?: number;
  lapDistanceMeters?: number;
  averageSpeedMps?: number;
  lapSpeedMps?: number;
}

export interface ServerEvent {
  id: string;
  timestampIso: string;
  level: EventLevel;
  message: string;
  [key: string]: unknown;
}

export interface ResultsExportSnapshot {
  lastSavedFilePath?: string;
  lastSavedAtIso?: string;
  fileName?: string;
}

export interface SnapshotStats {
  connectedClients?: number;
  totalFrames?: number;
  parseErrors?: number;
  knownTypes?: Record<string, number>;
}

export interface ServerTransportSnapshot {
  host?: string;
  port?: number;
}

export interface ServerSnapshot {
  tcp?: ServerTransportSnapshot;
  http?: ServerTransportSnapshot;
}

export interface ClockDomainMappingSnapshot {
  implemented?: boolean;
  description?: string;
}

export interface Snapshot {
  session?: SessionSnapshot;
  clients?: ClientSnapshot[];
  latestLapResults?: TimelineLapResult[];
  lapHistory?: LapResult[];
  recentEvents?: ServerEvent[];
  resultsExport?: ResultsExportSnapshot;
  stats?: SnapshotStats;
  server?: ServerSnapshot;
  clockDomainMapping?: ClockDomainMappingSnapshot;
}

export interface GenericOkResponse {
  ok: boolean;
}

export interface StartMonitoringResponse extends GenericOkResponse {
  runId: string;
}

export interface SaveResultsResponse extends GenericOkResponse {
  filePath: string;
  fileName: string;
  resultName: string;
  athleteName?: string | null;
  notes?: string | null;
  savedAtIso: string;
}

export interface SavedResultSummary {
  fileName: string;
  filePath: string;
  resultName: string;
  athleteName?: string | null;
  notes?: string | null;
  runId?: string | null;
  savedAtIso: string;
  resultCount: number;
  bestElapsedNanos?: number | null;
}

export interface ListResultsResponse extends GenericOkResponse {
  items: SavedResultSummary[];
}

export interface SavedResultsFilePayload {
  type: string;
  resultName: string;
  athleteName?: string | null;
  notes?: string | null;
  namingFormat?: string;
  exportedAtIso: string;
  exportedAtMs: number;
  runId?: string | null;
  session: SessionSnapshot;
  clients: ClientSnapshot[];
  latestLapResults: TimelineLapResult[];
  lapHistory: LapResult[];
  recentEvents: ServerEvent[];
}

export interface LoadResultResponse extends GenericOkResponse {
  fileName: string;
  filePath: string;
  payload: SavedResultsFilePayload;
}

export interface CompareResultsSeries {
  label: string;
  valuesSeconds: Array<number | null>;
  sourceFileName: string;
}

export interface CompareResultsPayload {
  athleteName?: string | null;
  labels: string[];
  series: CompareResultsSeries[];
}

export interface MonitoringPointRow {
  lap: TimelineLapResult;
  pointSpeedMps: number | null;
  accelerationMps2: number | null;
}

export interface SaveResultsRequest {
  name?: string;
  athleteName?: string;
  notes?: string;
}

export interface AssignRoleRequest {
  targetId: string;
  role: string;
}

export interface DeviceConfigRequest {
  targetId: string;
  sensitivity?: number;
  cameraFacing?: string;
  distanceMeters?: number;
}

export interface ResyncDeviceRequest {
  targetId: string;
  sampleCount?: number;
}

export interface CompareResultsRequest {
  fileNames: string[];
  athleteName?: string;
}

export type ControlPath =
  | "/api/control/start-monitoring"
  | "/api/control/stop-monitoring"
  | "/api/control/start-lobby"
  | "/api/control/reset-laps"
  | "/api/control/reset-run"
  | "/api/control/return-setup"
  | "/api/control/save-results"
  | "/api/control/assign-role"
  | "/api/control/device-config"
  | "/api/control/resync-device"
  | "/api/control/clear-events";
