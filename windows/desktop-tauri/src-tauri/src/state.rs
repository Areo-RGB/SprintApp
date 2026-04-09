use serde::{Deserialize, Serialize};
use specta::Type;
use std::collections::{BTreeMap, HashMap};
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::{mpsc, RwLock};

pub const EVENT_LIMIT: usize = 300;
pub const HISTORY_LIMIT: usize = 1_000;
pub const MAX_FRAME_BYTES: usize = 1_048_576;
pub const FRAME_KIND_MESSAGE: u8 = 1;
pub const FRAME_KIND_BINARY: u8 = 2;
pub const FRAME_KIND_TELEMETRY_BINARY: u8 = 3;

#[derive(Serialize, Deserialize, Clone, Debug, Type, PartialEq, Eq, Hash)]
pub enum SessionStage {
  #[serde(rename = "SETUP")]
  Setup,
  #[serde(rename = "LOBBY")]
  Lobby,
  #[serde(rename = "MONITORING")]
  Monitoring,
}

#[derive(Serialize, Deserialize, Clone, Debug, Type, PartialEq, Eq, Hash)]
pub enum RoleLabel {
  #[serde(rename = "Unassigned")]
  Unassigned,
  #[serde(rename = "Start")]
  Start,
  #[serde(rename = "Split 1")]
  Split1,
  #[serde(rename = "Split 2")]
  Split2,
  #[serde(rename = "Split 3")]
  Split3,
  #[serde(rename = "Split 4")]
  Split4,
  #[serde(rename = "Stop")]
  Stop,
}

impl RoleLabel {
  pub fn as_str(&self) -> &'static str {
    match self {
      RoleLabel::Unassigned => "Unassigned",
      RoleLabel::Start => "Start",
      RoleLabel::Split1 => "Split 1",
      RoleLabel::Split2 => "Split 2",
      RoleLabel::Split3 => "Split 3",
      RoleLabel::Split4 => "Split 4",
      RoleLabel::Stop => "Stop",
    }
  }

  pub fn from_label(value: &str) -> Option<Self> {
    match value.trim() {
      "Unassigned" => Some(RoleLabel::Unassigned),
      "Start" => Some(RoleLabel::Start),
      "Split 1" | "split1" | "split" => Some(RoleLabel::Split1),
      "Split 2" | "split2" => Some(RoleLabel::Split2),
      "Split 3" | "split3" => Some(RoleLabel::Split3),
      "Split 4" | "split4" => Some(RoleLabel::Split4),
      "Stop" | "stop" => Some(RoleLabel::Stop),
      _ => None,
    }
  }
}

#[derive(Serialize, Deserialize, Clone, Debug, Type, PartialEq, Eq, Hash)]
pub enum WireRole {
  #[serde(rename = "unassigned")]
  Unassigned,
  #[serde(rename = "start")]
  Start,
  #[serde(rename = "split")]
  Split,
  #[serde(rename = "split1")]
  Split1,
  #[serde(rename = "split2")]
  Split2,
  #[serde(rename = "split3")]
  Split3,
  #[serde(rename = "split4")]
  Split4,
  #[serde(rename = "stop")]
  Stop,
  #[serde(rename = "display")]
  Display,
}

impl WireRole {
  pub fn as_str(&self) -> &'static str {
    match self {
      WireRole::Unassigned => "unassigned",
      WireRole::Start => "start",
      WireRole::Split => "split",
      WireRole::Split1 => "split1",
      WireRole::Split2 => "split2",
      WireRole::Split3 => "split3",
      WireRole::Split4 => "split4",
      WireRole::Stop => "stop",
      WireRole::Display => "display",
    }
  }
}

impl From<u8> for WireRole {
  fn from(value: u8) -> Self {
    match value {
      1 => WireRole::Start,
      2 => WireRole::Split1,
      3 => WireRole::Split2,
      4 => WireRole::Split3,
      5 => WireRole::Split4,
      6 => WireRole::Stop,
      7 => WireRole::Display,
      _ => WireRole::Unassigned,
    }
  }
}

#[derive(Serialize, Deserialize, Clone, Debug, Type, PartialEq, Eq, Hash)]
pub enum TriggerType {
  #[serde(rename = "start")]
  Start,
  #[serde(rename = "split")]
  Split,
  #[serde(rename = "stop")]
  Stop,
}

#[derive(Serialize, Deserialize, Clone, Debug, Type, PartialEq, Eq, Hash)]
pub enum CameraFacing {
  #[serde(rename = "rear")]
  Rear,
  #[serde(rename = "front")]
  Front,
}

#[derive(Serialize, Deserialize, Clone, Debug, Type, PartialEq, Eq, Hash)]
pub enum EventLevel {
  #[serde(rename = "info")]
  Info,
  #[serde(rename = "warn")]
  Warn,
  #[serde(rename = "error")]
  Error,
}

#[derive(Serialize, Deserialize, Clone, Debug, Type, PartialEq, Eq, Hash)]
pub enum SessionDeviceRole {
  #[serde(rename = "UNASSIGNED")]
  Unassigned,
  #[serde(rename = "START")]
  Start,
  #[serde(rename = "SPLIT1")]
  Split1,
  #[serde(rename = "SPLIT2")]
  Split2,
  #[serde(rename = "SPLIT3")]
  Split3,
  #[serde(rename = "SPLIT4")]
  Split4,
  #[serde(rename = "STOP")]
  Stop,
  #[serde(rename = "DISPLAY")]
  Display,
}

impl From<u8> for SessionDeviceRole {
  fn from(value: u8) -> Self {
    match value {
      1 => SessionDeviceRole::Start,
      2 => SessionDeviceRole::Split1,
      3 => SessionDeviceRole::Split2,
      4 => SessionDeviceRole::Split3,
      5 => SessionDeviceRole::Split4,
      6 => SessionDeviceRole::Stop,
      7 => SessionDeviceRole::Display,
      _ => SessionDeviceRole::Unassigned,
    }
  }
}

#[derive(Serialize, Deserialize, Clone, Debug, Type)]
#[serde(rename_all = "camelCase")]
pub struct TriggerSpec {
  pub trigger_type: TriggerType,
  pub split_index: i32,
}

#[derive(Serialize, Deserialize, Clone, Debug, Type)]
#[serde(rename_all = "camelCase")]
pub struct SessionSplitMark {
  pub role_label: RoleLabel,
  pub host_sensor_nanos: i64,
}

#[derive(Serialize, Deserialize, Clone, Debug, Type)]
#[serde(rename_all = "camelCase")]
pub struct SessionState {
  pub stage: SessionStage,
  pub monitoring_active: bool,
  pub monitoring_started_at_ms: Option<i64>,
  pub monitoring_started_iso: Option<String>,
  pub monitoring_elapsed_ms: i64,
  pub run_id: Option<String>,
  pub host_start_sensor_nanos: Option<i64>,
  pub host_stop_sensor_nanos: Option<i64>,
  pub host_split_marks: Vec<SessionSplitMark>,
  pub role_assignments: HashMap<String, RoleLabel>,
  pub role_options: Vec<RoleLabel>,
  pub device_sensitivity_assignments: HashMap<String, i32>,
  pub device_camera_facing_assignments: HashMap<String, CameraFacing>,
  pub device_distance_assignments: HashMap<String, f64>,
  pub last_saved_results_file_path: Option<String>,
  pub last_saved_results_at_iso: Option<String>,
}

impl Default for SessionState {
  fn default() -> Self {
    Self {
      stage: SessionStage::Lobby,
      monitoring_active: false,
      monitoring_started_at_ms: None,
      monitoring_started_iso: None,
      monitoring_elapsed_ms: 0,
      run_id: None,
      host_start_sensor_nanos: None,
      host_stop_sensor_nanos: None,
      host_split_marks: Vec::new(),
      role_assignments: HashMap::new(),
      role_options: vec![RoleLabel::Unassigned, RoleLabel::Start, RoleLabel::Split1, RoleLabel::Stop],
      device_sensitivity_assignments: HashMap::new(),
      device_camera_facing_assignments: HashMap::new(),
      device_distance_assignments: HashMap::new(),
      last_saved_results_file_path: None,
      last_saved_results_at_iso: None,
    }
  }
}

#[derive(Serialize, Deserialize, Clone, Debug, Type)]
#[serde(rename_all = "camelCase")]
pub struct ClientState {
  pub endpoint_id: String,
  pub remote_address: String,
  pub remote_port: u16,
  pub connected_at_iso: String,
  pub last_seen_at_iso: String,
  pub stable_device_id: Option<String>,
  pub device_name: Option<String>,
  pub camera_facing: CameraFacing,
  pub distance_meters: Option<f64>,
  pub telemetry_sensitivity: i32,
  pub telemetry_latency_ms: Option<i32>,
  pub telemetry_clock_synced: bool,
  pub telemetry_analysis_width: Option<i32>,
  pub telemetry_analysis_height: Option<i32>,
  pub telemetry_timestamp_millis: Option<i64>,
  pub assigned_role: RoleLabel,
  pub role_target: String,
  pub sensitivity: i32,
}

impl ClientState {
  pub fn default_for_endpoint(endpoint_id: &str) -> Self {
    let now = chrono::Utc::now().to_rfc3339();
    Self {
      endpoint_id: endpoint_id.to_string(),
      remote_address: "unknown".to_string(),
      remote_port: 0,
      connected_at_iso: now.clone(),
      last_seen_at_iso: now,
      stable_device_id: None,
      device_name: None,
      camera_facing: CameraFacing::Rear,
      distance_meters: None,
      telemetry_sensitivity: 100,
      telemetry_latency_ms: None,
      telemetry_clock_synced: false,
      telemetry_analysis_width: None,
      telemetry_analysis_height: None,
      telemetry_timestamp_millis: None,
      assigned_role: RoleLabel::Unassigned,
      role_target: endpoint_id.to_string(),
      sensitivity: 100,
    }
  }
}

#[derive(Serialize, Deserialize, Clone, Debug, Type)]
#[serde(rename_all = "camelCase")]
pub struct SocketContext {
  pub endpoint_id: String,
  pub buffer: Vec<u8>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Type)]
#[serde(rename_all = "camelCase")]
pub struct ClockResyncLoopState {
  pub sample_count: i32,
  pub target_latency_ms: i32,
  pub attempts: i32,
  pub timer_active: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug, Type)]
#[serde(rename_all = "camelCase")]
pub struct LapResult {
  pub id: String,
  pub endpoint_id: String,
  pub sender_device_name: String,
  pub started_sensor_nanos: i64,
  pub stopped_sensor_nanos: i64,
  pub elapsed_nanos: i64,
  pub elapsed_millis: i64,
  pub received_at_iso: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, Type)]
#[serde(rename_all = "camelCase")]
pub struct TimelineLapResult {
  #[serde(flatten)]
  pub base: LapResult,
  pub source: String,
  pub role_label: RoleLabel,
  pub lap_elapsed_nanos: i64,
  pub lap_elapsed_millis: i64,
  pub distance_meters: Option<f64>,
  pub lap_distance_meters: Option<f64>,
  pub average_speed_mps: Option<f64>,
  pub lap_speed_mps: Option<f64>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Type)]
#[serde(rename_all = "camelCase")]
pub struct SavedResultSummary {
  pub file_name: String,
  pub file_path: String,
  pub result_name: String,
  pub athlete_name: Option<String>,
  pub notes: Option<String>,
  pub run_id: Option<String>,
  pub saved_at_iso: String,
  pub result_count: usize,
  pub best_elapsed_nanos: Option<i64>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Type)]
#[serde(rename_all = "camelCase")]
pub struct ServerEvent {
  pub id: String,
  pub timestamp_iso: String,
  pub level: EventLevel,
  pub message: String,
  #[serde(flatten)]
  pub details: BTreeMap<String, serde_json::Value>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Type)]
#[serde(rename_all = "camelCase")]
pub struct MessageStats {
  pub total_frames: u64,
  pub message_frames: u64,
  pub binary_frames: u64,
  pub parse_errors: u64,
  pub known_types: HashMap<String, u64>,
}

impl Default for MessageStats {
  fn default() -> Self {
    Self {
      total_frames: 0,
      message_frames: 0,
      binary_frames: 0,
      parse_errors: 0,
      known_types: HashMap::new(),
    }
  }
}

#[derive(Serialize, Deserialize, Clone, Debug, Type)]
#[serde(rename_all = "camelCase")]
pub struct ClockDomainState {
  pub implemented: bool,
  pub source: String,
  pub samples_responded: u64,
  pub ignored_frames: u64,
  pub last_endpoint_id: Option<String>,
  pub last_request_at_iso: Option<String>,
  pub last_response_at_iso: Option<String>,
  pub last_host_receive_elapsed_nanos: Option<String>,
  pub last_host_send_elapsed_nanos: Option<String>,
}

impl Default for ClockDomainState {
  fn default() -> Self {
    Self {
      implemented: true,
      source: "windows_monotonic_elapsed".to_string(),
      samples_responded: 0,
      ignored_frames: 0,
      last_endpoint_id: None,
      last_request_at_iso: None,
      last_response_at_iso: None,
      last_host_receive_elapsed_nanos: None,
      last_host_send_elapsed_nanos: None,
    }
  }
}

#[derive(Serialize, Deserialize, Clone, Debug, Type)]
#[serde(rename_all = "camelCase")]
pub struct ServerTransportSnapshot {
  pub host: String,
  pub port: u16,
}

#[derive(Serialize, Deserialize, Clone, Debug, Type)]
#[serde(rename_all = "camelCase")]
pub struct ServerSnapshot {
  pub name: String,
  pub timestamp_iso: String,
  pub started_at_iso: String,
  pub uptime_ms: i64,
  pub tcp: ServerTransportSnapshot,
  pub http: ServerTransportSnapshot,
}

#[derive(Serialize, Deserialize, Clone, Debug, Type)]
#[serde(rename_all = "camelCase")]
pub struct StatsSnapshot {
  pub connected_clients: usize,
  pub total_frames: u64,
  pub message_frames: u64,
  pub binary_frames: u64,
  pub parse_errors: u64,
  pub total_lap_results: usize,
  pub known_types: HashMap<String, u64>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Type)]
#[serde(rename_all = "camelCase")]
pub struct ResultsExportState {
  pub directory: String,
  pub last_saved_file_path: Option<String>,
  pub last_saved_at_iso: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Type)]
#[serde(rename_all = "camelCase")]
pub struct ClockDomainMappingSnapshot {
  pub implemented: bool,
  pub source: String,
  pub samples_responded: u64,
  pub ignored_frames: u64,
  pub last_endpoint_id: Option<String>,
  pub last_request_at_iso: Option<String>,
  pub last_response_at_iso: Option<String>,
  pub last_host_receive_elapsed_nanos: Option<String>,
  pub last_host_send_elapsed_nanos: Option<String>,
  pub description: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, Type)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
  pub server: ServerSnapshot,
  pub stats: StatsSnapshot,
  pub session: SessionState,
  pub results_export: ResultsExportState,
  pub clock_domain_mapping: ClockDomainMappingSnapshot,
  pub clients: Vec<ClientState>,
  pub latest_lap_results: Vec<TimelineLapResult>,
  pub lap_history: Vec<LapResult>,
  pub recent_events: Vec<ServerEvent>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Type)]
#[serde(rename_all = "camelCase")]
pub struct ProtocolDevice {
  pub endpoint_id: String,
  pub id: String,
  pub name: String,
  pub role_label: RoleLabel,
  pub camera_facing: CameraFacing,
}

#[derive(Serialize, Deserialize, Clone, Debug, Type)]
#[serde(rename_all = "camelCase")]
pub struct ProtocolTimelineSnapshot {
  pub host_start_sensor_nanos: Option<i64>,
  pub host_stop_sensor_nanos: Option<i64>,
  pub host_split_marks: Vec<ProtocolSplitMark>,
  pub host_split_sensor_nanos: Vec<i64>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Type)]
#[serde(rename_all = "camelCase")]
pub struct ProtocolSplitMark {
  pub role: WireRole,
  pub host_sensor_nanos: i64,
}

#[derive(Serialize, Deserialize, Clone, Debug, Type)]
#[serde(rename_all = "camelCase")]
pub struct ProtocolSnapshot {
  pub r#type: String,
  pub stage: String,
  pub monitoring_active: bool,
  pub devices: Vec<ProtocolSnapshotDevice>,
  pub timeline: ProtocolTimelineSnapshot,
  pub run_id: Option<String>,
  pub host_sensor_minus_elapsed_nanos: i64,
  pub host_gps_utc_offset_nanos: Option<i64>,
  pub host_gps_fix_age_nanos: Option<i64>,
  pub self_device_id: Option<String>,
  pub anchor_device_id: Option<String>,
  pub anchor_state: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Type)]
#[serde(rename_all = "camelCase")]
pub struct ProtocolSnapshotDevice {
  pub id: String,
  pub name: String,
  pub role: WireRole,
  pub camera_facing: CameraFacing,
  pub is_local: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug, Type)]
#[serde(rename_all = "camelCase")]
pub struct TimelineSnapshotPayload {
  pub r#type: String,
  pub host_start_sensor_nanos: Option<i64>,
  pub host_stop_sensor_nanos: Option<i64>,
  pub host_split_marks: Vec<ProtocolSplitMark>,
  pub host_split_sensor_nanos: Vec<i64>,
  pub sent_elapsed_nanos: i64,
}

#[derive(Serialize, Deserialize, Clone, Debug, Type)]
#[serde(rename_all = "camelCase")]
pub struct SavedResultsFilePayload {
  pub r#type: String,
  pub result_name: String,
  pub athlete_name: Option<String>,
  pub notes: Option<String>,
  pub naming_format: String,
  pub exported_at_iso: String,
  pub exported_at_ms: i64,
  pub run_id: Option<String>,
  pub session: SessionState,
  pub clients: Vec<ClientState>,
  pub latest_lap_results: Vec<TimelineLapResult>,
  pub lap_history: Vec<LapResult>,
  pub recent_events: Vec<ServerEvent>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Type)]
#[serde(rename_all = "camelCase")]
pub struct LoadedSavedResultFile {
  pub file_name: String,
  pub file_path: String,
  pub payload: SavedResultsFilePayload,
}

#[derive(Serialize, Deserialize, Clone, Debug, Type)]
#[serde(rename_all = "camelCase")]
pub struct CompareResultsSeries {
  pub label: String,
  pub values_seconds: Vec<Option<f64>>,
  pub source_file_name: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, Type)]
#[serde(rename_all = "camelCase")]
pub struct CompareResultsPayload {
  pub athlete_name: Option<String>,
  pub labels: Vec<String>,
  pub series: Vec<CompareResultsSeries>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Type)]
#[serde(rename_all = "camelCase")]
pub struct DeviceIdentityMessage {
  pub stable_device_id: String,
  pub device_name: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, Type)]
#[serde(rename_all = "camelCase")]
pub struct DeviceTelemetryMessage {
  pub stable_device_id: String,
  pub role: WireRole,
  pub sensitivity: i32,
  pub latency_ms: Option<i32>,
  pub clock_synced: bool,
  pub analysis_width: Option<i32>,
  pub analysis_height: Option<i32>,
  pub timestamp_millis: i64,
}

#[derive(Serialize, Deserialize, Clone, Debug, Type)]
#[serde(rename_all = "camelCase")]
pub struct LapResultMessage {
  pub sender_device_name: String,
  pub started_sensor_nanos: i64,
  pub stopped_sensor_nanos: i64,
}

#[derive(Serialize, Deserialize, Clone, Debug, Type)]
#[serde(rename_all = "camelCase")]
pub struct TriggerRequestMessage {
  pub role: WireRole,
  pub trigger_sensor_nanos: Option<i64>,
  pub mapped_host_sensor_nanos: Option<i64>,
  pub source_device_id: Option<String>,
  pub source_elapsed_nanos: Option<i64>,
  pub mapped_anchor_elapsed_nanos: Option<i64>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Type)]
#[serde(rename_all = "camelCase")]
pub struct SessionTriggerMessage {
  pub trigger_type: String,
  pub split_index: Option<i32>,
  pub trigger_sensor_nanos: Option<i64>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Type)]
#[serde(rename_all = "camelCase")]
pub struct TriggerRefinementMessage {
  pub run_id: String,
  pub role: WireRole,
  pub provisional_host_sensor_nanos: i64,
  pub refined_host_sensor_nanos: i64,
}

#[derive(Clone, Debug)]
pub struct AppConfig {
  pub tcp_host: String,
  pub tcp_port: u16,
  pub http_host: String,
  pub http_port: u16,
  pub results_dir: PathBuf,
}

#[derive(Clone, Debug)]
pub struct AppState {
  pub config: AppConfig,
  pub started_at_ms: i64,
  pub session_state: SessionState,
  pub clients_by_endpoint: HashMap<String, ClientState>,
  pub sockets_by_endpoint: HashMap<String, SocketContext>,
  pub latest_lap_by_endpoint: HashMap<String, LapResult>,
  pub clock_resync_loops_by_endpoint: HashMap<String, ClockResyncLoopState>,
  pub lap_history: Vec<LapResult>,
  pub recent_events: Vec<ServerEvent>,
  pub message_stats: MessageStats,
  pub clock_domain_state: ClockDomainState,
  pub next_event_id: u64,
  pub next_lap_id: u64,
  pub socket_writers: HashMap<String, mpsc::UnboundedSender<Vec<u8>>>,
}

impl AppState {
  pub fn new(config: AppConfig) -> Self {
    Self {
      config,
      started_at_ms: chrono::Utc::now().timestamp_millis(),
      session_state: SessionState::default(),
      clients_by_endpoint: HashMap::new(),
      sockets_by_endpoint: HashMap::new(),
      latest_lap_by_endpoint: HashMap::new(),
      clock_resync_loops_by_endpoint: HashMap::new(),
      lap_history: Vec::new(),
      recent_events: Vec::new(),
      message_stats: MessageStats::default(),
      clock_domain_state: ClockDomainState::default(),
      next_event_id: 1,
      next_lap_id: 1,
      socket_writers: HashMap::new(),
    }
  }
}

pub type SharedAppState = Arc<RwLock<AppState>>;

pub fn role_order() -> Vec<RoleLabel> {
  vec![
    RoleLabel::Unassigned,
    RoleLabel::Start,
    RoleLabel::Split1,
    RoleLabel::Split2,
    RoleLabel::Split3,
    RoleLabel::Split4,
    RoleLabel::Stop,
  ]
}

pub fn role_order_index(role_label: &RoleLabel) -> usize {
  role_order()
    .iter()
    .position(|candidate| candidate == role_label)
    .unwrap_or(usize::MAX)
}

pub fn compute_progressive_role_options(assigned_roles: &[RoleLabel]) -> Vec<RoleLabel> {
  let mut options = vec![RoleLabel::Unassigned, RoleLabel::Start];
  let assigned: std::collections::HashSet<RoleLabel> = assigned_roles.iter().cloned().collect();
  let splits = [RoleLabel::Split1, RoleLabel::Split2, RoleLabel::Split3, RoleLabel::Split4];

  for split in splits {
    options.push(split.clone());
    if !assigned.contains(&split) {
      break;
    }
  }

  if !options.iter().any(|value| *value == RoleLabel::Stop) {
    options.push(RoleLabel::Stop);
  }

  for role in assigned_roles {
    if !options.iter().any(|option| option == role) {
      options.push(role.clone());
    }
  }

  options.sort_by_key(role_order_index);
  options.dedup();
  options
}
