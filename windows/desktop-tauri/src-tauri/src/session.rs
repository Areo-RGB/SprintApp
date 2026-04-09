use crate::clock_sync;
use crate::events::push_event;
use crate::state::{
  compute_progressive_role_options, AppState, CameraFacing, ClientState, ClockDomainMappingSnapshot, DeviceIdentityMessage,
  DeviceTelemetryMessage, EventLevel, LapResult, LapResultMessage, MessageStats, ProtocolDevice, ProtocolSnapshot,
  ProtocolSnapshotDevice, ProtocolSplitMark, ProtocolTimelineSnapshot, ResultsExportState, RoleLabel, ServerSnapshot,
  ServerTransportSnapshot, SessionSplitMark, SessionStage, SessionState,
  SessionTriggerMessage, Snapshot, StatsSnapshot, TimelineLapResult, TimelineSnapshotPayload, TriggerRefinementMessage,
  TriggerRequestMessage, TriggerSpec, TriggerType, WireRole,
};
use serde_json::json;
use std::collections::{BTreeMap, HashMap, HashSet};

const SPLIT_ROLE_OPTIONS: [RoleLabel; 4] = [RoleLabel::Split1, RoleLabel::Split2, RoleLabel::Split3, RoleLabel::Split4];
const AUTO_ASSIGN_ROLE_SEQUENCE: [RoleLabel; 6] = [
  RoleLabel::Start,
  RoleLabel::Stop,
  RoleLabel::Split1,
  RoleLabel::Split2,
  RoleLabel::Split3,
  RoleLabel::Split4,
];
const STOP_ROLE_DEFAULT_DISTANCE_METERS: f64 = 20.0;

fn now_iso() -> String {
  chrono::Utc::now().to_rfc3339()
}

fn event_details(values: &[(&str, serde_json::Value)]) -> BTreeMap<String, serde_json::Value> {
  let mut details = BTreeMap::new();
  for (key, value) in values {
    details.insert((*key).to_string(), value.clone());
  }
  details
}

pub fn reset_run_data(state: &mut AppState) {
  state.latest_lap_by_endpoint.clear();
  state.lap_history.clear();
}

pub fn upsert_client<F: FnOnce(&mut ClientState)>(state: &mut AppState, endpoint_id: &str, patch: F) {
  let entry = state
    .clients_by_endpoint
    .entry(endpoint_id.to_string())
    .or_insert_with(|| ClientState::default_for_endpoint(endpoint_id));
  patch(entry);
  entry.last_seen_at_iso = now_iso();
}

pub fn increment_message_type(stats: &mut MessageStats, type_name: &str) {
  let key = type_name.trim();
  if key.is_empty() {
    return;
  }
  *stats.known_types.entry(key.to_string()).or_insert(0) += 1;
}

pub fn normalize_camera_facing(raw_camera_facing: &str) -> Option<CameraFacing> {
  match raw_camera_facing.trim().to_lowercase().as_str() {
    "rear" => Some(CameraFacing::Rear),
    "front" => Some(CameraFacing::Front),
    _ => None,
  }
}

pub fn normalize_distance_meters(raw_distance_meters: f64) -> Option<f64> {
  if !raw_distance_meters.is_finite() || raw_distance_meters < 0.0 || raw_distance_meters > 100_000.0 {
    return None;
  }
  Some((raw_distance_meters * 1000.0).round() / 1000.0)
}

pub fn canonical_target_id(state: &AppState, target_id: &str) -> String {
  if let Some(client) = state.clients_by_endpoint.get(target_id) {
    if let Some(stable) = &client.stable_device_id {
      return stable.clone();
    }
  }

  for client in state.clients_by_endpoint.values() {
    if client.stable_device_id.as_deref() == Some(target_id) {
      return target_id.to_string();
    }
  }

  target_id.to_string()
}

pub fn resolve_endpoint_ids_for_target_id(state: &AppState, target_id: &str) -> Vec<String> {
  let mut endpoints = Vec::new();
  for client in state.clients_by_endpoint.values() {
    if client.endpoint_id == target_id || client.stable_device_id.as_deref() == Some(target_id) {
      endpoints.push(client.endpoint_id.clone());
    }
  }
  endpoints
}

pub fn resolve_camera_facing_for_role_target(state: &AppState, role_target: Option<&str>, fallback: CameraFacing) -> CameraFacing {
  if let Some(target) = role_target {
    if let Some(configured) = state.session_state.device_camera_facing_assignments.get(target) {
      return configured.clone();
    }
  }
  fallback
}

pub fn resolve_sensitivity_for_role_target(state: &AppState, role_target: Option<&str>, fallback: i32) -> i32 {
  if let Some(target) = role_target {
    if let Some(configured) = state.session_state.device_sensitivity_assignments.get(target) {
      if *configured >= 1 && *configured <= 100 {
        return *configured;
      }
    }
  }
  if (1..=100).contains(&fallback) {
    fallback
  } else {
    100
  }
}

pub fn resolve_distance_for_role_target(state: &AppState, role_target: Option<&str>, fallback: Option<f64>) -> Option<f64> {
  if let Some(target) = role_target {
    if let Some(configured) = state.session_state.device_distance_assignments.get(target) {
      return normalize_distance_meters(*configured);
    }
  }
  fallback.and_then(normalize_distance_meters)
}

pub fn default_distance_for_role(role: &RoleLabel) -> Option<f64> {
  if matches!(role, RoleLabel::Stop) {
    Some(STOP_ROLE_DEFAULT_DISTANCE_METERS)
  } else {
    None
  }
}

pub fn apply_default_distance_for_role(state: &mut AppState, target_id: &str, role: &RoleLabel) {
  let Some(default_distance) = default_distance_for_role(role) else {
    return;
  };
  let Some(normalized) = normalize_distance_meters(default_distance) else {
    return;
  };

  state
    .session_state
    .device_distance_assignments
    .insert(target_id.to_string(), normalized);

  let endpoints = resolve_endpoint_ids_for_target_id(state, target_id);
  for endpoint_id in endpoints {
    upsert_client(state, &endpoint_id, |client| {
      client.distance_meters = Some(normalized);
    });
  }
}

pub fn migrate_assignment_key<T: Clone>(target_map: &mut HashMap<String, T>, old_key: &str, new_key: &str) {
  if old_key.is_empty() || new_key.is_empty() || old_key == new_key {
    return;
  }
  let Some(existing_value) = target_map.get(old_key).cloned() else {
    return;
  };

  target_map.entry(new_key.to_string()).or_insert(existing_value);
  target_map.remove(old_key);
}

pub fn role_label_to_wire_role(role_label: &RoleLabel) -> WireRole {
  match role_label {
    RoleLabel::Start => WireRole::Start,
    RoleLabel::Split1 => WireRole::Split1,
    RoleLabel::Split2 => WireRole::Split2,
    RoleLabel::Split3 => WireRole::Split3,
    RoleLabel::Split4 => WireRole::Split4,
    RoleLabel::Stop => WireRole::Stop,
    RoleLabel::Unassigned => WireRole::Unassigned,
  }
}

pub fn wire_role_to_role_label(raw_role: &WireRole) -> Option<RoleLabel> {
  match raw_role {
    WireRole::Start => Some(RoleLabel::Start),
    WireRole::Split | WireRole::Split1 => Some(RoleLabel::Split1),
    WireRole::Split2 => Some(RoleLabel::Split2),
    WireRole::Split3 => Some(RoleLabel::Split3),
    WireRole::Split4 => Some(RoleLabel::Split4),
    WireRole::Stop => Some(RoleLabel::Stop),
    WireRole::Unassigned => Some(RoleLabel::Unassigned),
    WireRole::Display => None,
  }
}

pub fn trigger_spec_for_role(role_label: &RoleLabel) -> Option<TriggerSpec> {
  match role_label {
    RoleLabel::Start => Some(TriggerSpec {
      trigger_type: TriggerType::Start,
      split_index: 0,
    }),
    RoleLabel::Split1 => Some(TriggerSpec {
      trigger_type: TriggerType::Split,
      split_index: 1,
    }),
    RoleLabel::Split2 => Some(TriggerSpec {
      trigger_type: TriggerType::Split,
      split_index: 2,
    }),
    RoleLabel::Split3 => Some(TriggerSpec {
      trigger_type: TriggerType::Split,
      split_index: 3,
    }),
    RoleLabel::Split4 => Some(TriggerSpec {
      trigger_type: TriggerType::Split,
      split_index: 4,
    }),
    RoleLabel::Stop => Some(TriggerSpec {
      trigger_type: TriggerType::Stop,
      split_index: 0,
    }),
    RoleLabel::Unassigned => None,
  }
}

pub fn trigger_spec_for_type(trigger_type: &str, split_index: Option<i32>) -> Option<TriggerSpec> {
  let normalized = trigger_type.trim().to_lowercase();
  match normalized.as_str() {
    "start" => Some(TriggerSpec {
      trigger_type: TriggerType::Start,
      split_index: 0,
    }),
    "stop" => Some(TriggerSpec {
      trigger_type: TriggerType::Stop,
      split_index: 0,
    }),
    "split" => {
      let split = split_index.unwrap_or(0);
      if !(1..=4).contains(&split) {
        return None;
      }
      Some(TriggerSpec {
        trigger_type: TriggerType::Split,
        split_index: split,
      })
    }
    _ => None,
  }
}

pub fn trigger_spec_from_control_payload(
  role: Option<&str>,
  trigger_type: Option<&str>,
  split_index: Option<i32>,
) -> Option<TriggerSpec> {
  if let Some(explicit_role) = role {
    if let Some(role_label) = RoleLabel::from_label(explicit_role) {
      if let Some(spec) = trigger_spec_for_role(&role_label) {
        return Some(spec);
      }
    }
  }

  trigger_spec_for_type(trigger_type.unwrap_or(""), split_index)
}

pub fn trigger_label_for_spec(trigger_spec: &TriggerSpec) -> String {
  match trigger_spec.trigger_type {
    TriggerType::Start => "Start".to_string(),
    TriggerType::Stop => "Stop".to_string(),
    TriggerType::Split => format!("Split {}", trigger_spec.split_index),
  }
}

pub fn apply_trigger_to_host_timeline(state: &mut AppState, trigger_spec: &TriggerSpec, trigger_sensor_nanos: i64) -> bool {
  let normalized = trigger_sensor_nanos;

  match trigger_spec.trigger_type {
    TriggerType::Start => {
      if state.session_state.host_start_sensor_nanos.is_some() {
        return false;
      }
      state.session_state.host_start_sensor_nanos = Some(normalized);
      true
    }
    TriggerType::Stop => {
      if state.session_state.host_start_sensor_nanos.is_none() || state.session_state.host_stop_sensor_nanos.is_some() {
        return false;
      }
      state.session_state.host_stop_sensor_nanos = Some(normalized);
      true
    }
    TriggerType::Split => {
      if state.session_state.host_start_sensor_nanos.is_none() || state.session_state.host_stop_sensor_nanos.is_some() {
        return false;
      }

      if !(1..=4).contains(&trigger_spec.split_index) {
        return false;
      }

      let role_label = match trigger_spec.split_index {
        1 => RoleLabel::Split1,
        2 => RoleLabel::Split2,
        3 => RoleLabel::Split3,
        4 => RoleLabel::Split4,
        _ => return false,
      };

      if state
        .session_state
        .host_split_marks
        .iter()
        .any(|split| split.role_label == role_label)
      {
        return false;
      }

      let previous_marker = state
        .session_state
        .host_split_marks
        .last()
        .map(|split| split.host_sensor_nanos)
        .or(state.session_state.host_start_sensor_nanos)
        .unwrap_or_default();

      if normalized <= previous_marker {
        return false;
      }

      state.session_state.host_split_marks.push(SessionSplitMark {
        role_label,
        host_sensor_nanos: normalized,
      });
      true
    }
  }
}

pub fn apply_trigger_refinement_to_host_timeline(
  state: &mut AppState,
  role_label: &RoleLabel,
  provisional_host_sensor_nanos: i64,
  refined_host_sensor_nanos: i64,
) -> bool {
  if refined_host_sensor_nanos <= 0 {
    return false;
  }

  match role_label {
    RoleLabel::Start => {
      let Some(current_start) = state.session_state.host_start_sensor_nanos else {
        return false;
      };
      if current_start != provisional_host_sensor_nanos {
        return false;
      }

      let earliest_future = state
        .session_state
        .host_split_marks
        .first()
        .map(|split| split.host_sensor_nanos)
        .or(state.session_state.host_stop_sensor_nanos);
      if let Some(future_marker) = earliest_future {
        if refined_host_sensor_nanos >= future_marker {
          return false;
        }
      }

      state.session_state.host_start_sensor_nanos = Some(refined_host_sensor_nanos);
      true
    }
    RoleLabel::Stop => {
      let Some(current_stop) = state.session_state.host_stop_sensor_nanos else {
        return false;
      };
      if current_stop != provisional_host_sensor_nanos {
        return false;
      }

      let previous_marker = state
        .session_state
        .host_split_marks
        .last()
        .map(|split| split.host_sensor_nanos)
        .or(state.session_state.host_start_sensor_nanos);
      let Some(previous) = previous_marker else {
        return false;
      };
      if refined_host_sensor_nanos <= previous {
        return false;
      }

      state.session_state.host_stop_sensor_nanos = Some(refined_host_sensor_nanos);
      true
    }
    RoleLabel::Split1 | RoleLabel::Split2 | RoleLabel::Split3 | RoleLabel::Split4 => {
      let Some(index) = state
        .session_state
        .host_split_marks
        .iter()
        .position(|mark| mark.role_label == *role_label)
      else {
        return false;
      };

      if state.session_state.host_split_marks[index].host_sensor_nanos != provisional_host_sensor_nanos {
        return false;
      }

      let previous_marker = if index > 0 {
        Some(state.session_state.host_split_marks[index - 1].host_sensor_nanos)
      } else {
        state.session_state.host_start_sensor_nanos
      };
      let Some(previous) = previous_marker else {
        return false;
      };
      if refined_host_sensor_nanos <= previous {
        return false;
      }

      let next_marker = if index + 1 < state.session_state.host_split_marks.len() {
        Some(state.session_state.host_split_marks[index + 1].host_sensor_nanos)
      } else {
        state.session_state.host_stop_sensor_nanos
      };
      if let Some(next) = next_marker {
        if refined_host_sensor_nanos >= next {
          return false;
        }
      }

      state.session_state.host_split_marks[index].host_sensor_nanos = refined_host_sensor_nanos;
      true
    }
    RoleLabel::Unassigned => false,
  }
}

fn role_target_for_role(state: &AppState, role_label: &RoleLabel) -> Option<String> {
  for (target_id, assigned_role) in &state.session_state.role_assignments {
    if assigned_role == role_label {
      return Some(target_id.clone());
    }
  }
  None
}

fn client_for_role_target<'a>(state: &'a AppState, role_target: Option<&str>) -> Option<&'a ClientState> {
  let Some(target_id) = role_target else {
    return None;
  };

  state
    .clients_by_endpoint
    .values()
    .find(|client| client.endpoint_id == target_id || client.stable_device_id.as_deref() == Some(target_id))
}

fn compute_speed_mps(distance_meters: Option<f64>, elapsed_nanos: i64) -> Option<f64> {
  let distance = distance_meters?;
  if !distance.is_finite() || distance < 0.0 || elapsed_nanos <= 0 {
    return None;
  }
  let mps = distance / (elapsed_nanos as f64 / 1_000_000_000.0);
  if !mps.is_finite() || mps < 0.0 {
    return None;
  }
  Some((mps * 1000.0).round() / 1000.0)
}

pub fn create_timeline_lap_results(state: &AppState) -> Vec<TimelineLapResult> {
  let Some(start_sensor_nanos) = state.session_state.host_start_sensor_nanos else {
    return Vec::new();
  };

  let mut markers: Vec<(RoleLabel, i64)> = state
    .session_state
    .host_split_marks
    .iter()
    .map(|mark| (mark.role_label.clone(), mark.host_sensor_nanos))
    .collect();

  if let Some(stop_sensor_nanos) = state.session_state.host_stop_sensor_nanos {
    markers.push((RoleLabel::Stop, stop_sensor_nanos));
  }

  if markers.is_empty() {
    return Vec::new();
  }

  markers.sort_by_key(|(_, nanos)| *nanos);

  let start_target = role_target_for_role(state, &RoleLabel::Start);
  let mut previous_sensor_nanos = start_sensor_nanos;
  let mut previous_distance_meters = resolve_distance_for_role_target(state, start_target.as_deref(), Some(0.0)).unwrap_or(0.0);

  let mut rows = Vec::new();
  for (role_label, marker_nanos) in markers {
    let elapsed_nanos = marker_nanos - start_sensor_nanos;
    let lap_elapsed_nanos = marker_nanos - previous_sensor_nanos;
    if elapsed_nanos <= 0 || lap_elapsed_nanos <= 0 {
      continue;
    }

    let role_target = role_target_for_role(state, &role_label);
    let client = client_for_role_target(state, role_target.as_deref());
    let distance_fallback = client.and_then(|entry| entry.distance_meters).or_else(|| default_distance_for_role(&role_label));
    let distance_meters = resolve_distance_for_role_target(state, role_target.as_deref(), distance_fallback);

    let mut lap_distance_meters: Option<f64> = None;
    if let Some(distance) = distance_meters {
      lap_distance_meters = normalize_distance_meters(distance - previous_distance_meters);
    }

    let average_speed_mps = compute_speed_mps(distance_meters, elapsed_nanos);
    let lap_speed_mps = compute_speed_mps(lap_distance_meters, lap_elapsed_nanos);

    let role_segment = role_label.as_str().to_lowercase().replace(' ', "-");
    let base = LapResult {
      id: format!(
        "timeline-{}-{}",
        state.session_state.run_id.as_deref().unwrap_or("run"),
        role_segment
      ),
      endpoint_id: client
        .map(|entry| entry.endpoint_id.clone())
        .or_else(|| role_target.clone())
        .unwrap_or_else(|| format!("role:{role_segment}")),
      sender_device_name: client
        .and_then(|entry| entry.device_name.clone())
        .or(role_target.clone())
        .unwrap_or_else(|| role_label.as_str().to_string()),
      started_sensor_nanos: start_sensor_nanos,
      stopped_sensor_nanos: marker_nanos,
      elapsed_nanos,
      elapsed_millis: (elapsed_nanos as f64 / 1_000_000.0).round() as i64,
      received_at_iso: now_iso(),
    };

    rows.push(TimelineLapResult {
      base,
      source: "timeline".to_string(),
      role_label: role_label.clone(),
      lap_elapsed_nanos,
      lap_elapsed_millis: (lap_elapsed_nanos as f64 / 1_000_000.0).round() as i64,
      distance_meters,
      lap_distance_meters,
      average_speed_mps,
      lap_speed_mps,
    });

    previous_sensor_nanos = marker_nanos;
    if let Some(distance) = distance_meters {
      previous_distance_meters = distance;
    }
  }

  rows.sort_by_key(|entry| entry.base.elapsed_nanos);
  rows
}

pub fn session_elapsed_ms_now(session: &SessionState) -> i64 {
  if session.monitoring_active {
    if let Some(started_at_ms) = session.monitoring_started_at_ms {
      return (chrono::Utc::now().timestamp_millis() - started_at_ms).max(0);
    }
  }
  session.monitoring_elapsed_ms.max(0)
}

pub fn protocol_devices_with_roles(state: &AppState) -> Vec<ProtocolDevice> {
  let mut clients: Vec<ClientState> = state.clients_by_endpoint.values().cloned().collect();
  clients.sort_by(|left, right| left.connected_at_iso.cmp(&right.connected_at_iso));

  clients
    .into_iter()
    .map(|client| {
      let device_id = client
        .stable_device_id
        .clone()
        .unwrap_or_else(|| client.endpoint_id.clone());
      let fallback_role = state
        .session_state
        .role_assignments
        .get(&client.endpoint_id)
        .cloned()
        .unwrap_or(RoleLabel::Unassigned);
      let assigned_role = state
        .session_state
        .role_assignments
        .get(&device_id)
        .cloned()
        .unwrap_or(fallback_role);
      let camera_facing = resolve_camera_facing_for_role_target(state, Some(&device_id), client.camera_facing.clone());

      ProtocolDevice {
        endpoint_id: client.endpoint_id,
        id: device_id,
        name: client.device_name.unwrap_or_else(|| "Unknown".to_string()),
        role_label: assigned_role,
        camera_facing,
      }
    })
    .collect()
}

pub fn create_protocol_snapshot_for_endpoint(state: &AppState, endpoint_id: &str) -> Option<ProtocolSnapshot> {
  let devices = protocol_devices_with_roles(state);
  if devices.is_empty() {
    return None;
  }

  let self_device = devices.iter().find(|device| device.endpoint_id == endpoint_id);
  let anchor_device = devices
    .iter()
    .find(|device| matches!(role_label_to_wire_role(&device.role_label), WireRole::Start));

  let host_split_marks: Vec<ProtocolSplitMark> = state
    .session_state
    .host_split_marks
    .iter()
    .map(|split| ProtocolSplitMark {
      role: role_label_to_wire_role(&split.role_label),
      host_sensor_nanos: split.host_sensor_nanos,
    })
    .collect();

  Some(ProtocolSnapshot {
    r#type: "snapshot".to_string(),
    stage: match state.session_state.stage {
      SessionStage::Setup => "setup".to_string(),
      SessionStage::Lobby => "lobby".to_string(),
      SessionStage::Monitoring => "monitoring".to_string(),
    },
    monitoring_active: state.session_state.monitoring_active,
    devices: devices
      .iter()
      .map(|device| ProtocolSnapshotDevice {
        id: device.id.clone(),
        name: device.name.clone(),
        role: role_label_to_wire_role(&device.role_label),
        camera_facing: device.camera_facing.clone(),
        is_local: false,
      })
      .collect(),
    timeline: ProtocolTimelineSnapshot {
      host_start_sensor_nanos: state.session_state.host_start_sensor_nanos,
      host_stop_sensor_nanos: state.session_state.host_stop_sensor_nanos,
      host_split_sensor_nanos: state
        .session_state
        .host_split_marks
        .iter()
        .map(|mark| mark.host_sensor_nanos)
        .collect(),
      host_split_marks,
    },
    run_id: state.session_state.run_id.clone(),
    host_sensor_minus_elapsed_nanos: 0,
    host_gps_utc_offset_nanos: None,
    host_gps_fix_age_nanos: None,
    self_device_id: self_device.map(|device| device.id.clone()),
    anchor_device_id: anchor_device.map(|device| device.id.clone()),
    anchor_state: Some(if state.session_state.monitoring_active {
      "active".to_string()
    } else {
      "ready".to_string()
    }),
  })
}

pub fn create_timeline_snapshot_payload(state: &AppState) -> TimelineSnapshotPayload {
  TimelineSnapshotPayload {
    r#type: "timeline_snapshot".to_string(),
    host_start_sensor_nanos: state.session_state.host_start_sensor_nanos,
    host_stop_sensor_nanos: state.session_state.host_stop_sensor_nanos,
    host_split_marks: state
      .session_state
      .host_split_marks
      .iter()
      .map(|split| ProtocolSplitMark {
        role: role_label_to_wire_role(&split.role_label),
        host_sensor_nanos: split.host_sensor_nanos,
      })
      .collect(),
    host_split_sensor_nanos: state
      .session_state
      .host_split_marks
      .iter()
      .map(|split| split.host_sensor_nanos)
      .collect(),
    sent_elapsed_nanos: clock_sync::now_host_elapsed_nanos(),
  }
}

pub fn compute_role_options(state: &AppState) -> Vec<RoleLabel> {
  let assigned: Vec<RoleLabel> = state.session_state.role_assignments.values().cloned().collect();
  compute_progressive_role_options(&assigned)
}

pub fn auto_assign_role_for_new_join(state: &mut AppState, endpoint_id: &str) {
  if state.session_state.role_assignments.contains_key(endpoint_id) {
    return;
  }

  let assigned: HashSet<RoleLabel> = state.session_state.role_assignments.values().cloned().collect();
  let next_role = AUTO_ASSIGN_ROLE_SEQUENCE.iter().find(|role| !assigned.contains(*role));
  let Some(role) = next_role else {
    return;
  };

  state
    .session_state
    .role_assignments
    .insert(endpoint_id.to_string(), role.clone());
  apply_default_distance_for_role(state, endpoint_id, role);

  push_event(
    state,
    EventLevel::Info,
    format!("Role auto-assigned: {endpoint_id} -> {}", role.as_str()),
    BTreeMap::new(),
  );
}

pub fn assigned_role_for_endpoint(state: &AppState, endpoint_id: &str) -> RoleLabel {
  let role_target = state
    .clients_by_endpoint
    .get(endpoint_id)
    .and_then(|client| client.stable_device_id.clone())
    .unwrap_or_else(|| endpoint_id.to_string());

  state
    .session_state
    .role_assignments
    .get(&role_target)
    .cloned()
    .or_else(|| state.session_state.role_assignments.get(endpoint_id).cloned())
    .unwrap_or(RoleLabel::Unassigned)
}

pub fn handle_device_identity(state: &mut AppState, endpoint_id: &str, decoded: &DeviceIdentityMessage) {
  let stable_device_id = decoded.stable_device_id.trim();
  let device_name = decoded.device_name.trim();
  if stable_device_id.is_empty() || device_name.is_empty() {
    state.message_stats.parse_errors += 1;
    push_event(
      state,
      EventLevel::Warn,
      format!("Invalid device identity payload from {endpoint_id}"),
      BTreeMap::new(),
    );
    return;
  }

  if let Some(existing) = state.clients_by_endpoint.get(endpoint_id).cloned() {
    if let Some(previous_stable) = existing.stable_device_id {
      if previous_stable != stable_device_id {
        if let Some(previous_role) = state.session_state.role_assignments.get(&previous_stable).cloned() {
          state
            .session_state
            .role_assignments
            .insert(stable_device_id.to_string(), previous_role);
          state.session_state.role_assignments.remove(&previous_stable);
        }
        migrate_assignment_key(
          &mut state.session_state.device_sensitivity_assignments,
          &previous_stable,
          stable_device_id,
        );
        migrate_assignment_key(
          &mut state.session_state.device_camera_facing_assignments,
          &previous_stable,
          stable_device_id,
        );
        migrate_assignment_key(
          &mut state.session_state.device_distance_assignments,
          &previous_stable,
          stable_device_id,
        );
      }
    }
  }

  if let Some(endpoint_role) = state.session_state.role_assignments.get(endpoint_id).cloned() {
    if !state.session_state.role_assignments.contains_key(stable_device_id) {
      state
        .session_state
        .role_assignments
        .insert(stable_device_id.to_string(), endpoint_role);
      state.session_state.role_assignments.remove(endpoint_id);
    }
  }

  migrate_assignment_key(
    &mut state.session_state.device_sensitivity_assignments,
    endpoint_id,
    stable_device_id,
  );
  migrate_assignment_key(
    &mut state.session_state.device_camera_facing_assignments,
    endpoint_id,
    stable_device_id,
  );
  migrate_assignment_key(
    &mut state.session_state.device_distance_assignments,
    endpoint_id,
    stable_device_id,
  );

  upsert_client(state, endpoint_id, |client| {
    client.stable_device_id = Some(stable_device_id.to_string());
    client.device_name = Some(device_name.to_string());
    client.role_target = stable_device_id.to_string();
  });

  push_event(
    state,
    EventLevel::Info,
    format!("Identity update {device_name} ({stable_device_id})"),
    event_details(&[("endpointId", json!(endpoint_id))]),
  );
}

pub fn try_complete_clock_resync_loop(state: &mut AppState, endpoint_id: &str, source: &str) -> bool {
  let Some(loop_state) = state.clock_resync_loops_by_endpoint.get(endpoint_id).cloned() else {
    return false;
  };

  let latency_ms = state
    .clients_by_endpoint
    .get(endpoint_id)
    .and_then(|client| client.telemetry_latency_ms);
  let Some(latency) = latency_ms else {
    return false;
  };

  if latency >= loop_state.target_latency_ms {
    return false;
  }

  state.clock_resync_loops_by_endpoint.remove(endpoint_id);
  push_event(
    state,
    EventLevel::Info,
    format!("Clock resync target reached for {endpoint_id}"),
    event_details(&[
      ("endpointId", json!(endpoint_id)),
      ("latencyMs", json!(latency)),
      ("targetLatencyMs", json!(loop_state.target_latency_ms)),
      ("attempts", json!(loop_state.attempts)),
      ("source", json!(source)),
    ]),
  );

  true
}

pub fn handle_device_telemetry(state: &mut AppState, endpoint_id: &str, decoded: &DeviceTelemetryMessage) {
  if decoded.stable_device_id.trim().is_empty() || !(1..=100).contains(&decoded.sensitivity) {
    state.message_stats.parse_errors += 1;
    return;
  }
  if decoded.timestamp_millis <= 0 {
    state.message_stats.parse_errors += 1;
    return;
  }

  let existing = state.clients_by_endpoint.get(endpoint_id).cloned();
  let role_target = existing
    .and_then(|entry| entry.stable_device_id)
    .unwrap_or_else(|| decoded.stable_device_id.clone());
  let configured_sensitivity = state
    .session_state
    .device_sensitivity_assignments
    .get(&role_target)
    .cloned()
    .or_else(|| state.session_state.device_sensitivity_assignments.get(endpoint_id).cloned())
    .unwrap_or(decoded.sensitivity);

  upsert_client(state, endpoint_id, |client| {
    client.stable_device_id = Some(decoded.stable_device_id.clone());
    client.telemetry_sensitivity = configured_sensitivity;
    client.sensitivity = configured_sensitivity;
    client.telemetry_latency_ms = decoded.latency_ms;
    client.telemetry_clock_synced = decoded.clock_synced;
    client.telemetry_analysis_width = decoded.analysis_width;
    client.telemetry_analysis_height = decoded.analysis_height;
    client.telemetry_timestamp_millis = Some(decoded.timestamp_millis);
  });

  let _ = try_complete_clock_resync_loop(state, endpoint_id, "telemetry");
}

pub fn handle_lap_result(state: &mut AppState, endpoint_id: &str, decoded: &LapResultMessage) {
  if decoded.sender_device_name.trim().is_empty()
    || decoded.started_sensor_nanos <= 0
    || decoded.stopped_sensor_nanos <= decoded.started_sensor_nanos
  {
    state.message_stats.parse_errors += 1;
    push_event(
      state,
      EventLevel::Warn,
      format!("Invalid lap result payload from {endpoint_id}"),
      BTreeMap::new(),
    );
    return;
  }

  let elapsed_nanos = decoded.stopped_sensor_nanos - decoded.started_sensor_nanos;
  let lap_result = LapResult {
    id: format!("lap-{}", state.next_lap_id),
    endpoint_id: endpoint_id.to_string(),
    sender_device_name: decoded.sender_device_name.clone(),
    started_sensor_nanos: decoded.started_sensor_nanos,
    stopped_sensor_nanos: decoded.stopped_sensor_nanos,
    elapsed_nanos,
    elapsed_millis: (elapsed_nanos as f64 / 1_000_000.0).round() as i64,
    received_at_iso: now_iso(),
  };
  state.next_lap_id += 1;

  state
    .latest_lap_by_endpoint
    .insert(endpoint_id.to_string(), lap_result.clone());
  state.lap_history.push(lap_result.clone());
  if state.lap_history.len() > crate::state::HISTORY_LIMIT {
    let drain_count = state.lap_history.len() - crate::state::HISTORY_LIMIT;
    state.lap_history.drain(0..drain_count);
  }

  if state
    .clients_by_endpoint
    .get(endpoint_id)
    .and_then(|client| client.device_name.clone())
    .is_none()
  {
    upsert_client(state, endpoint_id, |client| {
      client.device_name = Some(decoded.sender_device_name.clone());
    });
  }

  push_event(
    state,
    EventLevel::Info,
    format!(
      "Lap result from {}: {} ms",
      decoded.sender_device_name,
      lap_result.elapsed_millis
    ),
    event_details(&[("endpointId", json!(endpoint_id))]),
  );
}

fn reject_trigger_request(state: &mut AppState, endpoint_id: &str, reason: &str, source_type: &str) {
  push_event(
    state,
    EventLevel::Warn,
    format!("Trigger request rejected from {endpoint_id}: {reason}"),
    event_details(&[
      ("endpointId", json!(endpoint_id)),
      ("sourceType", json!(source_type)),
    ]),
  );
}

fn trigger_spec_matches_role(role_label: &RoleLabel, trigger_spec: &TriggerSpec) -> bool {
  let Some(expected) = trigger_spec_for_role(role_label) else {
    return false;
  };

  expected.trigger_type == trigger_spec.trigger_type && expected.split_index == trigger_spec.split_index
}

pub fn handle_session_trigger(state: &mut AppState, endpoint_id: &str, decoded: &SessionTriggerMessage) {
  if !state.session_state.monitoring_active || !matches!(state.session_state.stage, SessionStage::Monitoring) {
    return;
  }

  let assigned_role = assigned_role_for_endpoint(state, endpoint_id);
  if matches!(assigned_role, RoleLabel::Unassigned) {
    reject_trigger_request(state, endpoint_id, "unassigned role", "session_trigger");
    return;
  }

  let Some(trigger_spec) = trigger_spec_for_type(&decoded.trigger_type, decoded.split_index) else {
    reject_trigger_request(state, endpoint_id, "invalid trigger payload", "session_trigger");
    return;
  };

  if !trigger_spec_matches_role(&assigned_role, &trigger_spec) {
    reject_trigger_request(state, endpoint_id, "role mismatch", "session_trigger");
    return;
  }

  let trigger_sensor_nanos = clock_sync::now_host_elapsed_nanos();
  if !apply_trigger_to_host_timeline(state, &trigger_spec, trigger_sensor_nanos) {
    reject_trigger_request(state, endpoint_id, "timeline state rejected", "session_trigger");
    return;
  }

  push_event(
    state,
    EventLevel::Info,
    format!("Trigger accepted from {endpoint_id}: {:?}", trigger_spec.trigger_type),
    event_details(&[("endpointId", json!(endpoint_id))]),
  );
}

pub fn handle_trigger_request(state: &mut AppState, endpoint_id: &str, decoded: &TriggerRequestMessage) {
  if !state.session_state.monitoring_active || !matches!(state.session_state.stage, SessionStage::Monitoring) {
    reject_trigger_request(state, endpoint_id, "monitoring inactive", "trigger_request");
    return;
  }

  let Some(requested_role_label) = wire_role_to_role_label(&decoded.role) else {
    reject_trigger_request(state, endpoint_id, "invalid role", "trigger_request");
    return;
  };

  let assigned_role = assigned_role_for_endpoint(state, endpoint_id);
  if assigned_role != requested_role_label {
    reject_trigger_request(state, endpoint_id, "role mismatch", "trigger_request");
    return;
  }

  let Some(trigger_spec) = trigger_spec_for_role(&assigned_role) else {
    reject_trigger_request(state, endpoint_id, "role has no trigger mapping", "trigger_request");
    return;
  };

  let trigger_sensor_nanos = decoded
    .mapped_host_sensor_nanos
    .unwrap_or_else(clock_sync::now_host_elapsed_nanos);

  if !apply_trigger_to_host_timeline(state, &trigger_spec, trigger_sensor_nanos) {
    reject_trigger_request(state, endpoint_id, "timeline state rejected", "trigger_request");
    return;
  }

  push_event(
    state,
    EventLevel::Info,
    format!("Trigger accepted from {endpoint_id}: {:?}", trigger_spec.trigger_type),
    event_details(&[("endpointId", json!(endpoint_id))]),
  );
}

pub fn handle_trigger_refinement(state: &mut AppState, endpoint_id: &str, decoded: &TriggerRefinementMessage) {
  if decoded.run_id.trim().is_empty() {
    return;
  }
  if state.session_state.run_id.as_deref() != Some(decoded.run_id.as_str()) {
    return;
  }

  let Some(requested_role) = wire_role_to_role_label(&decoded.role) else {
    return;
  };
  if matches!(requested_role, RoleLabel::Unassigned) {
    return;
  }

  let role_target = state
    .clients_by_endpoint
    .get(endpoint_id)
    .and_then(|client| client.stable_device_id.clone())
    .unwrap_or_else(|| endpoint_id.to_string());
  let assigned_role = state
    .session_state
    .role_assignments
    .get(&role_target)
    .cloned()
    .or_else(|| state.session_state.role_assignments.get(endpoint_id).cloned())
    .unwrap_or(RoleLabel::Unassigned);

  if assigned_role != requested_role {
    return;
  }

  if !apply_trigger_refinement_to_host_timeline(
    state,
    &requested_role,
    decoded.provisional_host_sensor_nanos,
    decoded.refined_host_sensor_nanos,
  ) {
    return;
  }

  push_event(
    state,
    EventLevel::Info,
    format!("Trigger refinement accepted from {endpoint_id}: {}", requested_role.as_str()),
    event_details(&[("endpointId", json!(endpoint_id))]),
  );
}

pub fn create_snapshot(state: &AppState) -> Snapshot {
  let timeline_lap_results = create_timeline_lap_results(state);

  let latest_lap_results = if !timeline_lap_results.is_empty() {
    timeline_lap_results
  } else {
    let mut lap_results: Vec<TimelineLapResult> = state
      .latest_lap_by_endpoint
      .values()
      .cloned()
      .map(|base| TimelineLapResult {
        role_label: RoleLabel::Unassigned,
        source: "telemetry".to_string(),
        lap_elapsed_nanos: base.elapsed_nanos,
        lap_elapsed_millis: base.elapsed_millis,
        distance_meters: None,
        lap_distance_meters: None,
        average_speed_mps: None,
        lap_speed_mps: None,
        base,
      })
      .collect();
    lap_results.sort_by_key(|item| item.base.elapsed_nanos);
    lap_results
  };

  let mut clients: Vec<ClientState> = state.clients_by_endpoint.values().cloned().collect();
  clients.sort_by(|left, right| left.connected_at_iso.cmp(&right.connected_at_iso));

  let clients_with_roles: Vec<ClientState> = clients
    .into_iter()
    .map(|mut client| {
      let role_target = client
        .stable_device_id
        .clone()
        .unwrap_or_else(|| client.endpoint_id.clone());
      let role = state
        .session_state
        .role_assignments
        .get(&role_target)
        .cloned()
        .or_else(|| state.session_state.role_assignments.get(&client.endpoint_id).cloned())
        .unwrap_or(RoleLabel::Unassigned);
      let sensitivity = resolve_sensitivity_for_role_target(state, Some(&role_target), client.telemetry_sensitivity);
      let camera_facing = resolve_camera_facing_for_role_target(state, Some(&role_target), client.camera_facing.clone());
      let distance_fallback = client.distance_meters.or_else(|| default_distance_for_role(&role));
      let distance_meters = resolve_distance_for_role_target(state, Some(&role_target), distance_fallback);

      client.assigned_role = role;
      client.role_target = role_target;
      client.sensitivity = sensitivity;
      client.telemetry_sensitivity = sensitivity;
      client.camera_facing = camera_facing;
      client.distance_meters = distance_meters;
      client
    })
    .collect();

  let monitoring_elapsed_ms = session_elapsed_ms_now(&state.session_state);
  let mut session = state.session_state.clone();
  session.monitoring_elapsed_ms = monitoring_elapsed_ms;
  session.role_options = compute_role_options(state);

  Snapshot {
    server: ServerSnapshot {
      name: "Sprint Sync Windows Backend (Rust/Tauri)".to_string(),
      timestamp_iso: now_iso(),
      started_at_iso: chrono::DateTime::from_timestamp_millis(state.started_at_ms)
        .unwrap_or_else(chrono::Utc::now)
        .to_rfc3339(),
      uptime_ms: (chrono::Utc::now().timestamp_millis() - state.started_at_ms).max(0),
      tcp: ServerTransportSnapshot {
        host: state.config.tcp_host.clone(),
        port: state.config.tcp_port,
      },
      http: ServerTransportSnapshot {
        host: state.config.http_host.clone(),
        port: state.config.http_port,
      },
    },
    stats: StatsSnapshot {
      connected_clients: clients_with_roles.len(),
      total_frames: state.message_stats.total_frames,
      message_frames: state.message_stats.message_frames,
      binary_frames: state.message_stats.binary_frames,
      parse_errors: state.message_stats.parse_errors,
      total_lap_results: state.lap_history.len(),
      known_types: state.message_stats.known_types.clone(),
    },
    session,
    results_export: ResultsExportState {
      directory: state.config.results_dir.to_string_lossy().to_string(),
      last_saved_file_path: state.session_state.last_saved_results_file_path.clone(),
      last_saved_at_iso: state.session_state.last_saved_results_at_iso.clone(),
    },
    clock_domain_mapping: ClockDomainMappingSnapshot {
      implemented: state.clock_domain_state.implemented,
      source: state.clock_domain_state.source.clone(),
      samples_responded: state.clock_domain_state.samples_responded,
      ignored_frames: state.clock_domain_state.ignored_frames,
      last_endpoint_id: state.clock_domain_state.last_endpoint_id.clone(),
      last_request_at_iso: state.clock_domain_state.last_request_at_iso.clone(),
      last_response_at_iso: state.clock_domain_state.last_response_at_iso.clone(),
      last_host_receive_elapsed_nanos: state.clock_domain_state.last_host_receive_elapsed_nanos.clone(),
      last_host_send_elapsed_nanos: state.clock_domain_state.last_host_send_elapsed_nanos.clone(),
      description: "Windows host responds to binary clock sync requests and remains the active elapsed-time source for connected devices."
        .to_string(),
    },
    clients: clients_with_roles,
    latest_lap_results,
    lap_history: state.lap_history.iter().cloned().rev().collect(),
    recent_events: state.recent_events.iter().cloned().rev().collect(),
  }
}

pub fn start_monitoring(state: &mut AppState) -> Result<String, String> {
  let connected_devices = protocol_devices_with_roles(state);
  let has_start = connected_devices
    .iter()
    .any(|device| matches!(device.role_label, RoleLabel::Start));
  let has_stop = connected_devices
    .iter()
    .any(|device| matches!(device.role_label, RoleLabel::Stop));

  if !has_start || !has_stop {
    return Err("assign start and stop roles before monitoring".to_string());
  }

  let started_at_ms = chrono::Utc::now().timestamp_millis();
  state.session_state.stage = SessionStage::Monitoring;
  state.session_state.monitoring_active = true;
  state.session_state.monitoring_started_at_ms = Some(started_at_ms);
  state.session_state.monitoring_started_iso = Some(now_iso());
  state.session_state.monitoring_elapsed_ms = 0;
  state.session_state.run_id = Some(format!("run-{started_at_ms}"));
  state.session_state.host_start_sensor_nanos = None;
  state.session_state.host_stop_sensor_nanos = None;
  state.session_state.host_split_marks.clear();
  reset_run_data(state);

  push_event(
    state,
    EventLevel::Info,
    "Monitoring started",
    event_details(&[("runId", json!(state.session_state.run_id.clone()))]),
  );

  Ok(state.session_state.run_id.clone().unwrap_or_else(|| "run".to_string()))
}

pub fn stop_monitoring(state: &mut AppState) {
  if state.session_state.monitoring_active {
    state.session_state.monitoring_elapsed_ms = session_elapsed_ms_now(&state.session_state);
  }
  state.session_state.monitoring_active = false;
  state.session_state.monitoring_started_at_ms = None;
  state.session_state.monitoring_started_iso = None;
  state.session_state.stage = SessionStage::Lobby;

  push_event(
    state,
    EventLevel::Info,
    "Monitoring stopped",
    event_details(&[("runId", json!(state.session_state.run_id.clone()))]),
  );
}

pub fn start_lobby(state: &mut AppState) {
  state.session_state.stage = SessionStage::Lobby;
  state.session_state.monitoring_active = false;
  state.session_state.monitoring_started_at_ms = None;
  state.session_state.monitoring_started_iso = None;
  state.session_state.monitoring_elapsed_ms = 0;
  state.session_state.run_id = None;
  state.session_state.host_start_sensor_nanos = None;
  state.session_state.host_stop_sensor_nanos = None;
  state.session_state.host_split_marks.clear();

  push_event(state, EventLevel::Info, "Session moved to lobby", BTreeMap::new());
}

pub fn return_setup(state: &mut AppState) {
  state.session_state.stage = SessionStage::Setup;
  state.session_state.monitoring_active = false;
  state.session_state.monitoring_started_at_ms = None;
  state.session_state.monitoring_started_iso = None;
  state.session_state.monitoring_elapsed_ms = 0;
  state.session_state.run_id = None;
  state.session_state.host_start_sensor_nanos = None;
  state.session_state.host_stop_sensor_nanos = None;
  state.session_state.host_split_marks.clear();

  push_event(state, EventLevel::Info, "Session returned to setup", BTreeMap::new());
}

pub fn reset_laps(state: &mut AppState) {
  reset_run_data(state);
  push_event(state, EventLevel::Info, "Operator reset lap results", BTreeMap::new());
}

pub fn reset_run(state: &mut AppState) {
  reset_run_data(state);
  state.session_state.monitoring_elapsed_ms = 0;
  state.session_state.run_id = if state.session_state.monitoring_active {
    Some(format!("run-{}", chrono::Utc::now().timestamp_millis()))
  } else {
    None
  };
  state.session_state.host_start_sensor_nanos = None;
  state.session_state.host_stop_sensor_nanos = None;
  state.session_state.host_split_marks.clear();

  push_event(state, EventLevel::Info, "Run reset", BTreeMap::new());
}

pub fn assign_role(state: &mut AppState, target_id: &str, role: RoleLabel) -> Result<(), String> {
  if target_id.trim().is_empty() {
    return Err("targetId is required".to_string());
  }

  let available_roles = compute_role_options(state);
  let currently_assigned = state
    .session_state
    .role_assignments
    .get(target_id)
    .cloned()
    .unwrap_or(RoleLabel::Unassigned);

  if !available_roles.contains(&role) && role != currently_assigned {
    return Err("invalid role".to_string());
  }

  if !matches!(role, RoleLabel::Unassigned) {
    let duplicates: Vec<String> = state
      .session_state
      .role_assignments
      .iter()
      .filter_map(|(assigned_target, assigned_role)| {
        if assigned_target != target_id && *assigned_role == role {
          Some(assigned_target.clone())
        } else {
          None
        }
      })
      .collect();
    for duplicate_target in duplicates {
      state.session_state.role_assignments.remove(&duplicate_target);
    }
  }

  if matches!(role, RoleLabel::Unassigned) {
    state.session_state.role_assignments.remove(target_id);
  } else {
    state
      .session_state
      .role_assignments
      .insert(target_id.to_string(), role.clone());
    apply_default_distance_for_role(state, target_id, &role);
  }

  push_event(
    state,
    EventLevel::Info,
    format!("Role assigned: {target_id} -> {}", role.as_str()),
    BTreeMap::new(),
  );

  Ok(())
}

pub fn update_device_config(
  state: &mut AppState,
  target_id_raw: &str,
  sensitivity: Option<i32>,
  camera_facing: Option<CameraFacing>,
  distance_meters: Option<f64>,
) -> Result<(String, Option<i32>, Option<CameraFacing>, Option<f64>, usize), String> {
  if target_id_raw.trim().is_empty() {
    return Err("targetId is required".to_string());
  }
  if sensitivity.is_none() && camera_facing.is_none() && distance_meters.is_none() {
    return Err("at least one of sensitivity, cameraFacing, or distanceMeters is required".to_string());
  }

  let target_id = canonical_target_id(state, target_id_raw);

  if let Some(parsed_sensitivity) = sensitivity {
    if !(1..=100).contains(&parsed_sensitivity) {
      return Err("sensitivity must be an integer in the range 1..100".to_string());
    }
    state
      .session_state
      .device_sensitivity_assignments
      .insert(target_id.clone(), parsed_sensitivity);
  }

  if let Some(next_camera_facing) = camera_facing.clone() {
    state
      .session_state
      .device_camera_facing_assignments
      .insert(target_id.clone(), next_camera_facing);
  }

  let mut normalized_distance = None;
  if let Some(raw_distance) = distance_meters {
    let Some(parsed) = normalize_distance_meters(raw_distance) else {
      return Err("distanceMeters must be a number in the range 0..100000".to_string());
    };
    state
      .session_state
      .device_distance_assignments
      .insert(target_id.clone(), parsed);
    normalized_distance = Some(parsed);
  }

  let endpoint_ids = resolve_endpoint_ids_for_target_id(state, &target_id);
  for endpoint_id in &endpoint_ids {
    upsert_client(state, endpoint_id, |client| {
      if let Some(next_camera_facing) = camera_facing.clone() {
        client.camera_facing = next_camera_facing;
      }
      if let Some(next_sensitivity) = sensitivity {
        client.telemetry_sensitivity = next_sensitivity;
        client.sensitivity = next_sensitivity;
      }
      if let Some(next_distance) = normalized_distance {
        client.distance_meters = Some(next_distance);
      }
    });
  }

  push_event(
    state,
    EventLevel::Info,
    format!("Device config updated: {target_id}"),
    event_details(&[
      ("targetId", json!(target_id)),
      ("sensitivity", json!(sensitivity)),
      (
        "cameraFacing",
        json!(camera_facing.as_ref().map(|facing| match facing {
          CameraFacing::Rear => "rear",
          CameraFacing::Front => "front",
        })),
      ),
      ("distanceMeters", json!(normalized_distance)),
      ("endpointCount", json!(endpoint_ids.len())),
    ]),
  );

  Ok((target_id, sensitivity, camera_facing, normalized_distance, endpoint_ids.len()))
}
