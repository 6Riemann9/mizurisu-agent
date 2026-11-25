use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{mpsc, Mutex, RwLock};
use std::time::{Duration, Instant, UNIX_EPOCH};
use tauri::Emitter;

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

const MAX_WEB_FETCH_BYTES: usize = 1536 * 1024;

/// 无 Cookie 原生抓取公开网页（仅限 HTTP/HTTPS，限流重定向 5 次，体积上限 1.5MB）
#[tauri::command]
async fn fetch_web_url(
    url: String,
    timeout_secs: Option<u64>,
) -> Result<SessionHttpResponse, String> {
    let validated_url = validate_session_request_url(&url)?.to_string();
    let secs = timeout_secs.unwrap_or(15).clamp(1, 30);

    let client = reqwest::Client::builder()
        .use_rustls_tls()
        .redirect(reqwest::redirect::Policy::limited(5))
        .timeout(Duration::from_secs(secs))
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
        .build()
        .map_err(|e| format!("初始化网页抓取客户端失败: {e}"))?;

    let mut res = client
        .get(&validated_url)
        .header(
            "Accept",
            "text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.5",
        )
        .header("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.8")
        .send()
        .await
        .map_err(|e| format!("抓取网页失败: {e}"))?;

    let status = res.status().as_u16();
    let ok = res.status().is_success();

    let mut buf: Vec<u8> = Vec::new();
    while let Some(chunk) = res
        .chunk()
        .await
        .map_err(|e| format!("读取网页内容流失败: {e}"))?
    {
        if buf.len() >= MAX_WEB_FETCH_BYTES {
            break;
        }
        let remain = MAX_WEB_FETCH_BYTES - buf.len();
        let take = chunk.len().min(remain);
        buf.extend_from_slice(&chunk[..take]);
        if chunk.len() > remain {
            break;
        }
    }

    let text = String::from_utf8_lossy(&buf).into_owned();
    Ok(SessionHttpResponse { status, ok, text })
}

struct TempFileGuard(PathBuf);
impl Drop for TempFileGuard {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}

fn decode_base64_clean(input: &str) -> Result<Vec<u8>, String> {
    let payload = input
        .split_once(',')
        .map(|(_, after)| after)
        .unwrap_or(input);
    let mut val = 0u32;
    let mut valb = -8i32;
    let mut out = Vec::with_capacity((payload.len() * 3) / 4);
    for &b in payload.as_bytes() {
        if b.is_ascii_whitespace() {
            continue;
        }
        if b == b'=' {
            break;
        }
        let d = match b {
            b'A'..=b'Z' => b - b'A',
            b'a'..=b'z' => b - b'a' + 26,
            b'0'..=b'9' => b - b'0' + 52,
            b'+' => 62,
            b'/' => 63,
            _ => return Err("无效的 Base64 图片编码字符".to_string()),
        };
        val = (val << 6) + d as u32;
        valb += 6;
        if valb >= 0 {
            out.push(((val >> valb) & 0xFF) as u8);
            valb -= 8;
        }
    }
    if out.is_empty() {
        return Err("图片 Base64 数据为空".to_string());
    }
    Ok(out)
}

fn run_native_ocr_on_file(path: &Path, lang: Option<&str>) -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        let escaped_path = path.to_string_lossy().replace('\'', "''");
        let lang_hint = lang.unwrap_or("zh-Hans-CN").replace('\'', "''");
        let ps_script = format!(
            "$ErrorActionPreference = 'Stop'; \
             Add-Type -AssemblyName System.Runtime.WindowsRuntime; \
             $asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {{ $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' }})[0]; \
             function Await($t, $rt) {{ $m = $asTask.MakeGenericMethod($rt); $nt = $m.Invoke($null, @($t)); $nt.Wait(-1) | Out-Null; $nt.Result }}; \
             $null = [Windows.Storage.StorageFile,Windows.Storage,ContentType=WindowsRuntime]; \
             $null = [Windows.Graphics.Imaging.BitmapDecoder,Windows.Graphics,ContentType=WindowsRuntime]; \
             $null = [Windows.Media.Ocr.OcrEngine,Windows.Foundation,ContentType=WindowsRuntime]; \
             $null = [Windows.Globalization.Language,Windows.Foundation,ContentType=WindowsRuntime]; \
             $file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync('{escaped_path}')) ([Windows.Storage.StorageFile]); \
             $stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream]); \
             $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder]); \
             $bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap]); \
             $engine = $null; \
             try {{ $l = [Windows.Globalization.Language]::new('{lang_hint}'); if ([Windows.Media.Ocr.OcrEngine]::IsLanguageSupported($l)) {{ $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($l) }} }} catch {{}}; \
             if (-not $engine) {{ $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages() }}; \
             if (-not $engine) {{ throw 'NATIVE_OCR_UNAVAILABLE: 系统未安装可用 OCR 语言包' }}; \
             $res = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult]); \
             [Console]::OutputEncoding = [System.Text.Encoding]::UTF8; \
             Write-Output $res.Text"
        );
        let output = Command::new("powershell")
            .args(["-NoProfile", "-Command", &ps_script])
            .output()
            .map_err(|e| format!("启动 Windows OCR 失败: {e}"))?;
        if !output.status.success() {
            let err = String::from_utf8_lossy(&output.stderr);
            return Err(format!("Windows OCR 执行失败: {}", err.trim()));
        }
        return Ok(String::from_utf8_lossy(&output.stdout).trim().to_string());
    }

    #[cfg(target_os = "macos")]
    {
        let swift_code = r#"
import Foundation
import Vision
import AppKit

guard CommandLine.arguments.count > 1 else { exit(1) }
let path = CommandLine.arguments[1]
guard let img = NSImage(contentsOfFile: path),
      let cgImg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
    fputs("Failed to load image", stderr)
    exit(2)
}
let req = VNRecognizeTextRequest()
req.recognitionLevel = .accurate
req.usesLanguageCorrection = true
req.recognitionLanguages = ["zh-Hans", "en-US"]
let handler = VNImageRequestHandler(cgImage: cgImg, options: [:])
try handler.perform([req])
let lines = (req.results ?? []).compactMap { $0.topCandidates(1).first?.string }
print(lines.joined(separator: "\n"))
"#;
        let output = Command::new("/usr/bin/swift")
            .args(["-e", swift_code, &path.to_string_lossy()])
            .output()
            .map_err(|e| format!("启动 macOS Vision OCR 失败: {e}"))?;
        if !output.status.success() {
            let err = String::from_utf8_lossy(&output.stderr);
            return Err(format!("macOS Vision OCR 执行失败: {}", err.trim()));
        }
        let _ = lang;
        return Ok(String::from_utf8_lossy(&output.stdout).trim().to_string());
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        let _ = (path, lang);
        Err("NATIVE_OCR_UNAVAILABLE".to_string())
    }
}

/// 调用操作系统原生离线 OCR（Windows WinRT / macOS Vision）提取图像文字，零安装包体积增量
#[tauri::command]
async fn native_ocr_image(
    image_base64: String,
    lang: Option<String>,
) -> Result<String, String> {
    let bytes = decode_base64_clean(&image_base64)?;
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let temp_path = std::env::temp_dir().join(format!(
        "mizurisu_ocr_{}_{}.png",
        std::process::id(),
        ts
    ));
    std::fs::write(&temp_path, &bytes).map_err(|e| format!("写入临时 OCR 图片失败: {e}"))?;
    let _guard = TempFileGuard(temp_path.clone());

    tauri::async_runtime::spawn_blocking(move || {
        let _keep_guard = _guard;
        run_native_ocr_on_file(&temp_path, lang.as_deref())
    })
    .await
    .map_err(|e| format!("OCR 任务执行异常: {e}"))?
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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeWorkspaceFileMeta {
    path: String,
    name: String,
    size: u64,
    updated_at: u64,
}

struct WorkspaceWatcherState {
    watcher: Mutex<Option<RecommendedWatcher>>,
}

impl WorkspaceWatcherState {
    fn new() -> Self {
        Self {
            watcher: Mutex::new(None),
        }
    }
}

fn is_windows_reserved_name(seg: &str) -> bool {
    let stem = seg.split('.').next().unwrap_or(seg);
    let upper = stem.to_ascii_uppercase();
    matches!(
        upper.as_str(),
        "CON"
            | "PRN"
            | "AUX"
            | "NUL"
            | "COM1"
            | "COM2"
            | "COM3"
            | "COM4"
            | "COM5"
            | "COM6"
            | "COM7"
            | "COM8"
            | "COM9"
            | "LPT1"
            | "LPT2"
            | "LPT3"
            | "LPT4"
            | "LPT5"
            | "LPT6"
            | "LPT7"
            | "LPT8"
            | "LPT9"
    )
}

fn resolve_safe_workspace_path(root: &str, relative_path: &str) -> Result<PathBuf, String> {
    let root_trim = root.trim();
    if root_trim.is_empty() {
        return Err("无效的本地工作区根目录".to_string());
    }
    let normalized = relative_path.replace('\\', "/");
    if normalized.is_empty() {
        return Err("工作区相对路径不能为空".to_string());
    }
    if normalized.starts_with('/') {
        return Err(format!("禁止使用绝对路径: {relative_path}"));
    }
    let bytes = normalized.as_bytes();
    if bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' {
        return Err(format!("禁止使用盘符路径: {relative_path}"));
    }
    if normalized.contains('\0') {
        return Err("路径包含非法空字符".to_string());
    }

    let mut target = PathBuf::from(root_trim);
    for seg in normalized.split('/') {
        if seg.is_empty()
            || seg == "."
            || seg == ".."
            || seg.ends_with(' ')
            || seg.ends_with('.')
            || is_windows_reserved_name(seg)
        {
            return Err(format!("检测到非法路径段: {relative_path}"));
        }
        target.push(seg);
    }
    Ok(target)
}

fn should_skip_dir_name(name: &str) -> bool {
    name.starts_with('.') || matches!(name, "node_modules" | "dist" | "target" | ".next" | ".git")
}

fn walk_workspace_dir(
    root: &Path,
    dir: &Path,
    out: &mut Vec<NativeWorkspaceFileMeta>,
    max_files: usize,
) -> Result<(), String> {
    if out.len() >= max_files {
        return Ok(());
    }
    let entries = std::fs::read_dir(dir).map_err(|e| format!("读取目录失败: {e}"))?;
    for entry in entries.flatten() {
        if out.len() >= max_files {
            break;
        }
        let file_name = entry.file_name();
        let name_str = file_name.to_string_lossy();
        if name_str.starts_with('.') {
            continue;
        }
        let Ok(meta) = entry.metadata() else {
            continue;
        };
        let path = entry.path();
        if meta.is_dir() {
            if should_skip_dir_name(&name_str) {
                continue;
            }
            let _ = walk_workspace_dir(root, &path, out, max_files);
        } else if meta.is_file() {
            let Ok(rel) = path.strip_prefix(root) else {
                continue;
            };
            let rel_str = rel.to_string_lossy().replace('\\', "/");
            let updated_at = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0);
            out.push(NativeWorkspaceFileMeta {
                path: rel_str,
                name: name_str.into_owned(),
                size: meta.len(),
                updated_at,
            });
        }
    }
    Ok(())
}

#[tauri::command]
fn native_list_workspace_files(root: String) -> Result<Vec<NativeWorkspaceFileMeta>, String> {
    let root_path = PathBuf::from(root.trim());
    if !root_path.exists() || !root_path.is_dir() {
        return Err(format!("本地目录不存在: {}", root_path.display()));
    }
    let mut files = Vec::new();
    walk_workspace_dir(&root_path, &root_path, &mut files, 5000)?;
    files.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(files)
}

#[tauri::command]
fn native_read_workspace_file(root: String, relative_path: String) -> Result<Vec<u8>, String> {
    let target = resolve_safe_workspace_path(&root, &relative_path)?;
    std::fs::read(&target).map_err(|e| format!("读取本地文件失败 ({relative_path}): {e}"))
}

#[tauri::command]
fn native_write_workspace_file(
    root: String,
    relative_path: String,
    data: Vec<u8>,
) -> Result<(), String> {
    let target = resolve_safe_workspace_path(&root, &relative_path)?;
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建父目录失败: {e}"))?;
    }
    std::fs::write(&target, &data).map_err(|e| format!("写入本地文件失败 ({relative_path}): {e}"))
}

#[tauri::command]
fn native_delete_workspace_file(root: String, relative_path: String) -> Result<(), String> {
    let target = resolve_safe_workspace_path(&root, &relative_path)?;
    if !target.exists() {
        return Err(format!("本地文件不存在: {relative_path}"));
    }
    std::fs::remove_file(&target).map_err(|e| format!("删除本地文件失败 ({relative_path}): {e}"))
}

#[tauri::command]
fn native_rename_workspace_file(
    root: String,
    old_rel: String,
    new_rel: String,
) -> Result<(), String> {
    let src = resolve_safe_workspace_path(&root, &old_rel)?;
    let dst = resolve_safe_workspace_path(&root, &new_rel)?;
    if !src.exists() {
        return Err(format!("源文件不存在: {old_rel}"));
    }
    if dst.exists() {
        return Err(format!("目标文件已存在: {new_rel}"));
    }
    if let Some(parent) = dst.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建目标父目录失败: {e}"))?;
    }
    std::fs::rename(&src, &dst).map_err(|e| format!("重命名本地文件失败: {e}"))
}

#[tauri::command]
fn native_watch_workspace_dir(
    app: tauri::AppHandle,
    state: tauri::State<'_, WorkspaceWatcherState>,
    root: String,
) -> Result<(), String> {
    let root_path = PathBuf::from(root.trim());
    if !root_path.exists() || !root_path.is_dir() {
        return Err(format!("待监听的目录不存在: {}", root_path.display()));
    }

    let (tx, rx) = mpsc::channel::<()>();
    let app_handle = app.clone();
    std::thread::spawn(move || {
        while rx.recv().is_ok() {
            // 防抖 300ms 合并 Word/Excel 保存时的多次写事件
            loop {
                match rx.recv_timeout(Duration::from_millis(300)) {
                    Ok(_) => continue,
                    Err(mpsc::RecvTimeoutError::Timeout) => {
                        let _ = app_handle.emit("workspace-fs-changed", ());
                        break;
                    }
                    Err(mpsc::RecvTimeoutError::Disconnected) => return,
                }
            }
        }
    });

    let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        if let Ok(event) = res {
            let touches_ignored = event.paths.iter().all(|p| {
                p.components().any(|c| {
                    let s = c.as_os_str().to_string_lossy();
                    should_skip_dir_name(&s)
                })
            });
            if !touches_ignored {
                let _ = tx.send(());
            }
        }
    })
    .map_err(|e| format!("初始化目录监听失败: {e}"))?;

    watcher
        .watch(&root_path, RecursiveMode::Recursive)
        .map_err(|e| format!("启动目录监听失败: {e}"))?;

    let mut guard = state
        .watcher
        .lock()
        .map_err(|_| "获取文件监听器锁失败".to_string())?;
    *guard = Some(watcher);
    Ok(())
}

#[tauri::command]
fn native_unwatch_workspace_dir(
    state: tauri::State<'_, WorkspaceWatcherState>,
) -> Result<(), String> {
    let mut guard = state
        .watcher
        .lock()
        .map_err(|_| "获取文件监听器锁失败".to_string())?;
    *guard = None;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let session_http_state =
        SessionHttpState::new().expect("failed to initialize reqwest session state");

    tauri::Builder::default()
        .manage(session_http_state)
        .manage(WorkspaceWatcherState::new())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            run_workspace_command,
            newapi_session_request,
            newapi_clear_cookies,
            fetch_web_url,
            native_ocr_image,
            native_list_workspace_files,
            native_read_workspace_file,
            native_write_workspace_file,
            native_delete_workspace_file,
            native_rename_workspace_file,
            native_watch_workspace_dir,
            native_unwatch_workspace_dir
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

    #[test]
    fn workspace_path_blocks_traversal_and_reserved_names() {
        assert!(resolve_safe_workspace_path("C:/work", "docs/report.docx").is_ok());
        assert!(resolve_safe_workspace_path("C:/work", "../secret.txt").is_err());
        assert!(resolve_safe_workspace_path("C:/work", "/etc/passwd").is_err());
        assert!(resolve_safe_workspace_path("C:/work", "D:/other.txt").is_err());
        assert!(resolve_safe_workspace_path("C:/work", "CON.txt").is_err());
        assert!(resolve_safe_workspace_path("C:/work", "bad./file.txt").is_err());
    }
}
