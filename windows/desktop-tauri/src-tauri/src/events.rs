use crate::session;
use crate::state::{AppState, EventLevel, ServerEvent, SharedAppState, Snapshot, EVENT_LIMIT};
use serde_json::Value;
use std::collections::BTreeMap;
use tauri::Emitter;
use tracing::{error, info, warn};

fn append_bounded<T>(items: &mut Vec<T>, value: T, max_size: usize) {
  items.push(value);
  if items.len() > max_size {
    let drain_count = items.len() - max_size;
    items.drain(0..drain_count);
  }
}

pub fn push_event(
  state: &mut AppState,
  level: EventLevel,
  message: impl Into<String>,
  details: BTreeMap<String, Value>,
) -> ServerEvent {
  let message_text = message.into();
  let event = ServerEvent {
    id: format!("event-{}", state.next_event_id),
    timestamp_iso: chrono::Utc::now().to_rfc3339(),
    level: level.clone(),
    message: message_text.clone(),
    details,
  };
  state.next_event_id += 1;
  append_bounded(&mut state.recent_events, event.clone(), EVENT_LIMIT);

  match level {
    EventLevel::Info => info!("{}", message_text),
    EventLevel::Warn => warn!("{}", message_text),
    EventLevel::Error => error!("{}", message_text),
  }

  event
}

pub async fn publish_state(app_handle: &tauri::AppHandle, shared_state: &SharedAppState) -> Result<Snapshot, String> {
  let snapshot = {
    let state = shared_state.read().await;
    session::create_snapshot(&state)
  };

  app_handle
    .emit("state-update", snapshot.clone())
    .map_err(|error| format!("failed to emit state-update event: {error}"))?;

  Ok(snapshot)
}
