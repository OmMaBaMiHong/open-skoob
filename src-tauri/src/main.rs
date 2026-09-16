#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    fs,
    io::{BufRead, BufReader, Write},
    net::TcpListener,
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Mutex,
    },
    time::Duration,
};
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_opener::OpenerExt;

#[derive(Default)]
struct Backend(Mutex<Option<Child>>, AtomicBool);
impl Backend {
    fn stop(&self) {
        self.1.store(true, Ordering::SeqCst);
        if let Some(mut child) = self.0.lock().unwrap().take() {
            if let Some(mut input) = child.stdin.take() {
                let _ = input.write_all(b"stop\n");
            }
            for _ in 0..30 {
                if matches!(child.try_wait(), Ok(Some(_))) {
                    return;
                }
                std::thread::sleep(Duration::from_millis(100));
            }
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}
impl Drop for Backend {
    fn drop(&mut self) {
        self.stop();
    }
}

fn start(app: &tauri::AppHandle) -> Result<u16, Box<dyn std::error::Error>> {
    let data = app.path().app_data_dir()?;
    fs::create_dir_all(&data)?;
    let resources = app.path().resource_dir()?.join("resources");
    let binary = std::env::current_exe()?
        .parent()
        .ok_or("Missing application directory")?
        .join(if cfg!(windows) { "node.exe" } else { "node" });
    let preferred = fs::read_to_string(data.join("local-port"))
        .ok()
        .and_then(|s| s.trim().parse::<u16>().ok())
        .unwrap_or(0);
    let listener = TcpListener::bind(("127.0.0.1", preferred))
        .or_else(|_| TcpListener::bind(("127.0.0.1", 0)))?;
    let port = listener.local_addr()?.port();
    drop(listener);
    let mut command = Command::new(binary);
    command
        .arg(resources.join("server.mjs"))
        .current_dir(&resources)
        .env_clear();
    for key in [
        "HOME",
        "USERPROFILE",
        "SystemRoot",
        "WINDIR",
        "TEMP",
        "TMP",
        "PATH",
    ] {
        if let Some(value) = std::env::var_os(key) {
            command.env(key, value);
        }
    }
    command
        .env("SKOOB_DATA_DIR", data.join("workspace"))
        .env("SKOOB_STATIC_DIR", resources.join("dist"))
        .env("PORT", port.to_string());
    command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(fs::File::create(data.join("backend.log"))?);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let mut child = command.spawn()?;
    let stdout = child.stdout.take().ok_or("Backend stdout missing")?;
    {
        let backend = app.state::<Backend>();
        let mut slot = backend.0.lock().unwrap();
        if backend.1.load(Ordering::SeqCst) {
            let _ = child.kill();
            let _ = child.wait();
            return Err("Application is closing".into());
        }
        *slot = Some(child);
    }
    let (sender, receiver) = mpsc::channel();
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if let Ok(value) = serde_json::from_str::<serde_json::Value>(&line) {
                if value["event"] == "ready" {
                    let _ = sender.send(value["port"].as_u64().unwrap_or(0));
                }
            }
        }
    });
    if receiver.recv_timeout(Duration::from_secs(20))? != u64::from(port) {
        return Err("Unexpected backend port".into());
    }
    fs::write(data.join("local-port"), port.to_string())?;
    Ok(port)
}

fn main() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") { let _ = window.show(); let _ = window.set_focus(); }
        }))
        .manage(Backend::default())
        .setup(|app| {
            let handle = app.handle().clone();
            let window = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("Open-Skoob").inner_size(1440.0, 900.0).min_inner_size(1000.0, 680.0)
                .on_new_window(move |url, _| {
                    if matches!(url.scheme(), "https" | "http") { let _ = handle.opener().open_url(url.as_str(), None::<&str>); }
                    tauri::webview::NewWindowResponse::Deny
                }).build()?;
            let handle = app.handle().clone();
            std::thread::spawn(move || match start(&handle) {
                Ok(port) => { let _ = window.navigate(format!("http://127.0.0.1:{port}/create").parse().unwrap()); }
                Err(_) => {
                    handle.state::<Backend>().stop();
                    let _ = window.eval("document.getElementById('status').textContent='本地服务未能启动。请关闭客户端后重试；如仍失败，请查看应用数据目录中的 backend.log。'");
                }
            });
            Ok(())
        })
        .build(tauri::generate_context!()).expect("Unable to initialize Open-Skoob");
    app.run(|handle, event| {
        if matches!(event, tauri::RunEvent::Exit) {
            handle.state::<Backend>().stop();
        }
        if let tauri::RunEvent::WindowEvent {
            event: tauri::WindowEvent::Destroyed,
            ..
        } = event
        {
            handle.exit(0);
        }
    });
}
