#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod clock_sync;
mod commands;
mod events;
mod flatbuf_codec;
mod generated;
mod results;
mod session;
mod state;
mod tcp_server;

use state::{AppConfig, AppState, SharedAppState};
use std::env;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::{error, info};

fn init_tracing() {
  let builder = tracing_subscriber::FmtSubscriber::builder()
    .with_target(false)
    .with_thread_ids(false)
    .with_level(true)
    .with_env_filter(
      tracing_subscriber::EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
    );

  let _ = builder.try_init();
}

fn build_shared_state() -> SharedAppState {
  let cwd = env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
  let config = AppConfig {
    tcp_host: env::var("WINDOWS_TCP_HOST").unwrap_or_else(|_| "0.0.0.0".to_string()),
    tcp_port: env::var("WINDOWS_TCP_PORT")
      .ok()
      .and_then(|value| value.parse::<u16>().ok())
      .unwrap_or(9000),
    http_host: env::var("WINDOWS_HTTP_HOST").unwrap_or_else(|_| "0.0.0.0".to_string()),
    http_port: env::var("WINDOWS_HTTP_PORT")
      .ok()
      .and_then(|value| value.parse::<u16>().ok())
      .unwrap_or(8787),
    results_dir: env::var("WINDOWS_RESULTS_DIR")
      .map(PathBuf::from)
      .unwrap_or_else(|_| cwd.join("saved-results")),
  };

  Arc::new(RwLock::new(AppState::new(config)))
}

fn main() {
  init_tracing();

  let shared_state = build_shared_state();

  tauri::Builder::default()
    .manage(shared_state.clone())
    .invoke_handler(tauri::generate_handler![
      commands::get_health,
      commands::get_state,
      commands::start_monitoring,
      commands::stop_monitoring,
      commands::start_lobby,
      commands::reset_laps,
      commands::reset_run,
      commands::return_setup,
      commands::fire_trigger,
      commands::assign_role,
      commands::update_device_config,
      commands::resync_device,
      commands::save_results,
      commands::clear_events,
      commands::list_results,
      commands::load_result,
      commands::compare_results
    ])
    .setup(move |app| {
      let app_handle = app.handle().clone();
      let state_for_server = shared_state.clone();

      tauri::async_runtime::spawn(async move {
        info!("Starting TCP server task");
        if let Err(error_message) = tcp_server::start_tcp_server(app_handle.clone(), state_for_server).await {
          error!("TCP server task failed: {}", error_message);
        }
      });

      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("failed to run tauri application");
}
