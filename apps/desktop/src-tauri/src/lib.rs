use serde::Serialize;
use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Command;
use std::sync::RwLock;
use std::time::Duration;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellExecutionResult {
    exit_code: i32,
    stdout: String,
    stderr: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionHttpResponse {
    status: u16,
    ok: bool,
    text: String,
}

struct SessionHttpState {
    client: RwLock<reqwest::Client>,
}

fn build_session_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .cookie_store(true)
        .use_rustls_tls()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| format!("初始化会话 HTTP 客户端失败: {e}"))
}

impl SessionHttpState {
    fn new() -> Result<Self, String> {
        Ok(Self {
            client: RwLock::new(build_session_client()?),
        })
    }
}

#[tauri::command]
async fn newapi_session_request(
    state: tauri::State<'_, SessionHttpState>,
    url: String,
    method: Option<String>,
    headers: Option<HashMap<String, String>>,
    body: Option<String>,
) -> Result<SessionHttpResponse, String> {
    let client = {
        let guard = state
            .client
            .read()
            .map_err(|_| "读取会话 HTTP 客户端失败".to_string())?;
        guard.clone()
    };

    let method_str = method
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("GET")
        .to_uppercase();
    let parsed_method = reqwest::Method::from_bytes(method_str.as_bytes())
        .map_err(|e| format!("无效 HTTP 方法 {method_str}: {e}"))?;

    let mut req = client.request(parsed_method.clone(), &url);

    if let Some(hdrs) = headers {
        let mut header_map = reqwest::header::HeaderMap::new();
        for (k, v) in hdrs {
            let name = reqwest::header::HeaderName::from_bytes(k.trim().as_bytes())
                .map_err(|e| format!("无效请求头名称 {k}: {e}"))?;
            let val = reqwest::header::HeaderValue::from_str(&v)
                .map_err(|e| format!("无效请求头值 {k}: {e}"))?;
            header_map.insert(name, val);
        }
        req = req.headers(header_map);
    }

    if let Some(raw_body) = body {
        if !raw_body.is_empty() || parsed_method != reqwest::Method::GET {
            req = req.body(raw_body);
        }
    }

    let res = req
        .send()
        .await
        .map_err(|e| format!("会话请求失败: {e}"))?;
    let status = res.status().as_u16();
    let ok = res.status().is_success();
    let text = res
        .text()
        .await
        .map_err(|e| format!("读取会话响应失败: {e}"))?;

    Ok(SessionHttpResponse { status, ok, text })
}

#[tauri::command]
fn newapi_clear_cookies(state: tauri::State<'_, SessionHttpState>) -> Result<(), String> {
    let fresh = build_session_client()?;
    let mut guard = state
        .client
        .write()
        .map_err(|_| "重置会话 Cookie 锁失败".to_string())?;
    *guard = fresh;
    Ok(())
}

#[tauri::command]
fn run_workspace_command(command: String, cwd: Option<String>) -> Result<ShellExecutionResult, String> {
    let work_dir = match cwd {
        Some(dir) if !dir.trim().is_empty() => PathBuf::from(dir),
        _ => std::env::current_dir().map_err(|e| format!("无法获取工作目录: {e}"))?,
    };

    if !work_dir.exists() || !work_dir.is_dir() {
        return Err(format!("工作目录不存在: {}", work_dir.display()));
    }

    #[cfg(target_os = "windows")]
    let output = Command::new("powershell")
        .args(["-NoProfile", "-Command", &command])
        .current_dir(&work_dir)
        .output();

    #[cfg(not(target_os = "windows"))]
    let output = Command::new("sh")
        .args(["-c", &command])
        .current_dir(&work_dir)
        .output();

    let out = output.map_err(|e| format!("执行命令失败: {e}"))?;
    Ok(ShellExecutionResult {
        exit_code: out.status.code().unwrap_or(-1),
        stdout: String::from_utf8_lossy(&out.stdout).to_string(),
        stderr: String::from_utf8_lossy(&out.stderr).to_string(),
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let session_http_state =
        SessionHttpState::new().expect("failed to initialize reqwest session state");

    tauri::Builder::default()
        .manage(session_http_state)
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            run_workspace_command,
            newapi_session_request,
            newapi_clear_cookies
        ])
        .run(tauri::generate_context!())
        .expect("error while running Mizurisu Agent desktop application");
}
