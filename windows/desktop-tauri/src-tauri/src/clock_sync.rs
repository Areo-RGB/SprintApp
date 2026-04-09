use crate::events::push_event;
use crate::session;
use crate::state::{
  AppState, ClockResyncLoopState, EventLevel, SharedAppState, FRAME_KIND_BINARY,
};
use once_cell::sync::OnceCell;
use serde_json::json;
use std::collections::BTreeMap;
use std::time::{Duration, Instant};

pub const CLOCK_SYNC_VERSION: u8 = 1;
pub const CLOCK_SYNC_TYPE_REQUEST: u8 = 1;
pub const CLOCK_SYNC_TYPE_RESPONSE: u8 = 2;
pub const CLOCK_SYNC_REQUEST_BYTES: usize = 10;
pub const CLOCK_SYNC_RESPONSE_BYTES: usize = 26;
pub const CLOCK_RESYNC_MIN_SAMPLE_COUNT: i32 = 3;
pub const CLOCK_RESYNC_MAX_SAMPLE_COUNT: i32 = 24;
pub const CLOCK_RESYNC_DEFAULT_SAMPLE_COUNT: i32 = 8;
pub const CLOCK_RESYNC_TARGET_LATENCY_MS: i32 = 50;
pub const CLOCK_RESYNC_RETRY_DELAY_MS: i32 = 1200;

static CLOCK_MONOTONIC_START: OnceCell<Instant> = OnceCell::new();

fn event_details(values: &[(&str, serde_json::Value)]) -> BTreeMap<String, serde_json::Value> {
  let mut details = BTreeMap::new();
  for (key, value) in values {
    details.insert((*key).to_string(), value.clone());
  }
  details
}

fn wrap_binary_frame(payload: &[u8]) -> Vec<u8> {
  let mut frame = Vec::with_capacity(5 + payload.len());
  frame.push(FRAME_KIND_BINARY);
  frame.extend_from_slice(&(payload.len() as i32).to_be_bytes());
  frame.extend_from_slice(payload);
  frame
}

pub fn now_host_elapsed_nanos() -> i64 {
  let start = CLOCK_MONOTONIC_START.get_or_init(Instant::now);
  let elapsed_nanos_u128 = start.elapsed().as_nanos();
  if elapsed_nanos_u128 > i64::MAX as u128 {
    i64::MAX
  } else {
    elapsed_nanos_u128 as i64
  }
}

pub fn handle_clock_sync_request(state: &mut AppState, endpoint_id: &str, payload: &[u8]) -> Option<Vec<u8>> {
  if payload.len() != CLOCK_SYNC_REQUEST_BYTES {
    state.clock_domain_state.ignored_frames += 1;
    state.message_stats.parse_errors += 1;
    return None;
  }

  let version = payload[0];
  let payload_type = payload[1];
  if version != CLOCK_SYNC_VERSION || payload_type != CLOCK_SYNC_TYPE_REQUEST {
    state.clock_domain_state.ignored_frames += 1;
    state.message_stats.parse_errors += 1;
    return None;
  }

  let client_send_elapsed_nanos = i64::from_be_bytes(payload[2..10].try_into().ok()?);
  let host_receive_elapsed_nanos = now_host_elapsed_nanos();
  let host_send_elapsed_nanos = now_host_elapsed_nanos();

  let mut response = [0u8; CLOCK_SYNC_RESPONSE_BYTES];
  response[0] = CLOCK_SYNC_VERSION;
  response[1] = CLOCK_SYNC_TYPE_RESPONSE;
  response[2..10].copy_from_slice(&client_send_elapsed_nanos.to_be_bytes());
  response[10..18].copy_from_slice(&host_receive_elapsed_nanos.to_be_bytes());
  response[18..26].copy_from_slice(&host_send_elapsed_nanos.to_be_bytes());

  let timestamp_iso = chrono::Utc::now().to_rfc3339();
  state.clock_domain_state.samples_responded += 1;
  state.clock_domain_state.last_endpoint_id = Some(endpoint_id.to_string());
  state.clock_domain_state.last_request_at_iso = Some(timestamp_iso.clone());
  state.clock_domain_state.last_response_at_iso = Some(timestamp_iso);
  state.clock_domain_state.last_host_receive_elapsed_nanos = Some(host_receive_elapsed_nanos.to_string());
  state.clock_domain_state.last_host_send_elapsed_nanos = Some(host_send_elapsed_nanos.to_string());

  Some(wrap_binary_frame(&response))
}

pub fn normalize_clock_resync_sample_count(sample_count: i32) -> Option<i32> {
  if sample_count < CLOCK_RESYNC_MIN_SAMPLE_COUNT || sample_count > CLOCK_RESYNC_MAX_SAMPLE_COUNT {
    return None;
  }
  Some(sample_count)
}

pub async fn stop_clock_resync_loop_for_endpoint(shared_state: &SharedAppState, endpoint_id: &str) {
  let mut state = shared_state.write().await;
  state.clock_resync_loops_by_endpoint.remove(endpoint_id);
}

pub async fn stop_all_clock_resync_loops(shared_state: &SharedAppState) {
  let mut state = shared_state.write().await;
  state.clock_resync_loops_by_endpoint.clear();
}

pub async fn try_complete_clock_resync_loop(
  shared_state: &SharedAppState,
  endpoint_id: &str,
  source: &str,
) -> bool {
  let mut state = shared_state.write().await;
  session::try_complete_clock_resync_loop(&mut state, endpoint_id, source)
}

pub async fn start_clock_resync_loop_for_endpoint(
  app_handle: tauri::AppHandle,
  shared_state: SharedAppState,
  endpoint_id: String,
  sample_count: i32,
  target_latency_ms: i32,
) -> bool {
  let Some(normalized_sample_count) = normalize_clock_resync_sample_count(sample_count) else {
    return false;
  };

  let normalized_target_latency = if target_latency_ms > 0 {
    target_latency_ms
  } else {
    CLOCK_RESYNC_TARGET_LATENCY_MS
  };

  {
    let mut state = shared_state.write().await;
    if !state.socket_writers.contains_key(&endpoint_id) {
      return false;
    }

    state.clock_resync_loops_by_endpoint.insert(
      endpoint_id.clone(),
      ClockResyncLoopState {
        sample_count: normalized_sample_count,
        target_latency_ms: normalized_target_latency,
        attempts: 0,
        timer_active: true,
      },
    );
  }

  let task_state = shared_state.clone();
  let task_endpoint = endpoint_id.clone();
  tauri::async_runtime::spawn(async move {
    loop {
      let should_continue = {
        let mut state = task_state.write().await;
        if !state.clock_resync_loops_by_endpoint.contains_key(&task_endpoint) {
          false
        } else if !state.socket_writers.contains_key(&task_endpoint) {
          state.clock_resync_loops_by_endpoint.remove(&task_endpoint);
          false
        } else if session::try_complete_clock_resync_loop(&mut state, &task_endpoint, "before_send") {
          false
        } else {
          true
        }
      };

      if !should_continue {
        break;
      }

      let sent = crate::tcp_server::send_clock_resync_request_to_endpoint(
        &task_state,
        &task_endpoint,
        normalized_sample_count,
      )
      .await;

      if !sent {
        let mut state = task_state.write().await;
        push_event(
          &mut state,
          EventLevel::Warn,
          format!("Clock resync request send failed for {task_endpoint}"),
          event_details(&[("endpointId", json!(task_endpoint))]),
        );
        state.clock_resync_loops_by_endpoint.remove(&task_endpoint);
        break;
      }

      {
        let mut state = task_state.write().await;
        if let Some(loop_state) = state.clock_resync_loops_by_endpoint.get_mut(&task_endpoint) {
          loop_state.attempts += 1;
          loop_state.timer_active = true;
        }
      }

      tokio::time::sleep(Duration::from_millis(CLOCK_RESYNC_RETRY_DELAY_MS as u64)).await;
    }

    let _ = crate::events::publish_state(&app_handle, &task_state).await;
  });

  true
}
