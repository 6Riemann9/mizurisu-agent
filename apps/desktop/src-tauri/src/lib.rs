use serde::Serialize;
use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::RwLock;
use std::time::{Duration, Instant};

const COMMAND_TIMEOUT_SECS: u64 = 60;
const MAX_OUTPUT_BYTES: usize = 256 * 1024;
const TRUNCATION_NOTICE: &str = "\n...(输出超过 256KB 已截断)";

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

fn validate_session_request_url(url: &str) -> Result<&str, String> {
    let trimmed = url.trim();
    let lower = trimmed.to_ascii_lowercase();
    if !lower.starts_with("http://") && !lower.starts_with("https://") {
        return Err("仅支持 HTTP/HTTPS 协议地址".to_string());
    }
    Ok(trimmed)
}

#[tauri::command]
async fn newapi_session_request(
    state: tauri::State<'_, SessionHttpState>,
    url: String,
    method: Option<String>,
    headers: Option<HashMap<String, String>>,
    body: Option<String>,
) -> Result<SessionHttpResponse, String> {
    let validated_url = validate_session_request_url(&url)?;

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

    let mut req = client.request(parsed_method.clone(), validated_url);

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

/// 流式读取子进程管道输出（保留最多 256KB + 4 字节用于对齐 UTF-8 边界，其余字节安全丢弃避免管道写满死锁）。
fn read_limited_stream<R: Read>(mut reader: R) -> (Vec<u8>, bool) {
    let cap = MAX_OUTPUT_BYTES + 4;
    let mut collected = Vec::new();
    let mut exceeded = false;
    let mut chunk = [0u8; 8192];

    loop {
        match reader.read(&mut chunk) {
            Ok(0) => break,
            Ok(n) => {
                if collected.len() < cap {
                    let remaining = cap - collected.len();
                    let take = n.min(remaining);
                    collected.extend_from_slice(&chunk[..take]);
                    if n > remaining {
                        exceeded = true;
                    }
                } else {
                    exceeded = true;
                }
            }
            Err(_) => break,
        }
    }

    (collected, exceeded)
}

/// 在严格遵守 UTF-8 字符边界的前提下于 256KB 处截断输出并附加中文截断提示。
fn truncate_output_utf8(bytes: &[u8], exceeded_cap: bool) -> String {
    let mut text = String::from_utf8_lossy(bytes).into_owned();
    if !exceeded_cap && text.len() <= MAX_OUTPUT_BYTES {
        return text;
    }

    let mut end = text.len().min(MAX_OUTPUT_BYTES);
    while end > 0 && !text.is_char_boundary(end) {
        end -= 1;
    }
    text.truncate(end);
    text.push_str(TRUNCATION_NOTICE);
    text
}

fn execute_command_with_timeout(
    command: &str,
    work_dir: &Path,
    timeout: Duration,
) -> Result<ShellExecutionResult, String> {
    #[cfg(target_os = "windows")]
    let mut cmd = {
        let mut c = Command::new("powershell");
        c.args(["-NoProfile", "-Command", command]);
        c
    };

    #[cfg(not(target_os = "windows"))]
    let mut cmd = {
        let mut c = Command::new("sh");
        c.args(["-c", command]);
        c
    };

    let mut child = cmd
        .current_dir(work_dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("执行命令失败: {e}"))?;

    let stdout_pipe = child.stdout.take();
    let stderr_pipe = child.stderr.take();

    let stdout_handle = std::thread::spawn(move || match stdout_pipe {
        Some(pipe) => read_limited_stream(pipe),
        None => (Vec::new(), false),
    });
    let stderr_handle = std::thread::spawn(move || match stderr_pipe {
        Some(pipe) => read_limited_stream(pipe),
        None => (Vec::new(), false),
    });

    let deadline = Instant::now() + timeout;
    let status = loop {
        match child.try_wait() {
            Ok(Some(exit_status)) => break exit_status,
            Ok(None) => {
                if Instant::now() >= deadline {
                    #[cfg(target_os = "windows")]
                    {
                        // 先尝试用 taskkill /F /T 终止子进程树，避免派生孙进程继续占用管道或后台残留
                        let pid = child.id();
                        let _ = Command::new("taskkill")
                            .args(["/F", "/T", "/PID", &pid.to_string()])
                            .stdout(Stdio::null())
                            .stderr(Stdio::null())
                            .output();
                    }
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(format!(
                        "命令执行超时（超过 {} 秒已强制终止）",
                        timeout.as_secs()
                    ));
                }
                std::thread::sleep(Duration::from_millis(25));
            }
            Err(e) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!("等待命令结果失败: {e}"));
            }
        }
    };

    let (stdout_bytes, stdout_exceeded) = stdout_handle
        .join()
        .unwrap_or_else(|_| (Vec::new(), false));
    let (stderr_bytes, stderr_exceeded) = stderr_handle
        .join()
        .unwrap_or_else(|_| (Vec::new(), false));

    Ok(ShellExecutionResult {
        exit_code: status.code().unwrap_or(-1),
        stdout: truncate_output_utf8(&stdout_bytes, stdout_exceeded),
        stderr: truncate_output_utf8(&stderr_bytes, stderr_exceeded),
    })
}

#[tauri::command]
async fn run_workspace_command(
    command: String,
    cwd: Option<String>,
) -> Result<ShellExecutionResult, String> {
    let work_dir = match cwd {
        Some(dir) if !dir.trim().is_empty() => PathBuf::from(dir),
        _ => std::env::current_dir().map_err(|e| format!("无法获取工作目录: {e}"))?,
    };

    if !work_dir.exists() || !work_dir.is_dir() {
        return Err(format!("工作目录不存在: {}", work_dir.display()));
    }

    tauri::async_runtime::spawn_blocking(move || {
        execute_command_with_timeout(
            &command,
            &work_dir,
            Duration::from_secs(COMMAND_TIMEOUT_SECS),
        )
    })
    .await
    .map_err(|e| format!("命令执行任务异常: {e}"))?
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn session_url_only_allows_http_and_https() {
        assert_eq!(
            validate_session_request_url("  https://www.mizurisu.com/api/user "),
            Ok("https://www.mizurisu.com/api/user")
        );
        assert_eq!(
            validate_session_request_url("HTTP://localhost:3000/v1/models"),
            Ok("HTTP://localhost:3000/v1/models")
        );
        assert!(validate_session_request_url("file:///etc/passwd").is_err());
        assert!(validate_session_request_url("ftp://example.com").is_err());
        assert!(validate_session_request_url("javascript:alert(1)").is_err());
        assert!(validate_session_request_url("   ").is_err());
    }

    #[test]
    fn output_truncates_at_256kb_utf8_boundary() {
        let small = "hello 世界".as_bytes();
        assert_eq!(truncate_output_utf8(small, false), "hello 世界");

        // 构造跨越 256KB 边界的纯中文 3 字节 UTF-8 序列（3 * 87382 = 262146 > 262144）
        let text = "中".repeat(87_382);
        let (collected, exceeded) = read_limited_stream(std::io::Cursor::new(text.as_bytes()));
        let truncated = truncate_output_utf8(&collected, exceeded);
        assert!(truncated.ends_with(TRUNCATION_NOTICE));
        let prefix = truncated.strip_suffix(TRUNCATION_NOTICE).unwrap();
        assert!(prefix.len() <= MAX_OUTPUT_BYTES);
        assert_eq!(prefix.len() % 3, 0);
        assert!(!truncated.contains('\u{FFFD}'));
    }

    #[test]
    fn command_timeout_kills_slow_process() {
        let cwd = std::env::current_dir().unwrap();
        #[cfg(target_os = "windows")]
        let slow_cmd = "Start-Sleep -Seconds 5";
        #[cfg(not(target_os = "windows"))]
        let slow_cmd = "sleep 5";

        let err = execute_command_with_timeout(slow_cmd, &cwd, Duration::from_millis(200))
            .err()
            .expect("超时命令应返回错误");
        assert!(err.contains("超时"));
    }
}
