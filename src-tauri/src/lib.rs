use base64::{engine::general_purpose::STANDARD, Engine as _};
use image::ImageFormat;
use pdfium_render::prelude::*;
use serde::Serialize;
use std::{
    collections::HashMap,
    env,
    ffi::OsStr,
    io::Cursor,
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};

const STATE_EVENT: &str = "presentation-state";
const RENDER_WIDTH: i32 = 1600;
const RENDER_MAX_HEIGHT: i32 = 1200;

#[derive(Clone, Serialize)]
struct PresentationSnapshot {
    current_page: usize,
    total_pages: usize,
    pdf_path: Option<String>,
    page_image: Option<String>,
    render_error: Option<String>,
}

#[derive(Serialize)]
struct MonitorInfo {
    index: usize,
    name: Option<String>,
    width: u32,
    height: u32,
    x: i32,
    y: i32,
    scale_factor: f64,
}

struct PresentationModel {
    current_page: usize,
    total_pages: usize,
    pdf_path: Option<String>,
}

#[derive(Clone, PartialEq, Eq, Hash)]
struct PageCacheKey {
    pdf_path: String,
    page_index: usize,
    width: i32,
    max_height: i32,
}

impl PresentationModel {
    fn snapshot_without_image(&self, render_error: Option<String>) -> PresentationSnapshot {
        PresentationSnapshot {
            current_page: self.current_page + 1,
            total_pages: self.total_pages,
            pdf_path: self.pdf_path.clone(),
            page_image: None,
            render_error,
        }
    }

    fn next_page(&mut self) {
        if self.current_page + 1 < self.total_pages {
            self.current_page += 1;
        }
    }

    fn previous_page(&mut self) {
        if self.current_page > 0 {
            self.current_page -= 1;
        }
    }

    fn first_page(&mut self) {
        self.current_page = 0;
    }

    fn last_page(&mut self) {
        self.current_page = self.total_pages.saturating_sub(1);
    }
}

struct AppState {
    presentation: Mutex<PresentationModel>,
    pdfium: Mutex<Option<Pdfium>>,
    page_cache: Mutex<HashMap<PageCacheKey, String>>,
    startup_pdf_path: Option<String>,
}

impl AppState {
    fn new(startup_pdf_path: Option<String>) -> Self {
        Self {
            presentation: Mutex::new(PresentationModel {
                current_page: 0,
                total_pages: 1,
                pdf_path: None,
            }),
            pdfium: Mutex::new(None),
            page_cache: Mutex::new(HashMap::new()),
            startup_pdf_path,
        }
    }
}

fn startup_pdf_arg() -> Option<String> {
    env::args_os().skip(1).find_map(|argument| {
        let path = Path::new(&argument);
        let is_pdf = path
            .extension()
            .and_then(OsStr::to_str)
            .is_some_and(|extension| extension.eq_ignore_ascii_case("pdf"));

        if is_pdf {
            Some(path.to_string_lossy().into_owned())
        } else {
            None
        }
    })
}

fn pdfium_library_candidate(path: impl Into<PathBuf>) -> PathBuf {
    let path = path.into();

    if path.is_dir() || path.extension().is_none() {
        Pdfium::pdfium_platform_library_name_at_path(&path)
    } else {
        path
    }
}

fn push_pdfium_candidate(candidates: &mut Vec<PathBuf>, path: impl Into<PathBuf>) {
    let candidate = pdfium_library_candidate(path);

    if !candidates.contains(&candidate) {
        candidates.push(candidate);
    }
}

fn pdfium_library_candidates(app_handle: &AppHandle) -> Vec<PathBuf> {
    let mut candidates = Vec::new();

    if let Ok(path) = env::var("PPMC_PDFIUM_LIB") {
        push_pdfium_candidate(&mut candidates, path);
    }

    if let Ok(path) = env::var("PPMC_PDFIUM_DIR") {
        push_pdfium_candidate(&mut candidates, path);
    }

    if let Ok(resource_dir) = app_handle.path().resource_dir() {
        push_pdfium_candidate(&mut candidates, resource_dir.join("pdfium"));
    }

    if let Ok(current_dir) = env::current_dir() {
        push_pdfium_candidate(&mut candidates, current_dir.join("resources/pdfium"));
        push_pdfium_candidate(
            &mut candidates,
            current_dir.join("src-tauri/resources/pdfium"),
        );
        push_pdfium_candidate(&mut candidates, current_dir);
    }

    if let Ok(current_exe) = env::current_exe() {
        if let Some(exe_dir) = current_exe.parent() {
            push_pdfium_candidate(&mut candidates, exe_dir.join("pdfium"));
            push_pdfium_candidate(&mut candidates, exe_dir.join("../lib/ppmc/pdfium"));
            push_pdfium_candidate(&mut candidates, exe_dir);
        }
    }

    push_pdfium_candidate(
        &mut candidates,
        Path::new(env!("CARGO_MANIFEST_DIR")).join("resources/pdfium"),
    );

    candidates
}

fn get_pdfium<'a>(
    app_handle: &AppHandle,
    state: &'a State<'_, AppState>,
) -> Result<std::sync::MutexGuard<'a, Option<Pdfium>>, String> {
    let mut pdfium = state
        .pdfium
        .lock()
        .map_err(|_| "pdfium state lock poisoned".to_string())?;

    if pdfium.is_none() {
        let candidates = pdfium_library_candidates(app_handle);
        let mut errors = Vec::new();

        for candidate in &candidates {
            match Pdfium::bind_to_library(candidate) {
                Ok(bindings) => {
                    *pdfium = Some(Pdfium::new(bindings));
                    return Ok(pdfium);
                }
                Err(error) => errors.push(format!("{}: {error}", candidate.display())),
            }
        }

        let system_error = match Pdfium::bind_to_system_library() {
            Ok(bindings) => {
                *pdfium = Some(Pdfium::new(bindings));
                return Ok(pdfium);
            }
            Err(error) => error.to_string(),
        };

        return Err(format!(
            "PDFium library is not available. Run `scripts/setup-pdfium.sh` or set PPMC_PDFIUM_LIB. Tried: {}. System lookup: {system_error}",
            errors.join("; ")
        ));
    }

    Ok(pdfium)
}

fn render_page_data_url(pdfium: &Pdfium, path: &str, page_index: usize) -> Result<String, String> {
    let document = pdfium
        .load_pdf_from_file(path, None)
        .map_err(|error| format!("failed to open PDF: {error}"))?;
    let page = document
        .pages()
        .get(
            page_index
                .try_into()
                .map_err(|_| "page index is too large".to_string())?,
        )
        .map_err(|error| format!("failed to read PDF page: {error}"))?;
    let bitmap = page
        .render_with_config(
            &PdfRenderConfig::new()
                .set_target_width(RENDER_WIDTH)
                .set_maximum_height(RENDER_MAX_HEIGHT),
        )
        .map_err(|error| format!("failed to render PDF page: {error}"))?;
    let image = bitmap
        .as_image()
        .map_err(|error| format!("failed to convert PDF page to image: {error}"))?;
    let mut png = Vec::new();

    image
        .write_to(&mut Cursor::new(&mut png), ImageFormat::Png)
        .map_err(|error| format!("failed to encode PNG: {error}"))?;

    Ok(format!("data:image/png;base64,{}", STANDARD.encode(png)))
}

fn cached_page_data_url(
    app_handle: &AppHandle,
    state: &State<'_, AppState>,
    path: &str,
    page_index: usize,
) -> Result<String, String> {
    let cache_key = PageCacheKey {
        pdf_path: path.to_string(),
        page_index,
        width: RENDER_WIDTH,
        max_height: RENDER_MAX_HEIGHT,
    };

    if let Some(image) = state
        .page_cache
        .lock()
        .map_err(|_| "page cache lock poisoned".to_string())?
        .get(&cache_key)
        .cloned()
    {
        return Ok(image);
    }

    let image = {
        let pdfium = get_pdfium(app_handle, state)?;
        render_page_data_url(
            pdfium
                .as_ref()
                .ok_or_else(|| "PDFium was not initialized".to_string())?,
            path,
            page_index,
        )?
    };

    state
        .page_cache
        .lock()
        .map_err(|_| "page cache lock poisoned".to_string())?
        .insert(cache_key, image.clone());

    Ok(image)
}

fn snapshot_with_render(
    app_handle: &AppHandle,
    state: &State<'_, AppState>,
) -> Result<PresentationSnapshot, String> {
    let presentation = state
        .presentation
        .lock()
        .map_err(|_| "presentation state lock poisoned".to_string())?;

    let Some(path) = presentation.pdf_path.clone() else {
        return Ok(presentation.snapshot_without_image(None));
    };

    let current_page = presentation.current_page;
    let total_pages = presentation.total_pages;
    drop(presentation);

    let image = cached_page_data_url(app_handle, state, &path, current_page)?;

    Ok(PresentationSnapshot {
        current_page: current_page + 1,
        total_pages,
        pdf_path: Some(path),
        page_image: Some(image),
        render_error: None,
    })
}

fn emit_snapshot(app_handle: &AppHandle, snapshot: &PresentationSnapshot) -> Result<(), String> {
    app_handle
        .emit(STATE_EVENT, snapshot.clone())
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn get_presentation_state(
    app_handle: AppHandle,
    state: State<'_, AppState>,
) -> Result<PresentationSnapshot, String> {
    snapshot_with_render(&app_handle, &state)
}

#[tauri::command]
fn get_startup_pdf_path(state: State<'_, AppState>) -> Option<String> {
    state.startup_pdf_path.clone()
}

#[tauri::command]
fn load_pdf(
    app_handle: AppHandle,
    state: State<'_, AppState>,
    path: String,
) -> Result<PresentationSnapshot, String> {
    if !Path::new(&path).is_file() {
        return Err(format!("PDF file does not exist: {path}"));
    }

    let total_pages = {
        let pdfium = get_pdfium(&app_handle, &state)?;
        let document = pdfium
            .as_ref()
            .ok_or_else(|| "PDFium was not initialized".to_string())?
            .load_pdf_from_file(&path, None)
            .map_err(|error| format!("failed to open PDF: {error}"))?;

        usize::try_from(document.pages().len()).map_err(|_| "invalid page count".to_string())?
    };

    {
        let mut presentation = state
            .presentation
            .lock()
            .map_err(|_| "presentation state lock poisoned".to_string())?;
        presentation.current_page = 0;
        presentation.total_pages = total_pages.max(1);
        presentation.pdf_path = Some(path);
    }
    state
        .page_cache
        .lock()
        .map_err(|_| "page cache lock poisoned".to_string())?
        .clear();

    let snapshot = snapshot_with_render(&app_handle, &state)?;
    emit_snapshot(&app_handle, &snapshot)?;

    Ok(snapshot)
}

#[tauri::command]
fn next_page(
    app_handle: AppHandle,
    state: State<'_, AppState>,
) -> Result<PresentationSnapshot, String> {
    {
        let mut presentation = state
            .presentation
            .lock()
            .map_err(|_| "presentation state lock poisoned".to_string())?;
        presentation.next_page();
    }

    let snapshot = snapshot_with_render(&app_handle, &state)?;
    emit_snapshot(&app_handle, &snapshot)?;

    Ok(snapshot)
}

#[tauri::command]
fn previous_page(
    app_handle: AppHandle,
    state: State<'_, AppState>,
) -> Result<PresentationSnapshot, String> {
    {
        let mut presentation = state
            .presentation
            .lock()
            .map_err(|_| "presentation state lock poisoned".to_string())?;
        presentation.previous_page();
    }

    let snapshot = snapshot_with_render(&app_handle, &state)?;
    emit_snapshot(&app_handle, &snapshot)?;

    Ok(snapshot)
}

#[tauri::command]
fn first_page(
    app_handle: AppHandle,
    state: State<'_, AppState>,
) -> Result<PresentationSnapshot, String> {
    {
        let mut presentation = state
            .presentation
            .lock()
            .map_err(|_| "presentation state lock poisoned".to_string())?;
        presentation.first_page();
    }

    let snapshot = snapshot_with_render(&app_handle, &state)?;
    emit_snapshot(&app_handle, &snapshot)?;

    Ok(snapshot)
}

#[tauri::command]
fn last_page(
    app_handle: AppHandle,
    state: State<'_, AppState>,
) -> Result<PresentationSnapshot, String> {
    {
        let mut presentation = state
            .presentation
            .lock()
            .map_err(|_| "presentation state lock poisoned".to_string())?;
        presentation.last_page();
    }

    let snapshot = snapshot_with_render(&app_handle, &state)?;
    emit_snapshot(&app_handle, &snapshot)?;

    Ok(snapshot)
}

#[tauri::command]
fn list_monitors(app_handle: AppHandle) -> Result<Vec<MonitorInfo>, String> {
    let monitors = app_handle
        .available_monitors()
        .map_err(|error| error.to_string())?;

    Ok(monitors
        .into_iter()
        .enumerate()
        .map(|(index, monitor)| {
            let size = monitor.size();
            let position = monitor.position();

            MonitorInfo {
                index,
                name: monitor.name().cloned(),
                width: size.width,
                height: size.height,
                x: position.x,
                y: position.y,
                scale_factor: monitor.scale_factor(),
            }
        })
        .collect())
}

#[tauri::command]
fn toggle_fullscreen(app_handle: AppHandle, label: String) -> Result<bool, String> {
    let window = app_handle
        .get_webview_window(&label)
        .ok_or_else(|| format!("window not found: {label}"))?;
    let next = !window.is_fullscreen().map_err(|error| error.to_string())?;

    window
        .set_fullscreen(next)
        .map_err(|error| error.to_string())?;

    Ok(next)
}

#[tauri::command]
fn quit_app(app_handle: AppHandle) {
    app_handle.exit(0);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let startup_pdf_path = startup_pdf_arg();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::new(startup_pdf_path))
        .invoke_handler(tauri::generate_handler![
            get_presentation_state,
            get_startup_pdf_path,
            load_pdf,
            next_page,
            previous_page,
            first_page,
            last_page,
            list_monitors,
            toggle_fullscreen,
            quit_app
        ])
        .setup(|app| {
            WebviewWindowBuilder::new(
                app,
                "audience",
                WebviewUrl::App("index.html?role=audience".into()),
            )
            .title("ppmc audience")
            .inner_size(1024.0, 768.0)
            .build()?;

            if let Some(window) = app.get_webview_window("presenter") {
                window.set_title("ppmc presenter")?;
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
