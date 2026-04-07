use include_dir::{include_dir, Dir, File};
use sha2::{Digest, Sha256};
use std::env;
use std::fs;
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};

const APP_TITLE: &str = "Sprint Sync Windows";
const DEFAULT_HTTP_PORT: u16 = 8787;
const DEFAULT_TCP_PORT: u16 = 9000;
const DEFAULT_HTTP_HOST: &str = "127.0.0.1";
const DEFAULT_TCP_HOST: &str = "0.0.0.0";
const STARTUP_TIMEOUT_SECONDS: u64 = 20;

static BACKEND_DIST: Dir<'_> = include_dir!("$CARGO_MANIFEST_DIR/../../backend/dist");

#[cfg(target_os = "windows")]
static NODE_RUNTIME: &[u8] = include_bytes!(env!("SPRINTSYNC_NODE_RUNTIME_PATH"));

#[cfg(not(target_os = "windows"))]
static NODE_RUNTIME: &[u8] = b"";

#[derive(Debug)]
struct RuntimeConfig {
    http_host: String,
    tcp_host: String,
    http_port: u16,
    tcp_port: u16,
}

#[derive(Debug)]
enum StartupError {
    MissingLocalDataDir,
    PayloadExtractFailed(String),
    TcpPortInUse(u16),
    BackendExited(i32),
    BackendUnhealthyTimeout(u64),
    BackendSpawnFailed(String),
    WindowCreateFailed(String),
    InvalidBackendPath,
}

impl StartupError {
    fn as_dialog_message(&self) -> String {
        match self {
            StartupError::MissingLocalDataDir => {
                "Unable to start Sprint Sync. Local app data path is unavailable.".to_string()
            }
            StartupError::PayloadExtractFailed(err) => format!(
                "Unable to start Sprint Sync. Embedded runtime extraction failed.\n\n{err}"
            ),
            StartupError::TcpPortInUse(port) => format!(
                "Sprint Sync backend could not start for device connections.\n\nTCP port {port} is already in use.\nClose the conflicting process or set WINDOWS_TCP_PORT to a free port."
            ),
            StartupError::BackendExited(code) => {
                format!("Sprint Sync backend exited unexpectedly with code {code}.")
            }
            StartupError::BackendUnhealthyTimeout(seconds) => {
                format!("Sprint Sync backend did not become healthy within {seconds} seconds.")
            }
            StartupError::BackendSpawnFailed(err) => {
                format!("Sprint Sync backend failed to start.\n\n{err}")
            }
            StartupError::WindowCreateFailed(err) => {
                format!("Sprint Sync window failed to open.\n\n{err}")
            }
            StartupError::InvalidBackendPath => {
                "Sprint Sync backend entry point is missing from extracted payload.".to_string()
            }
        }
    }
}

#[derive(Default)]
struct BackendProcessState {
    child: Mutex<Option<Child>>,
}

#[derive(Debug)]
struct ExtractedPayload {
    runtime_root: PathBuf,
    node_runtime_path: PathBuf,
    backend_entry_path: PathBuf,
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(BackendProcessState::default())
        .setup(|app| {
            if let Err(error) = launch_application(app.handle()) {
                app.handle()
                    .dialog()
                    .message(error.as_dialog_message())
                    .kind(MessageDialogKind::Error)
                    .title(APP_TITLE)
                    .blocking_show();
                app.handle().exit(1);
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|app, event| {
            if matches!(event, RunEvent::Exit | RunEvent::ExitRequested { .. }) {
                stop_backend_process(app);
            }
        });
}

fn launch_application(app: &AppHandle) -> Result<(), StartupError> {
    ensure_webview2_runtime()?;
    let payload = ensure_runtime_payload(app)?;
    let config = resolve_runtime_config()?;

    let backend_url = format!("http://127.0.0.1:{}", config.http_port);

    let mut child = start_backend_process(&payload, &config)?;
    wait_for_backend_ready(&mut child, config.http_port)?;

    {
        let state = app.state::<BackendProcessState>();
        let mut locked = state
            .child
            .lock()
            .map_err(|_| StartupError::BackendSpawnFailed("Backend state mutex poisoned".to_string()))?;
        *locked = Some(child);
    }

    create_main_window(app, &backend_url)?;
    Ok(())
}

fn ensure_webview2_runtime() -> Result<(), StartupError> {
    if tauri::webview_version().is_err() {
        return Err(StartupError::WindowCreateFailed(
            "Microsoft WebView2 Runtime is required. Install it and relaunch Sprint Sync."
                .to_string(),
        ));
    }

    Ok(())
}

fn create_main_window(app: &AppHandle, backend_url: &str) -> Result<(), StartupError> {
    let url = tauri::Url::parse(backend_url)
        .map_err(|err| StartupError::WindowCreateFailed(err.to_string()))?;

    WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url))
        .title(APP_TITLE)
        .fullscreen(true)
        .decorations(false)
        .build()
        .map_err(|err| StartupError::WindowCreateFailed(err.to_string()))?;

    Ok(())
}

fn resolve_runtime_config() -> Result<RuntimeConfig, StartupError> {
    let tcp_port = resolve_port_from_env_or_default("WINDOWS_TCP_PORT", DEFAULT_TCP_PORT);
    if !is_port_available(DEFAULT_TCP_HOST, tcp_port) {
        return Err(StartupError::TcpPortInUse(tcp_port));
    }

    let requested_http_port = resolve_port_from_env_or_default("WINDOWS_HTTP_PORT", DEFAULT_HTTP_PORT);
    let http_port = resolve_http_port(requested_http_port, tcp_port);

    Ok(RuntimeConfig {
        http_host: env::var("WINDOWS_HTTP_HOST").unwrap_or_else(|_| DEFAULT_HTTP_HOST.to_string()),
        tcp_host: env::var("WINDOWS_TCP_HOST").unwrap_or_else(|_| DEFAULT_TCP_HOST.to_string()),
        http_port,
        tcp_port,
    })
}

fn resolve_port_from_env_or_default(env_name: &str, default_port: u16) -> u16 {
    env::var(env_name)
        .ok()
        .and_then(|value| value.parse::<u16>().ok())
        .filter(|port| *port > 0)
        .unwrap_or(default_port)
}

fn resolve_http_port(requested_http_port: u16, tcp_port: u16) -> u16 {
    if requested_http_port == tcp_port || !is_port_available(DEFAULT_HTTP_HOST, requested_http_port) {
        return find_available_port(DEFAULT_HTTP_HOST, &[tcp_port]);
    }

    requested_http_port
}

fn parse_socket_addr(host: &str, port: u16) -> Option<SocketAddr> {
    format!("{host}:{port}").parse::<SocketAddr>().ok()
}

fn is_port_available(host: &str, port: u16) -> bool {
    let Some(addr) = parse_socket_addr(host, port) else {
        return false;
    };

    TcpListener::bind(addr).is_ok()
}

fn find_available_port(host: &str, excluded_ports: &[u16]) -> u16 {
    loop {
        let Some(addr) = parse_socket_addr(host, 0) else {
            return DEFAULT_HTTP_PORT;
        };

        if let Ok(listener) = TcpListener::bind(addr) {
            if let Ok(local) = listener.local_addr() {
                let selected = local.port();
                if !excluded_ports.contains(&selected) {
                    return selected;
                }
            }
        }
    }
}

fn ensure_runtime_payload(app: &AppHandle) -> Result<ExtractedPayload, StartupError> {
    let local_data_dir = dirs::data_local_dir().ok_or(StartupError::MissingLocalDataDir)?;
    let app_version = app.package_info().version.to_string();
    let payload_hash = compute_payload_hash();

    let runtime_root = local_data_dir
        .join("SprintSync")
        .join("runtime")
        .join(format!("{app_version}-{payload_hash}"));

    let complete_marker = runtime_root.join(".complete");
    if !complete_marker.exists() {
        if runtime_root.exists() {
            fs::remove_dir_all(&runtime_root)
                .map_err(|err| StartupError::PayloadExtractFailed(err.to_string()))?;
        }

        fs::create_dir_all(&runtime_root)
            .map_err(|err| StartupError::PayloadExtractFailed(err.to_string()))?;

        let node_path = runtime_root.join("runtime").join("node.exe");
        if let Some(parent) = node_path.parent() {
            fs::create_dir_all(parent)
                .map_err(|err| StartupError::PayloadExtractFailed(err.to_string()))?;
        }
        fs::write(&node_path, NODE_RUNTIME)
            .map_err(|err| StartupError::PayloadExtractFailed(err.to_string()))?;

        let backend_root = runtime_root.join("backend").join("dist");
        extract_dir_recursive(&BACKEND_DIST, &backend_root)?;

        fs::write(&complete_marker, b"ok")
            .map_err(|err| StartupError::PayloadExtractFailed(err.to_string()))?;
    }

    let backend_entry_path = runtime_root.join("backend").join("dist").join("server.cjs");
    if !backend_entry_path.exists() {
        return Err(StartupError::InvalidBackendPath);
    }

    Ok(ExtractedPayload {
        node_runtime_path: runtime_root.join("runtime").join("node.exe"),
        backend_entry_path,
        runtime_root,
    })
}

fn extract_dir_recursive(source: &Dir<'_>, output_root: &Path) -> Result<(), StartupError> {
    fs::create_dir_all(output_root).map_err(|err| StartupError::PayloadExtractFailed(err.to_string()))?;

    for file in source.files() {
        write_embedded_file(source, file, output_root)?;
    }

    for subdir in source.dirs() {
        let relative_subdir = subdir.path().strip_prefix(source.path()).unwrap_or(subdir.path());
        let subdir_output = output_root.join(relative_subdir);
        extract_dir_recursive(subdir, &subdir_output)?;
    }

    Ok(())
}

fn write_embedded_file(source: &Dir<'_>, file: &File<'_>, output_root: &Path) -> Result<(), StartupError> {
    let relative_path = file.path().strip_prefix(source.path()).unwrap_or(file.path());
    let output_file = output_root.join(relative_path);
    if let Some(parent) = output_file.parent() {
        fs::create_dir_all(parent).map_err(|err| StartupError::PayloadExtractFailed(err.to_string()))?;
    }

    fs::write(output_file, file.contents())
        .map_err(|err| StartupError::PayloadExtractFailed(err.to_string()))?;
    Ok(())
}

fn compute_payload_hash() -> String {
    let mut hasher = Sha256::new();
    hasher.update(NODE_RUNTIME);
    hash_dir_recursive(&BACKEND_DIST, &mut hasher);
    format!("{:x}", hasher.finalize())
}

fn hash_dir_recursive(source: &Dir<'_>, hasher: &mut Sha256) {
    for file in source.files() {
        hasher.update(file.path().to_string_lossy().as_bytes());
        hasher.update(file.contents());
    }

    for subdir in source.dirs() {
        hash_dir_recursive(subdir, hasher);
    }
}

fn start_backend_process(payload: &ExtractedPayload, config: &RuntimeConfig) -> Result<Child, StartupError> {
    let mut command = Command::new(&payload.node_runtime_path);
    command
        .arg(&payload.backend_entry_path)
        .current_dir(&payload.runtime_root)
        .env("WINDOWS_HTTP_HOST", &config.http_host)
        .env("WINDOWS_TCP_HOST", &config.tcp_host)
        .env("WINDOWS_HTTP_PORT", config.http_port.to_string())
        .env("WINDOWS_TCP_PORT", config.tcp_port.to_string())
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    command
        .spawn()
        .map_err(|err| StartupError::BackendSpawnFailed(err.to_string()))
}

fn wait_for_backend_ready(backend_child: &mut Child, http_port: u16) -> Result<(), StartupError> {
    let deadline = Instant::now() + Duration::from_secs(STARTUP_TIMEOUT_SECONDS);

    while Instant::now() < deadline {
        if let Some(status) = backend_child
            .try_wait()
            .map_err(|err| StartupError::BackendSpawnFailed(err.to_string()))?
        {
            let code = status.code().unwrap_or(-1);
            return Err(StartupError::BackendExited(code));
        }

        if check_health(http_port) {
            return Ok(());
        }

        std::thread::sleep(Duration::from_millis(200));
    }

    Err(StartupError::BackendUnhealthyTimeout(STARTUP_TIMEOUT_SECONDS))
}

fn check_health(http_port: u16) -> bool {
    let address = format!("127.0.0.1:{http_port}");
    let Ok(mut stream) = TcpStream::connect(address) else {
        return false;
    };

    stream.set_read_timeout(Some(Duration::from_secs(1))).ok();
    stream.set_write_timeout(Some(Duration::from_secs(1))).ok();

    let request = b"GET /api/health HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n";
    if stream.write_all(request).is_err() {
        return false;
    }

    let mut response = [0_u8; 128];
    let Ok(read_len) = stream.read(&mut response) else {
        return false;
    };

    let head = String::from_utf8_lossy(&response[..read_len]);
    head.starts_with("HTTP/1.1 200") || head.starts_with("HTTP/1.0 200")
}

fn stop_backend_process(app: &AppHandle) {
    let state = app.state::<BackendProcessState>();
    let mut guard = match state.child.lock() {
        Ok(locked) => locked,
        Err(_) => return,
    };

    let Some(child) = guard.as_mut() else {
        return;
    };

    if child.try_wait().ok().flatten().is_some() {
        *guard = None;
        return;
    }

    terminate_then_force_kill(child);
    *guard = None;
}

fn terminate_then_force_kill(child: &mut Child) {
    #[cfg(target_os = "windows")]
    {
        let pid = child.id().to_string();
        let _ = Command::new("taskkill")
            .args(["/PID", &pid, "/T"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();

        let deadline = Instant::now() + Duration::from_secs(5);
        while Instant::now() < deadline {
            if child.try_wait().ok().flatten().is_some() {
                return;
            }
            std::thread::sleep(Duration::from_millis(100));
        }

        let _ = Command::new("taskkill")
            .args(["/F", "/PID", &pid, "/T"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
        let _ = child.wait();
    }

    #[cfg(not(target_os = "windows"))]
    {
        if child.kill().is_ok() {
            let _ = child.wait();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{resolve_port_from_env_or_default, StartupError};
    use std::env;

    #[test]
    fn resolves_port_from_env_when_valid() {
        env::set_var("WINDOWS_HTTP_PORT", "4567");
        assert_eq!(resolve_port_from_env_or_default("WINDOWS_HTTP_PORT", 8787), 4567);
        env::remove_var("WINDOWS_HTTP_PORT");
    }

    #[test]
    fn falls_back_to_default_port_when_env_invalid() {
        env::set_var("WINDOWS_HTTP_PORT", "invalid");
        assert_eq!(resolve_port_from_env_or_default("WINDOWS_HTTP_PORT", 8787), 8787);
        env::set_var("WINDOWS_HTTP_PORT", "0");
        assert_eq!(resolve_port_from_env_or_default("WINDOWS_HTTP_PORT", 8787), 8787);
        env::remove_var("WINDOWS_HTTP_PORT");
    }

    #[test]
    fn dialog_message_for_tcp_conflict_is_actionable() {
        let message = StartupError::TcpPortInUse(9000).as_dialog_message();
        assert!(message.contains("TCP port 9000 is already in use"));
        assert!(message.contains("WINDOWS_TCP_PORT"));
    }

    #[test]
    fn backend_timeout_message_is_explicit() {
        let message = StartupError::BackendUnhealthyTimeout(20).as_dialog_message();
        assert!(message.contains("20 seconds"));
    }

    #[test]
    fn http_port_changes_when_equal_to_tcp_port() {
        let resolved = super::resolve_http_port(9000, 9000);
        assert_ne!(resolved, 9000);
    }
}
