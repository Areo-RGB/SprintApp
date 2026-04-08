use std::env;
use std::path::PathBuf;

fn main() {
    let manifest_dir = env::var("CARGO_MANIFEST_DIR").expect("Missing CARGO_MANIFEST_DIR");
    let target = env::var("TARGET").expect("Missing TARGET");
    let runtime_path = PathBuf::from(manifest_dir)
        .join("bin")
        .join(format!("node-{target}.exe"));

    println!(
        "cargo:rustc-env=SPRINTSYNC_NODE_RUNTIME_PATH={}",
        runtime_path.display()
    );

    tauri_build::build()
}
