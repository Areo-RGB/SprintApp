use crate::clock_sync;
use crate::events::{publish_state, push_event};
use crate::flatbuf_codec::{self, DecodedTelemetryMessage};
use crate::session;
use crate::state::{
  CameraFacing, DeviceIdentityMessage, DeviceTelemetryMessage, EventLevel, LapResultMessage,
  SessionTriggerMessage, SharedAppState, SocketContext, TriggerRefinementMessage, TriggerRequestMessage,
  WireRole, FRAME_KIND_BINARY, FRAME_KIND_MESSAGE, FRAME_KIND_TELEMETRY_BINARY, MAX_FRAME_BYTES,
};
use serde_json::Value;
use std::collections::BTreeMap;
use std::net::SocketAddr;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::mpsc;
use tracing::{error, info, warn};

fn event_details(values: &[(&str, serde_json::Value)]) -> BTreeMap<String, serde_json::Value> {
  let mut details = BTreeMap::new();
  for (key, value) in values {
    details.insert((*key).to_string(), value.clone());
  }
  details
}

fn parse_wire_role(raw_role: &str) -> WireRole {
  match raw_role.trim().to_lowercase().as_str() {
    "start" => WireRole::Start,
    "split" | "split1" => WireRole::Split1,
    "split2" => WireRole::Split2,
    "split3" => WireRole::Split3,
    "split4" => WireRole::Split4,
    "stop" => WireRole::Stop,
    "display" => WireRole::Display,
    _ => WireRole::Unassigned,
  }
}

async fn parse_json_message(payload: &[u8], endpoint_id: &str, shared_state: &SharedAppState) {
  let raw_message = String::from_utf8_lossy(payload).to_string();
  let Ok(decoded) = serde_json::from_str::<Value>(&raw_message) else {
    let mut state = shared_state.write().await;
    state.message_stats.parse_errors += 1;
    push_event(
      &mut state,
      EventLevel::Warn,
      format!("Non-JSON message from {endpoint_id}"),
      event_details(&[("endpointId", serde_json::json!(endpoint_id))]),
    );
    return;
  };

  let Some(message_type) = decoded.get("type").and_then(Value::as_str) else {
    let mut state = shared_state.write().await;
    state.message_stats.parse_errors += 1;
    return;
  };

  {
    let mut state = shared_state.write().await;
    session::increment_message_type(&mut state.message_stats, message_type);
  }

  match message_type {
    "device_identity" => {
      let identity = DeviceIdentityMessage {
        stable_device_id: decoded
          .get("stableDeviceId")
          .and_then(Value::as_str)
          .unwrap_or_default()
          .to_string(),
        device_name: decoded
          .get("deviceName")
          .and_then(Value::as_str)
          .unwrap_or_default()
          .to_string(),
      };
      let mut state = shared_state.write().await;
      session::handle_device_identity(&mut state, endpoint_id, &identity);
    }
    "lap_result" => {
      let lap_result = LapResultMessage {
        sender_device_name: decoded
          .get("senderDeviceName")
          .and_then(Value::as_str)
          .unwrap_or_default()
          .to_string(),
        started_sensor_nanos: decoded
          .get("startedSensorNanos")
          .and_then(Value::as_i64)
          .unwrap_or_default(),
        stopped_sensor_nanos: decoded
          .get("stoppedSensorNanos")
          .and_then(Value::as_i64)
          .unwrap_or_default(),
      };
      let mut state = shared_state.write().await;
      session::handle_lap_result(&mut state, endpoint_id, &lap_result);
    }
    "device_telemetry" => {
      let telemetry = DeviceTelemetryMessage {
        stable_device_id: decoded
          .get("stableDeviceId")
          .and_then(Value::as_str)
          .unwrap_or_default()
          .to_string(),
        role: parse_wire_role(
          decoded
            .get("role")
            .and_then(Value::as_str)
            .unwrap_or("unassigned"),
        ),
        sensitivity: decoded
          .get("sensitivity")
          .and_then(Value::as_i64)
          .map(|value| value as i32)
          .unwrap_or(100),
        latency_ms: decoded
          .get("latencyMs")
          .and_then(Value::as_i64)
          .map(|value| value as i32),
        clock_synced: decoded
          .get("clockSynced")
          .and_then(Value::as_bool)
          .unwrap_or(false),
        analysis_width: decoded
          .get("analysisWidth")
          .and_then(Value::as_i64)
          .map(|value| value as i32),
        analysis_height: decoded
          .get("analysisHeight")
          .and_then(Value::as_i64)
          .map(|value| value as i32),
        timestamp_millis: decoded
          .get("timestampMillis")
          .and_then(Value::as_i64)
          .unwrap_or_default(),
      };
      let mut state = shared_state.write().await;
      session::handle_device_telemetry(&mut state, endpoint_id, &telemetry);
    }
    "trigger_request" => {
      let trigger_request = TriggerRequestMessage {
        role: parse_wire_role(decoded.get("role").and_then(Value::as_str).unwrap_or("unassigned")),
        trigger_sensor_nanos: decoded.get("triggerSensorNanos").and_then(Value::as_i64),
        mapped_host_sensor_nanos: decoded.get("mappedHostSensorNanos").and_then(Value::as_i64),
        source_device_id: decoded
          .get("sourceDeviceId")
          .and_then(Value::as_str)
          .map(str::to_string),
        source_elapsed_nanos: decoded.get("sourceElapsedNanos").and_then(Value::as_i64),
        mapped_anchor_elapsed_nanos: decoded.get("mappedAnchorElapsedNanos").and_then(Value::as_i64),
      };
      let mut state = shared_state.write().await;
      session::handle_trigger_request(&mut state, endpoint_id, &trigger_request);
    }
    "session_trigger" => {
      let session_trigger = SessionTriggerMessage {
        trigger_type: decoded
          .get("triggerType")
          .and_then(Value::as_str)
          .unwrap_or_default()
          .to_string(),
        split_index: decoded
          .get("splitIndex")
          .and_then(Value::as_i64)
          .map(|value| value as i32),
        trigger_sensor_nanos: decoded.get("triggerSensorNanos").and_then(Value::as_i64),
      };
      let mut state = shared_state.write().await;
      session::handle_session_trigger(&mut state, endpoint_id, &session_trigger);
    }
    "trigger_refinement" => {
      let trigger_refinement = TriggerRefinementMessage {
        run_id: decoded
          .get("runId")
          .and_then(Value::as_str)
          .unwrap_or_default()
          .to_string(),
        role: parse_wire_role(decoded.get("role").and_then(Value::as_str).unwrap_or("unassigned")),
        provisional_host_sensor_nanos: decoded
          .get("provisionalHostSensorNanos")
          .and_then(Value::as_i64)
          .unwrap_or_default(),
        refined_host_sensor_nanos: decoded
          .get("refinedHostSensorNanos")
          .and_then(Value::as_i64)
          .unwrap_or_default(),
      };
      let mut state = shared_state.write().await;
      session::handle_trigger_refinement(&mut state, endpoint_id, &trigger_refinement);
    }
    _ => {}
  }
}

async fn handle_binary_frame(payload: &[u8], endpoint_id: &str, shared_state: &SharedAppState) {
  let response_frame = {
    let mut state = shared_state.write().await;
    clock_sync::handle_clock_sync_request(&mut state, endpoint_id, payload)
  };

  if let Some(frame) = response_frame {
    let _ = send_frame_to_endpoint(shared_state, endpoint_id, frame).await;
  }
}

async fn handle_telemetry_frame(payload: &[u8], endpoint_id: &str, shared_state: &SharedAppState) {
  let Some(decoded) = flatbuf_codec::decode_telemetry_envelope(payload) else {
    let mut state = shared_state.write().await;
    state.message_stats.parse_errors += 1;
    push_event(
      &mut state,
      EventLevel::Warn,
      format!("Invalid telemetry envelope from {endpoint_id}"),
      event_details(&[("endpointId", serde_json::json!(endpoint_id))]),
    );
    return;
  };

  match decoded {
    DecodedTelemetryMessage::TriggerRequest(message) => {
      let mut state = shared_state.write().await;
      session::increment_message_type(&mut state.message_stats, "telemetry_trigger_request");
      session::handle_trigger_request(&mut state, endpoint_id, &message);
    }
    DecodedTelemetryMessage::SessionTrigger(message) => {
      let mut state = shared_state.write().await;
      session::increment_message_type(&mut state.message_stats, "telemetry_session_trigger");
      session::handle_session_trigger(&mut state, endpoint_id, &message);
    }
    DecodedTelemetryMessage::TriggerRefinement(message) => {
      let mut state = shared_state.write().await;
      session::increment_message_type(&mut state.message_stats, "telemetry_trigger_refinement");
      session::handle_trigger_refinement(&mut state, endpoint_id, &message);
    }
    DecodedTelemetryMessage::DeviceIdentity(message) => {
      let mut state = shared_state.write().await;
      session::increment_message_type(&mut state.message_stats, "telemetry_device_identity");
      session::handle_device_identity(&mut state, endpoint_id, &message);
    }
    DecodedTelemetryMessage::DeviceTelemetry(message) => {
      let mut state = shared_state.write().await;
      session::increment_message_type(&mut state.message_stats, "telemetry_device_telemetry");
      session::handle_device_telemetry(&mut state, endpoint_id, &message);
    }
    DecodedTelemetryMessage::LapResult(message) => {
      let mut state = shared_state.write().await;
      session::increment_message_type(&mut state.message_stats, "telemetry_lap_result");
      session::handle_lap_result(&mut state, endpoint_id, &message);
    }
    DecodedTelemetryMessage::TimelineSnapshot(_) => {
      let mut state = shared_state.write().await;
      session::increment_message_type(&mut state.message_stats, "telemetry_timeline_snapshot");
    }
    DecodedTelemetryMessage::SessionSnapshot(_) => {
      let mut state = shared_state.write().await;
      session::increment_message_type(&mut state.message_stats, "telemetry_session_snapshot");
    }
    DecodedTelemetryMessage::DeviceConfigUpdate { .. } => {
      let mut state = shared_state.write().await;
      session::increment_message_type(&mut state.message_stats, "telemetry_device_config_update");
    }
    DecodedTelemetryMessage::ClockResyncRequest { sample_count } => {
      let mut state = shared_state.write().await;
      session::increment_message_type(
        &mut state.message_stats,
        &format!("telemetry_clock_resync_request_{sample_count}"),
      );
    }
  }
}

async fn process_frame(kind: u8, payload: Vec<u8>, endpoint_id: &str, shared_state: &SharedAppState) {
  match kind {
    FRAME_KIND_MESSAGE => parse_json_message(&payload, endpoint_id, shared_state).await,
    FRAME_KIND_BINARY => handle_binary_frame(&payload, endpoint_id, shared_state).await,
    FRAME_KIND_TELEMETRY_BINARY => handle_telemetry_frame(&payload, endpoint_id, shared_state).await,
    _ => {
      let mut state = shared_state.write().await;
      state.message_stats.parse_errors += 1;
      push_event(
        &mut state,
        EventLevel::Warn,
        format!("Unsupported frame kind {kind} from {endpoint_id}"),
        event_details(&[("endpointId", serde_json::json!(endpoint_id))]),
      );
    }
  }
}

async fn process_socket_buffer(endpoint_id: &str, shared_state: &SharedAppState, buffer: &mut Vec<u8>) -> Result<(), String> {
  loop {
    if buffer.len() < 5 {
      break;
    }

    let frame_kind = buffer[0];
    let frame_length = i32::from_be_bytes([buffer[1], buffer[2], buffer[3], buffer[4]]) as isize;
    if frame_length <= 0 || frame_length as usize > MAX_FRAME_BYTES {
      {
        let mut state = shared_state.write().await;
        state.message_stats.parse_errors += 1;
        push_event(
          &mut state,
          EventLevel::Warn,
          format!("Dropping client {endpoint_id}: invalid frame length {frame_length}"),
          event_details(&[("endpointId", serde_json::json!(endpoint_id))]),
        );
      }
      return Err(format!("invalid frame length {frame_length}"));
    }

    let frame_total_size = 5 + frame_length as usize;
    if buffer.len() < frame_total_size {
      break;
    }

    let payload = buffer[5..frame_total_size].to_vec();
    buffer.drain(0..frame_total_size);

    {
      let mut state = shared_state.write().await;
      state.message_stats.total_frames += 1;
      if frame_kind == FRAME_KIND_MESSAGE {
        state.message_stats.message_frames += 1;
      } else {
        state.message_stats.binary_frames += 1;
      }
    }

    process_frame(frame_kind, payload, endpoint_id, shared_state).await;
  }

  Ok(())
}

async fn setup_connection_state(
  addr: SocketAddr,
  endpoint_id: &str,
  writer: mpsc::UnboundedSender<Vec<u8>>,
  shared_state: &SharedAppState,
) {
  let mut state = shared_state.write().await;
  state.socket_writers.insert(endpoint_id.to_string(), writer);
  state.sockets_by_endpoint.insert(
    endpoint_id.to_string(),
    SocketContext {
      endpoint_id: endpoint_id.to_string(),
      buffer: Vec::new(),
    },
  );

  session::upsert_client(&mut state, endpoint_id, |client| {
    client.endpoint_id = endpoint_id.to_string();
    client.remote_address = addr.ip().to_string();
    client.remote_port = addr.port();
    client.connected_at_iso = chrono::Utc::now().to_rfc3339();
    client.last_seen_at_iso = chrono::Utc::now().to_rfc3339();
    client.stable_device_id = None;
    client.device_name = None;
    client.camera_facing = CameraFacing::Rear;
    client.distance_meters = None;
  });

  session::auto_assign_role_for_new_join(&mut state, endpoint_id);

  push_event(
    &mut state,
    EventLevel::Info,
    format!("TCP client connected: {endpoint_id}"),
    event_details(&[("endpointId", serde_json::json!(endpoint_id))]),
  );
}

async fn cleanup_connection_state(endpoint_id: &str, shared_state: &SharedAppState) {
  let stable_id = {
    let mut state = shared_state.write().await;
    let stable_id = state
      .clients_by_endpoint
      .get(endpoint_id)
      .and_then(|client| client.stable_device_id.clone());

    state.socket_writers.remove(endpoint_id);
    state.sockets_by_endpoint.remove(endpoint_id);
    state.clients_by_endpoint.remove(endpoint_id);

    if stable_id.is_none() {
      state.session_state.role_assignments.remove(endpoint_id);
      state.session_state.device_sensitivity_assignments.remove(endpoint_id);
      state.session_state.device_camera_facing_assignments.remove(endpoint_id);
      state.session_state.device_distance_assignments.remove(endpoint_id);
    }

    push_event(
      &mut state,
      EventLevel::Info,
      format!("TCP client disconnected: {endpoint_id}"),
      event_details(&[("endpointId", serde_json::json!(endpoint_id))]),
    );

    stable_id
  };

  let _ = stable_id;
  clock_sync::stop_clock_resync_loop_for_endpoint(shared_state, endpoint_id).await;
}

async fn writer_task(
  mut write_half: tokio::net::tcp::OwnedWriteHalf,
  mut rx: mpsc::UnboundedReceiver<Vec<u8>>,
  endpoint_id: String,
) {
  while let Some(frame) = rx.recv().await {
    if let Err(error) = write_half.write_all(&frame).await {
      warn!("Failed to write TCP frame to {}: {}", endpoint_id, error);
      break;
    }
  }
}

async fn handle_connection(stream: TcpStream, addr: SocketAddr, app_handle: tauri::AppHandle, shared_state: SharedAppState) {
  let endpoint_id = format!("{}:{}", addr.ip(), addr.port());
  if let Err(error) = stream.set_nodelay(true) {
    warn!("Failed to set TCP_NODELAY for {}: {}", endpoint_id, error);
  }

  let (read_half, write_half) = stream.into_split();
  let (tx, rx) = mpsc::unbounded_channel::<Vec<u8>>();

  setup_connection_state(addr, &endpoint_id, tx.clone(), &shared_state).await;
  tokio::spawn(writer_task(write_half, rx, endpoint_id.clone()));

  let _ = send_protocol_snapshot_to_endpoint(&shared_state, &endpoint_id).await;
  let _ = publish_state(&app_handle, &shared_state).await;

  let mut reader = read_half;
  let mut read_chunk = vec![0u8; 8192];
  let mut socket_buffer = Vec::<u8>::new();

  loop {
    match reader.read(&mut read_chunk).await {
      Ok(0) => break,
      Ok(bytes_read) => {
        socket_buffer.extend_from_slice(&read_chunk[..bytes_read]);

        {
          let mut state = shared_state.write().await;
          if let Some(context) = state.sockets_by_endpoint.get_mut(&endpoint_id) {
            context.buffer = socket_buffer.clone();
          }
          session::upsert_client(&mut state, &endpoint_id, |_| {});
        }

        if process_socket_buffer(&endpoint_id, &shared_state, &mut socket_buffer)
          .await
          .is_err()
        {
          break;
        }

        let _ = publish_state(&app_handle, &shared_state).await;
      }
      Err(error) => {
        warn!("Socket error from {}: {}", endpoint_id, error);
        {
          let mut state = shared_state.write().await;
          push_event(
            &mut state,
            EventLevel::Warn,
            format!("Socket error from {endpoint_id}: {error}"),
            event_details(&[("endpointId", serde_json::json!(endpoint_id))]),
          );
        }
        break;
      }
    }
  }

  cleanup_connection_state(&endpoint_id, &shared_state).await;
  let _ = broadcast_protocol_snapshots(&shared_state).await;
  let _ = publish_state(&app_handle, &shared_state).await;
}

pub async fn start_tcp_server(app_handle: tauri::AppHandle, shared_state: SharedAppState) -> Result<(), String> {
  let (host, port) = {
    let state = shared_state.read().await;
    (state.config.tcp_host.clone(), state.config.tcp_port)
  };

  let listener = TcpListener::bind(format!("{}:{}", host, port))
    .await
    .map_err(|error| format!("failed to bind TCP listener: {error}"))?;

  info!("TCP server listening on {}:{}", host, port);

  {
    let mut state = shared_state.write().await;
    push_event(
      &mut state,
      EventLevel::Info,
      format!("TCP server listening on {host}:{port}"),
      BTreeMap::new(),
    );
  }

  let _ = publish_state(&app_handle, &shared_state).await;

  loop {
    match listener.accept().await {
      Ok((stream, addr)) => {
        let cloned_state = shared_state.clone();
        let cloned_app = app_handle.clone();
        tokio::spawn(async move {
          handle_connection(stream, addr, cloned_app, cloned_state).await;
        });
      }
      Err(error) => {
        error!("TCP accept error: {}", error);
        let mut state = shared_state.write().await;
        push_event(
          &mut state,
          EventLevel::Error,
          format!("TCP server error: {error}"),
          BTreeMap::new(),
        );
      }
    }
  }
}

pub async fn send_frame_to_endpoint(shared_state: &SharedAppState, endpoint_id: &str, frame: Vec<u8>) -> bool {
  let sender = {
    let state = shared_state.read().await;
    state.socket_writers.get(endpoint_id).cloned()
  };

  if let Some(channel) = sender {
    channel.send(frame).is_ok()
  } else {
    false
  }
}

pub async fn send_clock_resync_request_to_endpoint(
  shared_state: &SharedAppState,
  endpoint_id: &str,
  sample_count: i32,
) -> bool {
  let Some(frame) = flatbuf_codec::encode_clock_resync_request(sample_count) else {
    return false;
  };
  send_frame_to_endpoint(shared_state, endpoint_id, frame).await
}

pub async fn send_device_config_update_to_endpoint(
  shared_state: &SharedAppState,
  endpoint_id: &str,
  target_stable_device_id: &str,
  sensitivity: i32,
) -> bool {
  let Some(frame) = flatbuf_codec::encode_device_config_update(target_stable_device_id, sensitivity) else {
    return false;
  };
  send_frame_to_endpoint(shared_state, endpoint_id, frame).await
}

pub async fn send_protocol_snapshot_to_endpoint(shared_state: &SharedAppState, endpoint_id: &str) -> bool {
  let protocol_snapshot = {
    let state = shared_state.read().await;
    session::create_protocol_snapshot_for_endpoint(&state, endpoint_id)
  };

  let Some(snapshot) = protocol_snapshot else {
    return false;
  };

  let Some(frame) = flatbuf_codec::encode_session_snapshot(&snapshot) else {
    return false;
  };

  send_frame_to_endpoint(shared_state, endpoint_id, frame).await
}

pub async fn broadcast_protocol_snapshots(shared_state: &SharedAppState) -> usize {
  let endpoint_ids = {
    let state = shared_state.read().await;
    state.socket_writers.keys().cloned().collect::<Vec<_>>()
  };

  let mut sent = 0;
  for endpoint_id in endpoint_ids {
    if send_protocol_snapshot_to_endpoint(shared_state, &endpoint_id).await {
      sent += 1;
    }
  }
  sent
}

pub async fn broadcast_protocol_trigger(
  shared_state: &SharedAppState,
  trigger_type: &str,
  trigger_sensor_nanos: i64,
  split_index: Option<i32>,
) -> usize {
  let Some(frame) = flatbuf_codec::encode_session_trigger(trigger_type, trigger_sensor_nanos, split_index) else {
    return 0;
  };

  let endpoint_ids = {
    let state = shared_state.read().await;
    state.socket_writers.keys().cloned().collect::<Vec<_>>()
  };

  let mut sent = 0;
  for endpoint_id in endpoint_ids {
    if send_frame_to_endpoint(shared_state, &endpoint_id, frame.clone()).await {
      sent += 1;
    }
  }
  sent
}

pub async fn broadcast_protocol_trigger_refinement(
  shared_state: &SharedAppState,
  role: WireRole,
  provisional_host_sensor_nanos: i64,
  refined_host_sensor_nanos: i64,
) -> usize {
  let run_id = {
    let state = shared_state.read().await;
    state.session_state.run_id.clone()
  };

  let Some(run_id_value) = run_id else {
    return 0;
  };

  let Some(frame) = flatbuf_codec::encode_trigger_refinement(
    &run_id_value,
    role,
    provisional_host_sensor_nanos,
    refined_host_sensor_nanos,
  ) else {
    return 0;
  };

  let endpoint_ids = {
    let state = shared_state.read().await;
    state.socket_writers.keys().cloned().collect::<Vec<_>>()
  };

  let mut sent = 0;
  for endpoint_id in endpoint_ids {
    if send_frame_to_endpoint(shared_state, &endpoint_id, frame.clone()).await {
      sent += 1;
    }
  }

  sent
}

pub async fn broadcast_timeline_snapshot(shared_state: &SharedAppState) -> usize {
  let payload = {
    let state = shared_state.read().await;
    session::create_timeline_snapshot_payload(&state)
  };

  let Some(frame) = flatbuf_codec::encode_timeline_snapshot(&payload) else {
    return 0;
  };

  let endpoint_ids = {
    let state = shared_state.read().await;
    state.socket_writers.keys().cloned().collect::<Vec<_>>()
  };

  let mut sent = 0;
  for endpoint_id in endpoint_ids {
    if send_frame_to_endpoint(shared_state, &endpoint_id, frame.clone()).await {
      sent += 1;
    }
  }

  sent
}
