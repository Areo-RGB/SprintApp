use crate::clock_sync;
use crate::events::{publish_state, push_event};
use crate::results;
use crate::session;
use crate::state::{
  CameraFacing, CompareResultsPayload, EventLevel, RoleLabel, SavedResultSummary, SessionStage, SharedAppState,
  Snapshot,
};
use serde::{Deserialize, Serialize};
use specta::Type;
use std::collections::BTreeMap;

fn event_details(values: &[(&str, serde_json::Value)]) -> BTreeMap<String, serde_json::Value> {
  let mut details = BTreeMap::new();
  for (key, value) in values {
    details.insert((*key).to_string(), value.clone());
  }
  details
}

fn normalize_athlete_name_for_result(raw_value: Option<&str>) -> Option<String> {
  let normalized = raw_value.unwrap_or_default().trim().to_lowercase();
  if normalized.is_empty() {
    return None;
  }

  let replaced = normalized
    .chars()
    .map(|character| {
      if character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.') {
        character
      } else {
        '_'
      }
    })
    .collect::<String>();

  let collapsed = replaced.trim_matches('_').to_string();
  if collapsed.is_empty() {
    None
  } else {
    Some(collapsed)
  }
}

fn format_date_for_result_name(timestamp_iso: &str) -> String {
  chrono::DateTime::parse_from_rfc3339(timestamp_iso)
    .map(|timestamp| timestamp.format("%d_%m_%Y").to_string())
    .unwrap_or_else(|_| chrono::Utc::now().format("%d_%m_%Y").to_string())
}

#[derive(Serialize, Deserialize, Clone, Debug, Type)]
#[serde(rename_all = "camelCase")]
pub struct GenericOkResponse {
  pub ok: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug, Type)]
#[serde(rename_all = "camelCase")]
pub struct HealthResponse {
  pub ok: bool,
  pub timestamp_iso: String,
  pub uptime_ms: i64,
}

#[derive(Serialize, Deserialize, Clone, Debug, Type)]
#[serde(rename_all = "camelCase")]
pub struct StartMonitoringResponse {
  pub ok: bool,
  pub run_id: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, Type)]
#[serde(rename_all = "camelCase")]
pub struct TriggerResponse {
  pub ok: bool,
  pub trigger_type: String,
  pub split_index: i32,
  pub trigger_sensor_nanos: i64,
}

#[derive(Serialize, Deserialize, Clone, Debug, Type)]
#[serde(rename_all = "camelCase")]
pub struct SaveResultsResponse {
  pub ok: bool,
  pub file_path: String,
  pub file_name: String,
  pub result_name: String,
  pub athlete_name: Option<String>,
  pub notes: Option<String>,
  pub saved_at_iso: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, Type)]
#[serde(rename_all = "camelCase")]
pub struct ListResultsResponse {
  pub ok: bool,
  pub items: Vec<SavedResultSummary>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Type)]
#[serde(rename_all = "camelCase")]
pub struct LoadResultResponse {
  pub ok: bool,
  pub file_name: String,
  pub file_path: String,
  pub payload: serde_json::Value,
}

#[derive(Serialize, Deserialize, Clone, Debug, Type)]
#[serde(rename_all = "camelCase")]
pub struct DeviceConfigResponse {
  pub ok: bool,
  pub target_id: String,
  pub sensitivity: Option<i32>,
  pub camera_facing: Option<CameraFacing>,
  pub distance_meters: Option<f64>,
  pub endpoint_count: usize,
}

#[derive(Serialize, Deserialize, Clone, Debug, Type)]
#[serde(rename_all = "camelCase")]
pub struct ResyncResponse {
  pub ok: bool,
  pub target_id: String,
  pub sample_count: i32,
  pub target_latency_ms: i32,
  pub endpoint_count: usize,
  pub dispatched_count: usize,
}

#[derive(Serialize, Deserialize, Clone, Debug, Type)]
#[serde(rename_all = "camelCase")]
pub struct FireTriggerRequest {
  pub role: Option<String>,
  pub trigger_type: Option<String>,
  pub split_index: Option<i32>,
  pub trigger_sensor_nanos: Option<i64>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Type)]
#[serde(rename_all = "camelCase")]
pub struct AssignRoleRequest {
  pub target_id: String,
  pub role: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, Type)]
#[serde(rename_all = "camelCase")]
pub struct DeviceConfigRequest {
  pub target_id: String,
  pub sensitivity: Option<i32>,
  pub camera_facing: Option<String>,
  pub distance_meters: Option<f64>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Type)]
#[serde(rename_all = "camelCase")]
pub struct ResyncDeviceRequest {
  pub target_id: String,
  pub sample_count: Option<i32>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Type)]
#[serde(rename_all = "camelCase")]
pub struct SaveResultsRequest {
  pub name: Option<String>,
  pub athlete_name: Option<String>,
  pub notes: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Type)]
#[serde(rename_all = "camelCase")]
pub struct CompareResultsRequest {
  pub file_names: Vec<String>,
  pub athlete_name: Option<String>,
}

#[tauri::command]
pub async fn get_health(state: tauri::State<'_, SharedAppState>) -> Result<HealthResponse, String> {
  let state = state.inner().clone();
  let locked_state = state.read().await;
  Ok(HealthResponse {
    ok: true,
    timestamp_iso: chrono::Utc::now().to_rfc3339(),
    uptime_ms: (chrono::Utc::now().timestamp_millis() - locked_state.started_at_ms).max(0),
  })
}

#[tauri::command]
pub async fn get_state(state: tauri::State<'_, SharedAppState>) -> Result<Snapshot, String> {
  let state = state.inner().clone();
  let locked_state = state.read().await;
  Ok(session::create_snapshot(&locked_state))
}

#[tauri::command]
pub async fn start_monitoring(
  app_handle: tauri::AppHandle,
  state: tauri::State<'_, SharedAppState>,
) -> Result<StartMonitoringResponse, String> {
  let shared_state = state.inner().clone();

  let run_id = {
    let mut locked_state = shared_state.write().await;
    session::start_monitoring(&mut locked_state)?
  };

  let endpoint_ids = {
    let locked_state = shared_state.read().await;
    locked_state.socket_writers.keys().cloned().collect::<Vec<_>>()
  };

  for endpoint_id in endpoint_ids {
    let _ = clock_sync::start_clock_resync_loop_for_endpoint(
      app_handle.clone(),
      shared_state.clone(),
      endpoint_id,
      clock_sync::CLOCK_RESYNC_DEFAULT_SAMPLE_COUNT,
      clock_sync::CLOCK_RESYNC_TARGET_LATENCY_MS,
    )
    .await;
  }

  let _ = crate::tcp_server::broadcast_protocol_snapshots(&shared_state).await;
  let _ = crate::tcp_server::broadcast_timeline_snapshot(&shared_state).await;
  let _ = publish_state(&app_handle, &shared_state).await;

  Ok(StartMonitoringResponse { ok: true, run_id })
}

#[tauri::command]
pub async fn stop_monitoring(
  app_handle: tauri::AppHandle,
  state: tauri::State<'_, SharedAppState>,
) -> Result<GenericOkResponse, String> {
  let shared_state = state.inner().clone();

  {
    let mut locked_state = shared_state.write().await;
    session::stop_monitoring(&mut locked_state);
  }

  clock_sync::stop_all_clock_resync_loops(&shared_state).await;
  let _ = crate::tcp_server::broadcast_protocol_snapshots(&shared_state).await;
  let _ = publish_state(&app_handle, &shared_state).await;

  Ok(GenericOkResponse { ok: true })
}

#[tauri::command]
pub async fn start_lobby(
  app_handle: tauri::AppHandle,
  state: tauri::State<'_, SharedAppState>,
) -> Result<GenericOkResponse, String> {
  let shared_state = state.inner().clone();

  {
    let mut locked_state = shared_state.write().await;
    session::start_lobby(&mut locked_state);
  }

  let _ = crate::tcp_server::broadcast_protocol_snapshots(&shared_state).await;
  let _ = crate::tcp_server::broadcast_timeline_snapshot(&shared_state).await;
  let _ = publish_state(&app_handle, &shared_state).await;

  Ok(GenericOkResponse { ok: true })
}

#[tauri::command]
pub async fn reset_laps(
  app_handle: tauri::AppHandle,
  state: tauri::State<'_, SharedAppState>,
) -> Result<GenericOkResponse, String> {
  let shared_state = state.inner().clone();
  {
    let mut locked_state = shared_state.write().await;
    session::reset_laps(&mut locked_state);
  }

  let _ = publish_state(&app_handle, &shared_state).await;
  Ok(GenericOkResponse { ok: true })
}

#[tauri::command]
pub async fn reset_run(
  app_handle: tauri::AppHandle,
  state: tauri::State<'_, SharedAppState>,
) -> Result<GenericOkResponse, String> {
  let shared_state = state.inner().clone();
  {
    let mut locked_state = shared_state.write().await;
    session::reset_run(&mut locked_state);
  }

  let _ = crate::tcp_server::broadcast_protocol_snapshots(&shared_state).await;
  let _ = crate::tcp_server::broadcast_timeline_snapshot(&shared_state).await;
  let _ = publish_state(&app_handle, &shared_state).await;

  Ok(GenericOkResponse { ok: true })
}

#[tauri::command]
pub async fn return_setup(
  app_handle: tauri::AppHandle,
  state: tauri::State<'_, SharedAppState>,
) -> Result<GenericOkResponse, String> {
  let shared_state = state.inner().clone();
  {
    let mut locked_state = shared_state.write().await;
    session::return_setup(&mut locked_state);
  }

  let _ = crate::tcp_server::broadcast_protocol_snapshots(&shared_state).await;
  let _ = crate::tcp_server::broadcast_timeline_snapshot(&shared_state).await;
  let _ = publish_state(&app_handle, &shared_state).await;

  Ok(GenericOkResponse { ok: true })
}

#[tauri::command]
pub async fn fire_trigger(
  payload: FireTriggerRequest,
  app_handle: tauri::AppHandle,
  state: tauri::State<'_, SharedAppState>,
) -> Result<TriggerResponse, String> {
  let shared_state = state.inner().clone();

  let (trigger_type_label, split_index, trigger_sensor_nanos) = {
    let mut locked_state = shared_state.write().await;

    if !locked_state.session_state.monitoring_active
      || !matches!(locked_state.session_state.stage, SessionStage::Monitoring)
    {
      return Err("monitoring is not active".to_string());
    }

    let trigger_spec = session::trigger_spec_from_control_payload(
      payload.role.as_deref(),
      payload.trigger_type.as_deref(),
      payload.split_index,
    )
    .ok_or_else(|| "invalid trigger payload".to_string())?;

    let trigger_sensor_nanos = payload
      .trigger_sensor_nanos
      .unwrap_or_else(clock_sync::now_host_elapsed_nanos);

    if !session::apply_trigger_to_host_timeline(&mut locked_state, &trigger_spec, trigger_sensor_nanos) {
      return Err("trigger rejected by timeline state".to_string());
    }

    push_event(
      &mut locked_state,
      EventLevel::Info,
      format!("Operator trigger fired: {}", session::trigger_label_for_spec(&trigger_spec)),
      event_details(&[
        ("triggerType", serde_json::json!(format!("{:?}", trigger_spec.trigger_type).to_lowercase())),
        ("splitIndex", serde_json::json!(trigger_spec.split_index)),
        ("triggerSensorNanos", serde_json::json!(trigger_sensor_nanos)),
      ]),
    );

    (
      format!("{:?}", trigger_spec.trigger_type).to_lowercase(),
      trigger_spec.split_index,
      trigger_sensor_nanos,
    )
  };

  let split_index_optional = if split_index > 0 { Some(split_index) } else { None };

  let _ = crate::tcp_server::broadcast_protocol_trigger(
    &shared_state,
    &trigger_type_label,
    trigger_sensor_nanos,
    split_index_optional,
  )
  .await;
  let _ = crate::tcp_server::broadcast_timeline_snapshot(&shared_state).await;
  let _ = crate::tcp_server::broadcast_protocol_snapshots(&shared_state).await;
  let _ = publish_state(&app_handle, &shared_state).await;

  Ok(TriggerResponse {
    ok: true,
    trigger_type: trigger_type_label,
    split_index,
    trigger_sensor_nanos,
  })
}

#[tauri::command]
pub async fn assign_role(
  payload: AssignRoleRequest,
  app_handle: tauri::AppHandle,
  state: tauri::State<'_, SharedAppState>,
) -> Result<GenericOkResponse, String> {
  let shared_state = state.inner().clone();
  let role = RoleLabel::from_label(&payload.role).ok_or_else(|| "invalid role".to_string())?;

  {
    let mut locked_state = shared_state.write().await;
    session::assign_role(&mut locked_state, &payload.target_id, role)?;
  }

  let _ = crate::tcp_server::broadcast_protocol_snapshots(&shared_state).await;
  let _ = publish_state(&app_handle, &shared_state).await;

  Ok(GenericOkResponse { ok: true })
}

#[tauri::command]
pub async fn update_device_config(
  payload: DeviceConfigRequest,
  app_handle: tauri::AppHandle,
  state: tauri::State<'_, SharedAppState>,
) -> Result<DeviceConfigResponse, String> {
  let shared_state = state.inner().clone();

  let camera_facing = if let Some(raw_camera_facing) = payload.camera_facing.as_deref() {
    Some(
      session::normalize_camera_facing(raw_camera_facing)
        .ok_or_else(|| "cameraFacing must be rear or front".to_string())?,
    )
  } else {
    None
  };

  let (target_id, sensitivity, camera_facing, distance_meters, endpoint_count) = {
    let mut locked_state = shared_state.write().await;
    session::update_device_config(
      &mut locked_state,
      &payload.target_id,
      payload.sensitivity,
      camera_facing,
      payload.distance_meters,
    )?
  };

  if let Some(next_sensitivity) = sensitivity {
    let endpoint_ids = {
      let locked_state = shared_state.read().await;
      session::resolve_endpoint_ids_for_target_id(&locked_state, &target_id)
    };

    for endpoint_id in endpoint_ids {
      let _ = crate::tcp_server::send_device_config_update_to_endpoint(
        &shared_state,
        &endpoint_id,
        &target_id,
        next_sensitivity,
      )
      .await;
    }
  }

  let _ = crate::tcp_server::broadcast_protocol_snapshots(&shared_state).await;
  let _ = publish_state(&app_handle, &shared_state).await;

  Ok(DeviceConfigResponse {
    ok: true,
    target_id,
    sensitivity,
    camera_facing,
    distance_meters,
    endpoint_count,
  })
}

#[tauri::command]
pub async fn resync_device(
  payload: ResyncDeviceRequest,
  app_handle: tauri::AppHandle,
  state: tauri::State<'_, SharedAppState>,
) -> Result<ResyncResponse, String> {
  let shared_state = state.inner().clone();

  if payload.target_id.trim().is_empty() {
    return Err("targetId is required".to_string());
  }

  let requested_sample_count = payload
    .sample_count
    .unwrap_or(clock_sync::CLOCK_RESYNC_DEFAULT_SAMPLE_COUNT);
  let sample_count = clock_sync::normalize_clock_resync_sample_count(requested_sample_count).ok_or_else(|| {
    format!(
      "sampleCount must be an integer in the range {}..{}",
      clock_sync::CLOCK_RESYNC_MIN_SAMPLE_COUNT,
      clock_sync::CLOCK_RESYNC_MAX_SAMPLE_COUNT
    )
  })?;

  let target_id = {
    let locked_state = shared_state.read().await;
    session::canonical_target_id(&locked_state, &payload.target_id)
  };

  let endpoint_ids = {
    let locked_state = shared_state.read().await;
    session::resolve_endpoint_ids_for_target_id(&locked_state, &target_id)
  };

  if endpoint_ids.is_empty() {
    return Err(format!("no connected endpoint for targetId {target_id}"));
  }

  let mut dispatched_count = 0usize;
  for endpoint_id in &endpoint_ids {
    if clock_sync::start_clock_resync_loop_for_endpoint(
      app_handle.clone(),
      shared_state.clone(),
      endpoint_id.clone(),
      sample_count,
      clock_sync::CLOCK_RESYNC_TARGET_LATENCY_MS,
    )
    .await
    {
      dispatched_count += 1;
    }
  }

  if dispatched_count == 0 {
    return Err(format!("failed to dispatch resync request for targetId {target_id}"));
  }

  {
    let mut locked_state = shared_state.write().await;
    push_event(
      &mut locked_state,
      EventLevel::Info,
      format!("Clock resync requested: {target_id}"),
      event_details(&[
        ("targetId", serde_json::json!(target_id)),
        ("sampleCount", serde_json::json!(sample_count)),
        (
          "targetLatencyMs",
          serde_json::json!(clock_sync::CLOCK_RESYNC_TARGET_LATENCY_MS),
        ),
        ("endpointCount", serde_json::json!(endpoint_ids.len())),
        ("dispatchedCount", serde_json::json!(dispatched_count)),
      ]),
    );
  }

  let _ = crate::tcp_server::broadcast_protocol_snapshots(&shared_state).await;
  let _ = publish_state(&app_handle, &shared_state).await;

  Ok(ResyncResponse {
    ok: true,
    target_id,
    sample_count,
    target_latency_ms: clock_sync::CLOCK_RESYNC_TARGET_LATENCY_MS,
    endpoint_count: endpoint_ids.len(),
    dispatched_count,
  })
}

#[tauri::command]
pub async fn save_results(
  payload: SaveResultsRequest,
  app_handle: tauri::AppHandle,
  state: tauri::State<'_, SharedAppState>,
) -> Result<SaveResultsResponse, String> {
  let shared_state = state.inner().clone();
  let snapshot = {
    let locked_state = shared_state.read().await;
    session::create_snapshot(&locked_state)
  };

  let export_timestamp_iso = chrono::Utc::now().to_rfc3339();
  let athlete_name = normalize_athlete_name_for_result(payload.athlete_name.as_deref());
  let notes = payload
    .notes
    .as_deref()
    .map(str::trim)
    .filter(|value| !value.is_empty())
    .map(|value| value.chars().take(240).collect::<String>());

  let requested_name = payload
    .name
    .as_deref()
    .map(str::trim)
    .filter(|value| !value.is_empty())
    .unwrap_or_default();

  let athlete_date_name = athlete_name
    .as_deref()
    .map(|name| format!("{}_{}", name, format_date_for_result_name(&export_timestamp_iso)))
    .unwrap_or_default();

  let run_segment = results::sanitize_file_name_segment(
    if !requested_name.is_empty() {
      requested_name
    } else if !athlete_date_name.is_empty() {
      athlete_date_name.as_str()
    } else if let Some(run_id) = snapshot.session.run_id.as_deref() {
      run_id
    } else {
      "run"
    },
  );

  let timestamp_segment = export_timestamp_iso.replace([':', '.'], "-");
  let file_name = format!("{}_{}.json", run_segment, timestamp_segment);

  let export_payload = crate::state::SavedResultsFilePayload {
    r#type: "windows_results_export".to_string(),
    result_name: run_segment.clone(),
    athlete_name: athlete_name.clone(),
    notes: notes.clone(),
    naming_format: "athlete_dd_MM_yyyy".to_string(),
    exported_at_iso: export_timestamp_iso.clone(),
    exported_at_ms: chrono::Utc::now().timestamp_millis(),
    run_id: snapshot.session.run_id.clone(),
    session: snapshot.session.clone(),
    clients: snapshot.clients.clone(),
    latest_lap_results: snapshot.latest_lap_results.clone(),
    lap_history: snapshot.lap_history.clone(),
    recent_events: snapshot.recent_events.clone(),
  };

  let results_dir = results::app_results_dir(&app_handle)?;
  let file_path = results::save_results(&results_dir, &file_name, &export_payload).await?;

  {
    let mut locked_state = shared_state.write().await;
    locked_state.session_state.last_saved_results_file_path = Some(file_path.clone());
    locked_state.session_state.last_saved_results_at_iso = Some(export_timestamp_iso.clone());
    push_event(
      &mut locked_state,
      EventLevel::Info,
      format!("Results saved to {file_path}"),
      BTreeMap::new(),
    );
  }

  let _ = publish_state(&app_handle, &shared_state).await;

  Ok(SaveResultsResponse {
    ok: true,
    file_path,
    file_name,
    result_name: run_segment,
    athlete_name,
    notes,
    saved_at_iso: export_timestamp_iso,
  })
}

#[tauri::command]
pub async fn clear_events(
  app_handle: tauri::AppHandle,
  state: tauri::State<'_, SharedAppState>,
) -> Result<GenericOkResponse, String> {
  let shared_state = state.inner().clone();

  {
    let mut locked_state = shared_state.write().await;
    locked_state.recent_events.clear();
    push_event(
      &mut locked_state,
      EventLevel::Info,
      "Operator cleared event log",
      BTreeMap::new(),
    );
  }

  let _ = publish_state(&app_handle, &shared_state).await;
  Ok(GenericOkResponse { ok: true })
}

#[tauri::command]
pub async fn list_results(app_handle: tauri::AppHandle) -> Result<ListResultsResponse, String> {
  let results_dir = results::app_results_dir(&app_handle)?;
  let items = results::list_saved_result_items(&results_dir).await?;
  Ok(ListResultsResponse { ok: true, items })
}

#[tauri::command]
pub async fn load_result(file_name: String, app_handle: tauri::AppHandle) -> Result<LoadResultResponse, String> {
  let results_dir = results::app_results_dir(&app_handle)?;

  if !results::is_safe_saved_results_file_name(&file_name) {
    return Err("invalid file name".to_string());
  }

  let Some(loaded) = results::load_saved_results_file(&results_dir, &file_name).await? else {
    return Err("saved result not found".to_string());
  };

  Ok(LoadResultResponse {
    ok: true,
    file_name: loaded.file_name,
    file_path: loaded.file_path,
    payload: serde_json::to_value(loaded.payload)
      .map_err(|error| format!("failed to serialize loaded payload: {error}"))?,
  })
}

#[tauri::command]
pub async fn compare_results(
  payload: CompareResultsRequest,
  app_handle: tauri::AppHandle,
) -> Result<CompareResultsPayload, String> {
  let results_dir = results::app_results_dir(&app_handle)?;
  results::compare_results(&results_dir, &payload.file_names, payload.athlete_name.as_deref()).await
}
